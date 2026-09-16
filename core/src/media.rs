//! Now playing: what each player is playing and the transport controls.
//!
//! macOS: Spotify and Music over `osascript` (only while the app is
//! running, checked through `NSRunningApplication` first: a `tell
//! application` to one that is not would launch it), which gives the
//! state, track, artist, album, position and, for Spotify, the artwork url
//! and the track url; plus `nowplaying-cli` when it is on PATH for the
//! system-wide Now Playing (any other player: a browser, VLC). Linux:
//! `playerctl` (`-l`, `-p <name> metadata --format`, `play-pause`, `next`,
//! `previous`) over MPRIS, one row per player. The parsers are pure and
//! fixture-tested on every platform.

use serde::{Deserialize, Serialize};

pub use crate::tool::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Playing,
    Paused,
    Stopped,
}

impl State {
    /// Listing order: what is playing first.
    fn rank(self) -> u8 {
        match self {
            State::Playing => 0,
            State::Paused => 1,
            State::Stopped => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Command {
    PlayPause,
    Play,
    Pause,
    Next,
    Previous,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Player {
    /// What [`control`] takes: `spotify`, `music`, `system` (nowplaying-cli), or the playerctl name.
    pub id: String,
    /// `Spotify`, `Music`, `Firefox`.
    pub name: String,
    pub state: State,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// An http(s) or file url the UI can show.
    pub artwork: Option<String>,
    /// The track's own url (`spotify:track:...` as https), for Open.
    pub url: Option<String>,
    /// The player's `.app` / `.desktop`, for its icon and to open it; None when unknown.
    pub app: Option<String>,
    /// Seconds.
    pub position: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NowPlaying {
    pub players: Vec<Player>,
    /// Whether a system-wide source is installed (`playerctl`, `nowplaying-cli`): without one only Spotify and Music are seen on macOS.
    pub system_wide: bool,
}

/// Every player that is running, playing ones first.
pub fn now_playing() -> Result<NowPlaying> {
    let mut np = platform::now_playing()?;
    np.players.sort_by_key(|p| p.state.rank());
    Ok(np)
}

pub fn control(player: &str, cmd: Command) -> Result<()> {
    platform::control(player, cmd)
}

/// The separator the scripts and formats join fields with: a control
/// character no title carries.
const SEP: char = '\u{1f}';

fn state_of(s: &str) -> State {
    match s.trim().to_lowercase().as_str() {
        "playing" => State::Playing,
        "paused" => State::Paused,
        _ => State::Stopped,
    }
}

fn opt(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty() && t != "null" && t != "missing value").then(|| t.to_string())
}

fn num(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse().ok()
}

/// One `SEP`-joined line from a player: `state title artist album artwork url duration position`,
/// durations and positions in `unit` seconds (`1e-3` for Spotify's ms, `1e-6` for MPRIS us).
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
fn parse_line(id: &str, name: &str, app: Option<String>, line: &str, unit: f64) -> Player {
    let f: Vec<&str> = line.trim_end_matches(['\r', '\n']).split(SEP).collect();
    let get = |i: usize| f.get(i).copied().unwrap_or("");
    Player {
        id: id.into(),
        name: name.into(),
        state: state_of(get(0)),
        title: opt(get(1)),
        artist: opt(get(2)),
        album: opt(get(3)),
        artwork: opt(get(4)).filter(|u| u.starts_with("http") || u.starts_with("file:")),
        url: opt(get(5)),
        app,
        duration: num(get(6)).map(|d| d * unit).filter(|d| *d > 0.0),
        position: num(get(7)).map(|p| p * unit),
    }
}

/// `nowplaying-cli get title artist album playbackRate`: one value per line, `null` for none.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_nowplaying_cli(text: &str) -> Option<Player> {
    let mut l = text.lines();
    let (title, artist, album, rate) = (opt(l.next()?), opt(l.next().unwrap_or("")), opt(l.next().unwrap_or("")), l.next().unwrap_or("null").trim().to_string());
    title.as_ref()?;
    let state = match rate.as_str() {
        "null" => State::Stopped,
        r if num(r).unwrap_or(0.0) > 0.0 => State::Playing,
        _ => State::Paused,
    };
    Some(Player { id: "system".into(), name: "Now Playing".into(), state, title, artist, album, artwork: None, url: None, app: None, position: None, duration: None })
}

/// `firefox.instance1234` to `Firefox`, `spotify` to `Spotify`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn display_name(playerctl: &str) -> String {
    let base = playerctl.split('.').next().unwrap_or(playerctl);
    let mut c = base.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => playerctl.to_string(),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::fs::on_path;
    use crate::tool::{osascript, run};
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;

    struct App {
        id: &'static str,
        name: &'static str,
        bundle: &'static str,
        /// AppleScript for the line: state, then the current track's fields.
        script: &'static str,
        unit: f64,
    }

    const APPS: &[App] = &[
        App {
            id: "spotify",
            name: "Spotify",
            bundle: "com.spotify.client",
            script: r#"tell application "Spotify"
  set sep to character id 31
  set st to player state as text
  if st is "stopped" then return st
  set t to current track
  return st & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (artwork url of t) & sep & (spotify url of t) & sep & (duration of t) & sep & (player position)
end tell"#,
            unit: 1e-3,
        },
        App {
            id: "music",
            name: "Music",
            bundle: "com.apple.Music",
            script: r#"tell application "Music"
  set sep to character id 31
  set st to player state as text
  if st is "stopped" then return st
  set t to current track
  return st & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & "" & sep & "" & sep & (duration of t) & sep & (player position)
end tell"#,
            unit: 1.0,
        },
    ];

    /// The bundle's path while it runs; None when it is not running.
    fn running(bundle: &str) -> Option<String> {
        let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle));
        let app = apps.iter().next()?;
        Some(app.bundleURL()?.path()?.to_string())
    }

    pub fn now_playing() -> Result<NowPlaying> {
        let mut players = vec![];
        for a in APPS {
            let Some(path) = running(a.bundle) else { continue };
            match osascript(a.script) {
                Ok(line) => players.push(parse_line(a.id, a.name, Some(path), &line, a.unit)),
                Err(e) => eprintln!("media\t{}\t{e}", a.id),
            }
        }
        let system_wide = on_path("nowplaying-cli");
        if system_wide {
            if let Some(p) = run("nowplaying-cli", &["get", "title", "artist", "album", "playbackRate"]).ok().and_then(|t| parse_nowplaying_cli(&t)) {
                // The same track as an app's row is that app's; only a player we do not see otherwise.
                if !players.iter().any(|q| q.title == p.title && q.artist == p.artist) {
                    players.push(p);
                }
            }
        }
        Ok(NowPlaying { players, system_wide })
    }

    pub fn control(player: &str, cmd: Command) -> Result<()> {
        if player == "system" {
            let verb = match cmd {
                Command::PlayPause => "togglePlayPause",
                Command::Play => "play",
                Command::Pause => "pause",
                Command::Next => "next",
                Command::Previous => "previous",
            };
            return run("nowplaying-cli", &[verb]).map(drop);
        }
        let app = APPS.iter().find(|a| a.id == player).ok_or_else(|| Error::Failed(format!("no player {player}")))?;
        if running(app.bundle).is_none() {
            return Err(Error::Failed(format!("{} is not running", app.name)));
        }
        let verb = match cmd {
            Command::PlayPause => "playpause",
            Command::Play => "play",
            Command::Pause => "pause",
            Command::Next => "next track",
            Command::Previous => "previous track",
        };
        osascript(&format!("tell application \"{}\" to {verb}", app.name)).map(drop)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::fs::on_path;
    use crate::tool::run;

    const FORMAT: &str = "{{status}}\u{1f}{{title}}\u{1f}{{artist}}\u{1f}{{album}}\u{1f}{{mpris:artUrl}}\u{1f}{{xesam:url}}\u{1f}{{mpris:length}}\u{1f}{{position}}";

    /// The player's `.desktop` when one is named like it (`spotify.desktop`), for the icon.
    fn desktop(playerctl: &str) -> Option<String> {
        let base = playerctl.split('.').next()?;
        crate::fs::desktop_dirs().into_iter().map(|d| d.join(format!("{base}.desktop"))).find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
    }

    pub fn now_playing() -> Result<NowPlaying> {
        if !on_path("playerctl") {
            return Ok(NowPlaying { players: vec![], system_wide: false });
        }
        let listed = match run("playerctl", &["-l"]) {
            Ok(l) => l,
            // "No players found" is exit 1.
            Err(Error::Failed(m)) if m.contains("No players found") => String::new(),
            Err(e) => return Err(e),
        };
        let players = listed
            .lines()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(|n| {
                let line = run("playerctl", &["-p", n, "metadata", "--format", FORMAT]).unwrap_or_else(|_| "stopped".into());
                parse_line(n, &display_name(n), desktop(n), &line, 1e-6)
            })
            .collect();
        Ok(NowPlaying { players, system_wide: true })
    }

    pub fn control(player: &str, cmd: Command) -> Result<()> {
        let verb = match cmd {
            Command::PlayPause => "play-pause",
            Command::Play => "play",
            Command::Pause => "pause",
            Command::Next => "next",
            Command::Previous => "previous",
        };
        run("playerctl", &["-p", player, verb]).map(drop)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn now_playing() -> Result<NowPlaying> {
        Err(Error::Unavailable("now playing is not available on this platform".into()))
    }
    pub fn control(_: &str, _: Command) -> Result<()> {
        now_playing().map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spotify_line_with_artwork_url_and_ms_durations() {
        let line = ["playing", "Blue Monday", "New Order", "Power, Corruption & Lies", "https://i.scdn.co/image/ab67", "spotify:track:abc", "448000", "12,5"].join("\u{1f}");
        let p = parse_line("spotify", "Spotify", Some("/Applications/Spotify.app".into()), &line, 1e-3);
        assert_eq!(p.state, State::Playing);
        assert_eq!((p.title.as_deref(), p.artist.as_deref(), p.album.as_deref()), (Some("Blue Monday"), Some("New Order"), Some("Power, Corruption & Lies")));
        assert_eq!(p.artwork.as_deref(), Some("https://i.scdn.co/image/ab67"));
        assert_eq!((p.duration, p.position), (Some(448.0), Some(0.0125)));
        assert_eq!(p.app.as_deref(), Some("/Applications/Spotify.app"));
    }

    #[test]
    fn a_stopped_player_is_just_its_state() {
        let p = parse_line("music", "Music", None, "stopped\n", 1.0);
        assert_eq!(p, Player { id: "music".into(), name: "Music".into(), state: State::Stopped, title: None, artist: None, album: None, artwork: None, url: None, app: None, position: None, duration: None });
    }

    #[test]
    fn playerctl_line_with_us_units_and_a_file_artwork() {
        let line = ["Paused", "Track", "", "", "file:///home/x/.cache/art.jpg", "https://open.spotify.com/track/1", "240000000", "60000000"].join("\u{1f}");
        let p = parse_line("spotify", "Spotify", None, &line, 1e-6);
        assert_eq!((p.state, p.artist, p.artwork.as_deref(), p.duration, p.position), (State::Paused, None, Some("file:///home/x/.cache/art.jpg"), Some(240.0), Some(60.0)));
        assert_eq!(display_name("firefox.instance1234"), "Firefox");
        assert_eq!(display_name("spotify"), "Spotify");
    }

    #[test]
    fn nowplaying_cli_lines() {
        let p = parse_nowplaying_cli("Song\nArtist\nnull\n1\n").unwrap();
        assert_eq!((p.id.as_str(), p.state, p.title.as_deref(), p.artist.as_deref(), p.album), ("system", State::Playing, Some("Song"), Some("Artist"), None));
        assert_eq!(parse_nowplaying_cli("Song\nArtist\nAlbum\n0\n").unwrap().state, State::Paused);
        assert!(parse_nowplaying_cli("null\nnull\nnull\nnull\n").is_none());
    }

    #[test]
    fn playing_first() {
        let mut states = vec![State::Stopped, State::Playing, State::Paused];
        states.sort_by_key(|s| s.rank());
        assert_eq!(states, [State::Playing, State::Paused, State::Stopped]);
    }
}
