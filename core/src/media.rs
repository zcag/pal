//! Now playing: what each player is playing and the transport controls.
//!
//! macOS: Spotify and Music over `osascript` (only while the app is
//! running, checked through `NSRunningApplication` first: a `tell
//! application` to one that is not would launch it), which gives the
//! state, track, artist, album, position and, for Spotify, the artwork url
//! and the track url; plus the system-wide Now Playing (any other player:
//! a browser, VLC) as one more row, from the first of: the MediaRemote
//! adapter pal bundles (`mediaremote-adapter.pl` run by `/usr/bin/perl`,
//! which dlopens `MediaRemoteAdapter.framework`; where it is comes from
//! [`configure`]), else `nowplaying-cli` on PATH. The adapter is the one
//! that works on macOS 15.4 and later, where `mediaremoted` answers only
//! entitled clients and `nowplaying-cli` gets null for everything; perl is
//! entitled. Linux: `playerctl` (`-l`, `-p <name> metadata --format`,
//! `play-pause`, `next`, `previous`) over MPRIS, one row per player. The
//! parsers are pure and fixture-tested on every platform.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub use crate::tool::{Error, Result};

/// Where [`configure`] put the MediaRemote adapter.
static ADAPTER: OnceLock<PathBuf> = OnceLock::new();

/// Points the macOS system-wide source at the directory holding
/// `mediaremote-adapter.pl` and `MediaRemoteAdapter.framework` (the
/// bundle's `Resources/mediaremote`, or `app/src-tauri/mediaremote` in the
/// repo; `app/scripts/fetch-mediaremote.sh` builds it). The first call
/// wins. False when the directory lacks either file, in which case the
/// source stays `nowplaying-cli`. Stored but unused off macOS.
pub fn configure(dir: &Path) -> bool {
    if !(dir.join("mediaremote-adapter.pl").is_file() && dir.join("MediaRemoteAdapter.framework").is_dir()) {
        return false;
    }
    ADAPTER.get_or_init(|| dir.to_path_buf());
    true
}

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
    /// What [`control`] takes: `spotify`, `music`, `system` (the macOS system-wide Now Playing), or the playerctl name.
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
    /// Whether there is a system-wide source (`playerctl`; the bundled MediaRemote adapter or `nowplaying-cli` on macOS): without one only Spotify and Music are seen on macOS.
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

/// What `mediaremote-adapter.pl <framework> get --now --no-artwork
/// --allow-missing-title` prints: one JSON object, `null` with nothing
/// playing. `--allow-missing-title` because Chrome reports a YouTube tab
/// with empty text keys until the page's media session reaches it
/// (minutes, seen on macOS 26.4) and the default drops such media;
/// `--no-artwork` because the artwork is a few hundred KB of base64 per
/// read and the bar polls every 5 s. Unlisted keys are ignored.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Remote {
    bundle_identifier: Option<String>,
    playing: Option<bool>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    elapsed_time: Option<f64>,
    /// With `--now`: `elapsedTime` is the position at `timestamp`, which can be minutes old.
    elapsed_time_now: Option<f64>,
}

/// The playing app's bundle id and its row (`id` `system`, `name` from the
/// id's last segment until the platform names the app, no `app` yet); None
/// with nothing playing. A title-less row with a state is a player that
/// reports no metadata (Chrome), still worth a row.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_mediaremote(text: &str) -> Option<(String, Player)> {
    let r: Remote = serde_json::from_str::<Option<Remote>>(text.trim()).ok()??;
    let bundle = r.bundle_identifier.filter(|b| !b.is_empty())?;
    let state = match r.playing {
        Some(true) => State::Playing,
        Some(false) => State::Paused,
        None => State::Stopped,
    };
    let text = |v: Option<String>| v.as_deref().and_then(opt);
    let player = Player {
        id: "system".into(),
        name: display_name(bundle.rsplit('.').next().unwrap_or(&bundle)),
        state,
        title: text(r.title),
        artist: text(r.artist),
        album: text(r.album),
        artwork: None,
        url: None,
        app: None,
        position: r.elapsed_time_now.or(r.elapsed_time),
        duration: r.duration.filter(|d| *d > 0.0),
    };
    Some((bundle, player))
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
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
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

    /// The bundle's path and localized name while it runs; None when it is not running.
    fn running(bundle: &str) -> Option<(String, Option<String>)> {
        let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle));
        let app = apps.iter().next()?;
        Some((app.bundleURL()?.path()?.to_string(), app.localizedName().map(|n| n.to_string())))
    }

    /// `/usr/bin/perl <adapter.pl> <framework> args..`; None until [`configure`] found the adapter.
    fn adapter(args: &[&str]) -> Option<Result<String>> {
        let dir = ADAPTER.get()?;
        let (script, framework) = (dir.join("mediaremote-adapter.pl"), dir.join("MediaRemoteAdapter.framework"));
        let mut all = vec![script.to_str()?, framework.to_str()?];
        all.extend_from_slice(args);
        Some(run("/usr/bin/perl", &all))
    }

    /// The system-wide row from the adapter, else `nowplaying-cli`: whether
    /// there is a source at all, and its player with the app's bundle id
    /// when the source knows it.
    fn system(players: &[Player]) -> (bool, Option<Player>) {
        if let Some(r) = adapter(&["get", "--now", "--no-artwork", "--allow-missing-title"]) {
            let Some((bundle, mut p)) = r.map_err(|e| eprintln!("media\tmediaremote\t{e}")).ok().and_then(|t| parse_mediaremote(&t)) else { return (true, None) };
            // The app's own row (Spotify, Music) has the urls; the same app twice says nothing.
            if APPS.iter().any(|a| a.bundle == bundle && players.iter().any(|q| q.id == a.id)) {
                return (true, None);
            }
            if let Some((path, name)) = running(&bundle) {
                p.app = Some(path);
                if let Some(n) = name {
                    p.name = n;
                }
            }
            return (true, Some(p));
        }
        if !on_path("nowplaying-cli") {
            return (false, None);
        }
        let p = run("nowplaying-cli", &["get", "title", "artist", "album", "playbackRate"]).ok().and_then(|t| parse_nowplaying_cli(&t));
        // No bundle id here: the same track as an app's row is that app's.
        (true, p.filter(|p| !players.iter().any(|q| q.title == p.title && q.artist == p.artist)))
    }

    pub fn now_playing() -> Result<NowPlaying> {
        let mut players = vec![];
        for a in APPS {
            let Some((path, _)) = running(a.bundle) else { continue };
            match osascript(a.script) {
                Ok(line) => players.push(parse_line(a.id, a.name, Some(path), &line, a.unit)),
                Err(e) => eprintln!("media\t{}\t{e}", a.id),
            }
        }
        let (system_wide, p) = system(&players);
        players.extend(p);
        Ok(NowPlaying { players, system_wide })
    }

    pub fn control(player: &str, cmd: Command) -> Result<()> {
        if player == "system" {
            // MRCommand ids: kMRPlay 0, kMRPause 1, kMRTogglePlayPause 2, kMRNextTrack 4, kMRPreviousTrack 5.
            let (id, verb) = match cmd {
                Command::PlayPause => ("2", "togglePlayPause"),
                Command::Play => ("0", "play"),
                Command::Pause => ("1", "pause"),
                Command::Next => ("4", "next"),
                Command::Previous => ("5", "previous"),
            };
            return adapter(&["send", id]).unwrap_or_else(|| run("nowplaying-cli", &[verb])).map(drop);
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

    /// `get --now --no-artwork --allow-missing-title` on hornet (macOS 26.4) with a YouTube tab playing in Chrome: a state and a position, every text key empty.
    const CHROME: &str = r#"{"playbackRate":1,"album":"","elapsedTimeNow":2532.9003329885559,"elapsedTime":2411.413333,"timestamp":"2026-09-16T17:49:16Z","bundleIdentifier":"com.google.Chrome","processIdentifier":79336,"title":"","duration":3963.0810000000001,"artist":"","contentItemIdentifier":"0AACB2C3-2709-40A4-A39F-34B9817B9C4B","playing":true}"#;

    #[test]
    fn mediaremote_chrome_without_metadata_is_a_title_less_playing_row() {
        let (bundle, p) = parse_mediaremote(CHROME).unwrap();
        assert_eq!(bundle, "com.google.Chrome");
        assert_eq!((p.id.as_str(), p.name.as_str(), p.state, p.app), ("system", "Chrome", State::Playing, None));
        assert_eq!((p.title, p.artist, p.album, p.artwork, p.url), (None, None, None, None, None));
        assert_eq!((p.position.map(f64::round), p.duration.map(f64::round)), (Some(2533.0), Some(3963.0)));
    }

    /// The same tab 20 minutes later: YouTube's media session had reached Chrome, so the title and artist are there.
    const CHROME_TITLED: &str = r#"{"playbackRate":1,"album":"","elapsedTimeNow":2891.869249954605,"elapsedTime":2778.9135249999999,"timestamp":"2026-09-16T17:55:49Z","bundleIdentifier":"com.google.Chrome","processIdentifier":79336,"title":"Taylor Tomlinson (Full Episode) | Conan O'Brien Needs A Friend","duration":3963.0810000000001,"artist":"Team Coco","contentItemIdentifier":"EA5BB967-3F31-46BA-9B86-EA60255454D0","playing":true}"#;

    #[test]
    fn mediaremote_chrome_with_metadata() {
        let (_, p) = parse_mediaremote(CHROME_TITLED).unwrap();
        assert_eq!((p.state, p.title.as_deref(), p.artist.as_deref(), p.album), (State::Playing, Some("Taylor Tomlinson (Full Episode) | Conan O'Brien Needs A Friend"), Some("Team Coco"), None));
        assert_eq!(p.position.map(f64::round), Some(2892.0));
    }

    #[test]
    fn mediaremote_paused_track_with_metadata_and_extra_keys() {
        // The README's key set (Spotify was not running to capture one): the unlisted keys are ignored, `elapsedTime` stands in without `--now`.
        let json = r#"{"bundleIdentifier":"com.spotify.client","playing":false,"title":"Blue Monday","artist":"New Order","album":"Power, Corruption & Lies","duration":448.0,"elapsedTime":12.5,"timestamp":"2026-09-16T17:49:16Z","playbackRate":0,"isMusicApp":true,"artworkMimeType":"image/jpeg","artworkData":"/9j/4AAQ","mediaType":"MRMediaRemoteMediaTypeMusic","uniqueIdentifier":7}"#;
        let (bundle, p) = parse_mediaremote(json).unwrap();
        assert_eq!(bundle, "com.spotify.client");
        assert_eq!((p.name.as_str(), p.state, p.title.as_deref(), p.artist.as_deref(), p.album.as_deref()), ("Client", State::Paused, Some("Blue Monday"), Some("New Order"), Some("Power, Corruption & Lies")));
        assert_eq!((p.position, p.duration), (Some(12.5), Some(448.0)));
    }

    #[test]
    fn mediaremote_nothing_playing() {
        assert!(parse_mediaremote("null\n").is_none());
        assert!(parse_mediaremote("{}").is_none());
        assert!(parse_mediaremote(r#"{"bundleIdentifier":"","playing":true}"#).is_none());
        assert!(parse_mediaremote("Failed to load framework").is_none());
    }

    #[test]
    fn configure_wants_both_files() {
        let dir = std::env::temp_dir().join(format!("pal-media-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("MediaRemoteAdapter.framework")).unwrap();
        assert!(!configure(&dir));
        std::fs::write(dir.join("mediaremote-adapter.pl"), "").unwrap();
        assert!(configure(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The whole macOS chain against this box: `cargo test -p pal-core mediaremote_live -- --ignored --nocapture`
    /// (needs app/src-tauri/mediaremote from scripts/fetch-mediaremote.sh and something playing).
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn mediaremote_live() {
        let dir = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../app/src-tauri/mediaremote"));
        assert!(configure(dir), "no adapter at {}", dir.display());
        let t = std::time::Instant::now();
        let np = now_playing().unwrap();
        eprintln!("{:.1} ms {np:#?}", t.elapsed().as_secs_f64() * 1e3);
        assert!(np.system_wide);
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
