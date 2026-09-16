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
//! entitled. The adapter is read through one long-lived `stream` child
//! ([`Stream`]: started by the first [`now_playing`], its diff lines merged
//! into the current state with the cover art as bytes, answered from
//! memory, [`on_change`] told on every track or state change), and `get`
//! only while that stream is down. Linux: `playerctl` (`-l`, `-p <name>
//! metadata --format`, `play-pause`, `next`, `previous`) over MPRIS, one
//! row per player. The parsers are pure and fixture-tested on every
//! platform; the stream's process handling runs against a shell fake.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

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
    /// The cover the stream holds ([`artwork`] serves it): changes with the picture, so the same id is the same bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_id: Option<String>,
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
    /// The system-wide row came from the live stream: a change reaches [`on_change`] by itself, nothing needs to poll for it.
    #[serde(default)]
    pub stream: bool,
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

/// The cover the stream holds under `id` (a [`Player::artwork_id`]), as a
/// `data:image/png;base64,` square of [`THUMB`] px plus the picture's own
/// size (the strip wants to know whether it is square). `Failed` once the
/// track has moved on: list again for the new id.
pub fn artwork(id: &str) -> Result<Artwork> {
    let art = stream::current().and_then(|s| s.artwork(id)).ok_or_else(|| Error::Failed(format!("no artwork {id}")))?;
    let png = art.thumb().ok_or_else(|| Error::Failed(format!("artwork {id} does not decode")))?;
    use base64::Engine;
    Ok(Artwork { data: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)), width: art.width, height: art.height })
}

/// What [`artwork`] answers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Artwork {
    pub data: String,
    pub width: u32,
    pub height: u32,
}

/// Runs on every change of the system-wide row's track, state, app or
/// cover (from the stream's reader thread, so keep it short: the app hands
/// it to the bar's `media` trigger). One listener; the first call wins.
pub fn on_change(f: impl Fn() + Send + Sync + 'static) {
    let _ = stream::CHANGED.set(Box::new(f));
}

/// Ends the stream child for good. Not needed for exit: the child reads
/// pal's end of a pipe and ends itself when that closes with the process.
pub fn shutdown() {
    stream::shutdown();
}

/// Bytes a cover may be; a larger one is dropped and the row keeps the app's icon.
pub const MAX_ARTWORK: usize = 512 * 1024;
/// The square [`artwork`] hands out: a row is at most 64 pt, so 128 px covers a retina one.
pub const THUMB: u32 = 128;

fn epoch_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
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
        artwork_id: None,
        url: opt(get(5)),
        app,
        duration: num(get(6)).map(|d| d * unit).filter(|d| *d > 0.0),
        position: num(get(7)).map(|p| p * unit),
    }
}

/// The adapter's payload: what `mediaremote-adapter.pl <framework> get
/// --now --no-artwork --allow-missing-title` prints as one JSON object
/// (`null` with nothing playing), and what the stream's lines merge into
/// (with `--micros`, the time keys are the `*Micros` ones).
/// `--allow-missing-title` because Chrome reports a YouTube tab with empty
/// text keys until the page's media session reaches it (minutes, seen on
/// macOS 26.4) and the default drops such media; `--no-artwork` on `get`
/// because the artwork is a few hundred KB of base64 per read. Unlisted
/// keys are ignored; `artworkData` never reaches here (the stream takes
/// it out first).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Remote {
    bundle_identifier: Option<String>,
    playing: Option<bool>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    duration_micros: Option<f64>,
    /// The position at `timestamp`, which can be minutes old.
    elapsed_time: Option<f64>,
    elapsed_time_micros: Option<f64>,
    /// With `get --now`: the adapter's own estimate for right now.
    elapsed_time_now: Option<f64>,
    /// With `--micros`: when `elapsedTime` was true, epoch microseconds.
    timestamp_epoch_micros: Option<f64>,
    /// 1 while playing, 0 paused; the position advances at this rate.
    playback_rate: Option<f64>,
}

impl Remote {
    /// Seconds into the track at `now` (epoch seconds): the adapter's
    /// `elapsedTimeNow` when it computed one, else `elapsedTime` advanced
    /// by the wall clock since its `timestamp` at the playback rate, the
    /// way the adapter does it (`getElapsedTimeNow`), and only while
    /// `playing`: a pause arrives as `playing: false` one line before the
    /// rate drops to 0 (QuickTime on hornet). Nothing to tick from without
    /// the timestamp: the stale position, as `get` gave it.
    fn position(&self, now: f64) -> Option<f64> {
        if let Some(p) = self.elapsed_time_now {
            return Some(p);
        }
        let elapsed = self.elapsed_time.or(self.elapsed_time_micros.map(|us| us * 1e-6))?;
        let rate = self.playback_rate.unwrap_or(0.0);
        match self.timestamp_epoch_micros {
            Some(ts) if rate > 0.0 && self.playing == Some(true) => Some(elapsed + (now - ts * 1e-6).max(0.0) * rate),
            _ => Some(elapsed),
        }
    }

    /// The playing app's bundle id and its row (`id` `system`, `name` from
    /// the id's last segment until the platform names the app, no `app`
    /// yet); None with nothing playing. A title-less row with a state is a
    /// player that reports no metadata (Chrome), still worth a row.
    fn player(self, now: f64) -> Option<(String, Player)> {
        let bundle = self.bundle_identifier.clone().filter(|b| !b.is_empty())?;
        let state = match self.playing {
            Some(true) => State::Playing,
            Some(false) => State::Paused,
            None => State::Stopped,
        };
        let text = |v: &Option<String>| v.as_deref().and_then(opt);
        let player = Player {
            id: "system".into(),
            name: display_name(bundle.rsplit('.').next().unwrap_or(&bundle)),
            state,
            title: text(&self.title),
            artist: text(&self.artist),
            album: text(&self.album),
            artwork: None,
            artwork_id: None,
            url: None,
            app: None,
            position: self.position(now),
            duration: self.duration.or(self.duration_micros.map(|us| us * 1e-6)).filter(|d| *d > 0.0),
        };
        Some((bundle, player))
    }
}

/// One `get` answer (see [`Remote`]).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_mediaremote(text: &str) -> Option<(String, Player)> {
    serde_json::from_str::<Option<Remote>>(text.trim()).ok()??.player(epoch_secs())
}

// ---- the stream ------------------------------------------------------------

/// One line of `stream`: `{"type":"data","diff":bool,"payload":{..}}`.
/// `diff: false` is the whole state (an empty payload: nothing playing);
/// `diff: true` is the keys that changed, a `null` one gone.
#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    diff: bool,
    #[serde(default)]
    payload: Map<String, Value>,
}

/// `line` into `fields`, the merged payload: replaced whole by a non-diff,
/// patched by a diff. Returns the `artworkData` the line carried, taken
/// out of the map (`Some(None)`: the cover is gone; `None`: no word on
/// it), so the map stays small and the bytes live once, decoded. A line
/// that is not `data` or not JSON is ignored.
fn merge(fields: &mut Map<String, Value>, line: &str) -> Option<Option<Option<String>>> {
    let l: Line = serde_json::from_str(line.trim()).ok()?;
    if l.kind != "data" {
        return None;
    }
    let mut payload = l.payload;
    let art = payload.remove("artworkData").map(|v| v.as_str().map(str::to_string));
    if l.diff {
        for (k, v) in payload {
            if v.is_null() {
                fields.remove(&k);
            } else {
                fields.insert(k, v);
            }
        }
        Some(art)
    } else {
        *fields = payload;
        Some(Some(art.flatten()))
    }
}

/// A cover as the stream sent it: the bytes (at most [`MAX_ARTWORK`]),
/// the picture's size from its header, an id over the bytes so the same
/// picture is the same id across lines and tracks, and the [`THUMB`] PNG
/// made once on the first ask.
pub struct Cover {
    pub id: String,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    thumb: OnceLock<Option<Vec<u8>>>,
}

impl Cover {
    /// Decodes the base64; None when it is not a picture or over the cap.
    fn decode(b64: &str) -> Option<Cover> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
        if bytes.len() > MAX_ARTWORK {
            eprintln!("media\tartwork dropped\t{} bytes over the {MAX_ARTWORK} cap", bytes.len());
            return None;
        }
        let (width, height) = image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format().ok()?.into_dimensions().ok()?;
        use sha2::Digest;
        let digest = sha2::Sha256::digest(&bytes);
        let id = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
        Some(Cover { id, bytes, width, height, thumb: OnceLock::new() })
    }

    /// The [`THUMB`] px PNG (the picture's aspect kept), decoded once.
    pub fn thumb(&self) -> Option<&[u8]> {
        self.thumb
            .get_or_init(|| {
                let img = image::load_from_memory(&self.bytes).ok()?.thumbnail(THUMB, THUMB);
                let mut png = std::io::Cursor::new(Vec::new());
                img.write_to(&mut png, image::ImageFormat::Png).ok()?;
                Some(png.into_inner())
            })
            .as_deref()
    }
}

/// The stream's state: the merged payload, the cover, and whether the
/// child is up (a line has arrived from the running one).
#[derive(Default)]
struct Live {
    fields: Map<String, Value>,
    cover: Option<std::sync::Arc<Cover>>,
    up: bool,
}

impl Live {
    /// One line in; whether the row changed (track, state, app, cover):
    /// what [`on_change`] is for. Position changes (a seek, the clock)
    /// are not a change: nothing re-renders for them.
    fn feed(&mut self, line: &str) -> bool {
        let before = self.signature();
        let Some(art) = merge(&mut self.fields, line) else { return false };
        self.up = true;
        match art {
            None => {}
            Some(None) => self.cover = None,
            Some(Some(b64)) => {
                if let Some(c) = Cover::decode(&b64) {
                    if self.cover.as_ref().is_none_or(|old| old.id != c.id) {
                        self.cover = Some(std::sync::Arc::new(c));
                    }
                } else {
                    self.cover = None;
                }
            }
        }
        self.signature() != before
    }

    fn signature(&self) -> (Vec<Value>, Option<String>) {
        let f = |k: &str| self.fields.get(k).cloned().unwrap_or(Value::Null);
        (["bundleIdentifier", "title", "artist", "album", "playing"].iter().map(|k| f(k)).collect(), self.cover.as_ref().map(|c| c.id.clone()))
    }

    /// The system-wide row from the merged payload, its position ticked to `now`.
    fn player(&self, now: f64) -> Option<(String, Player)> {
        let r: Remote = serde_json::from_value(Value::Object(self.fields.clone())).ok()?;
        let (bundle, mut p) = r.player(now)?;
        p.artwork_id = self.cover.as_ref().map(|c| c.id.clone());
        Some((bundle, p))
    }
}

/// The adapter's `stream`, kept as one child for the process: started by
/// the first [`now_playing`] once [`configure`] found the adapter, read on
/// its own thread, restarted with backoff (1 s doubling to 60 s, reset
/// after a run of a minute) when it exits, and ended by the OS with pal:
/// the child is wrapped in a `sh` that holds pal's end of a pipe on its
/// stdin, and `read` returning at EOF (pal gone, however it went) kills the
/// adapter. `now_playing` answers from [`Live`] while it is up and falls
/// back to `get` while it is not.
#[cfg(unix)]
// Only macOS starts the adapter (`get_or_start` from the macOS `system()`); Linux keeps the module for `current`/`shutdown` and playerctl has no stream.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod stream {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{ChildStdin, Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    pub static CHANGED: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
    static STREAM: OnceLock<Arc<Stream>> = OnceLock::new();

    /// `sh -c WRAPPER sh <program> <args..>`: the program in the
    /// background with pal's stdout pipe, sh's own copy of it closed so
    /// the program's exit is EOF to pal, and sh waiting on stdin for the
    /// EOF that means pal is gone (or shut the stream down), which kills
    /// the program. A SIGTERM to sh kills it too.
    const WRAPPER: &str = "\"$@\" & p=$!; exec >&-; trap 'kill $p 2>/dev/null' TERM INT HUP; read -r _; kill $p 2>/dev/null";

    pub struct Stream {
        live: Mutex<Live>,
        /// Dropped to end the child (see [`WRAPPER`]).
        stdin: Mutex<Option<ChildStdin>>,
        stopping: std::sync::atomic::AtomicBool,
        program: String,
        args: Vec<String>,
    }

    impl Stream {
        /// Starts the reader thread over `program args..`.
        pub fn start(program: &str, args: &[&str]) -> Arc<Stream> {
            let s = Arc::new(Stream { live: Mutex::default(), stdin: Mutex::default(), stopping: Default::default(), program: program.into(), args: args.iter().map(|a| a.to_string()).collect() });
            let t = s.clone();
            std::thread::Builder::new().name("media-stream".into()).spawn(move || t.run()).expect("spawn media-stream");
            s
        }

        fn run(&self) {
            let mut backoff = Duration::from_secs(1);
            while !self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
                let started = Instant::now();
                match self.once() {
                    Ok(lines) => eprintln!("media\tstream ended\tafter {} lines, {:.0} s", lines, started.elapsed().as_secs_f64()),
                    Err(e) => eprintln!("media\tstream failed\t{e}"),
                }
                self.live.lock().unwrap_or_else(|p| p.into_inner()).up = false;
                if started.elapsed() >= Duration::from_secs(60) {
                    backoff = Duration::from_secs(1);
                }
                if self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(backoff);
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }

        /// One child, read to EOF; the lines it printed.
        fn once(&self) -> std::io::Result<usize> {
            let mut child = Command::new("sh").arg("-c").arg(WRAPPER).arg("sh").arg(&self.program).args(&self.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
            let stdout = child.stdout.take().expect("piped");
            *self.stdin.lock().unwrap_or_else(|p| p.into_inner()) = child.stdin.take();
            let mut n = 0;
            for line in BufReader::new(stdout).lines() {
                let line = line?;
                n += 1;
                let changed = self.live.lock().unwrap_or_else(|p| p.into_inner()).feed(&line);
                if changed {
                    if let Some(f) = CHANGED.get() {
                        f();
                    }
                }
            }
            // EOF: the program is gone; closing sh's stdin lets it exit, then reap it.
            *self.stdin.lock().unwrap_or_else(|p| p.into_inner()) = None;
            let _ = child.wait();
            Ok(n)
        }

        /// The row while the child is up: `Some(None)` is nothing playing, `None` is the stream down (fall back).
        pub fn row(&self, now: f64) -> Option<Option<(String, Player)>> {
            let live = self.live.lock().unwrap_or_else(|p| p.into_inner());
            live.up.then(|| live.player(now))
        }

        pub fn artwork(&self, id: &str) -> Option<Arc<Cover>> {
            self.live.lock().unwrap_or_else(|p| p.into_inner()).cover.clone().filter(|c| c.id == id)
        }

        /// Ends the child and the restarts; the reader thread ends with the EOF.
        pub fn stop(&self) {
            self.stopping.store(true, std::sync::atomic::Ordering::SeqCst);
            *self.stdin.lock().unwrap_or_else(|p| p.into_inner()) = None;
        }
    }

    /// The process-wide stream once something started it.
    pub fn current() -> Option<Arc<Stream>> {
        STREAM.get().cloned()
    }

    /// The process-wide stream, started on the first call.
    pub fn get_or_start(program: &str, args: &[&str]) -> Arc<Stream> {
        STREAM.get_or_init(|| Stream::start(program, args)).clone()
    }

    pub fn shutdown() {
        if let Some(s) = STREAM.get() {
            s.stop();
        }
    }
}

#[cfg(not(unix))]
mod stream {
    use super::*;
    pub static CHANGED: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
    pub struct Stream;
    impl Stream {
        pub fn artwork(&self, _: &str) -> Option<std::sync::Arc<Cover>> {
            None
        }
    }
    pub fn current() -> Option<std::sync::Arc<Stream>> {
        None
    }
    pub fn shutdown() {}
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
    Some(Player { id: "system".into(), name: "Now Playing".into(), state, title, artist, album, artwork: None, artwork_id: None, url: None, app: None, position: None, duration: None })
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

    /// The adapter's row from the stream (started here on the first call;
    /// `--micros` for a numeric timestamp to tick the position from,
    /// `--debounce=100` so a track change's burst of partial lines is one
    /// line), else from one `get` while the stream is down: `(stream, row)`,
    /// or None without the adapter.
    fn adapter_row() -> Option<(bool, Option<(String, Player)>)> {
        let dir = ADAPTER.get()?;
        let (script, framework) = (dir.join("mediaremote-adapter.pl").to_str()?.to_string(), dir.join("MediaRemoteAdapter.framework").to_str()?.to_string());
        let s = stream::get_or_start("/usr/bin/perl", &[&script, &framework, "stream", "--allow-missing-title", "--micros", "--debounce=100"]);
        if let Some(row) = s.row(epoch_secs()) {
            return Some((true, row));
        }
        let text = adapter(&["get", "--now", "--no-artwork", "--allow-missing-title"])?.map_err(|e| eprintln!("media\tmediaremote\t{e}")).ok();
        Some((false, text.and_then(|t| parse_mediaremote(&t))))
    }

    /// The system-wide row from the adapter, else `nowplaying-cli`: whether
    /// there is a source at all, whether it is the live stream, and its
    /// player with the app's bundle id when the source knows it. The same
    /// app as one of `players` (Spotify, Music) is no row of its own: that
    /// row has the urls, and takes the cover when it has no artwork url of
    /// its own (Music).
    fn system(players: &mut [Player]) -> (bool, bool, Option<Player>) {
        if let Some((stream, row)) = adapter_row() {
            let Some((bundle, mut p)) = row else { return (true, stream, None) };
            if let Some(own) = APPS.iter().find(|a| a.bundle == bundle).and_then(|a| players.iter_mut().find(|q| q.id == a.id)) {
                if own.artwork.is_none() {
                    own.artwork_id = p.artwork_id.take();
                }
                return (true, stream, None);
            }
            if let Some((path, name)) = running(&bundle) {
                p.app = Some(path);
                if let Some(n) = name {
                    p.name = n;
                }
            }
            return (true, stream, Some(p));
        }
        if !on_path("nowplaying-cli") {
            return (false, false, None);
        }
        let p = run("nowplaying-cli", &["get", "title", "artist", "album", "playbackRate"]).ok().and_then(|t| parse_nowplaying_cli(&t));
        // No bundle id here: the same track as an app's row is that app's.
        (true, false, p.filter(|p| !players.iter().any(|q| q.title == p.title && q.artist == p.artist)))
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
        let (system_wide, stream, p) = system(&mut players);
        players.extend(p);
        Ok(NowPlaying { players, system_wide, stream })
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
            return Ok(NowPlaying { players: vec![], system_wide: false, stream: false });
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
        Ok(NowPlaying { players, system_wide: true, stream: false })
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
        assert_eq!(p, Player { id: "music".into(), name: "Music".into(), state: State::Stopped, title: None, artist: None, album: None, artwork: None, artwork_id: None, url: None, app: None, position: None, duration: None });
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
    /// The first call starts the stream and answers from `get`; the ones
    /// after a moment answer from the stream, and their time is printed.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn mediaremote_live() {
        let dir = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../app/src-tauri/mediaremote"));
        assert!(configure(dir), "no adapter at {}", dir.display());
        let t = std::time::Instant::now();
        let np = now_playing().unwrap();
        eprintln!("get fallback: {:.1} ms stream={} {np:#?}", t.elapsed().as_secs_f64() * 1e3, np.stream);
        assert!(np.system_wide);
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let mut times = vec![];
        for _ in 0..20 {
            let t = std::time::Instant::now();
            let np = now_playing().unwrap();
            times.push(t.elapsed().as_secs_f64() * 1e6);
            assert!(np.stream, "the stream did not come up");
        }
        times.sort_by(f64::total_cmp);
        let np = now_playing().unwrap();
        eprintln!("stream: min {:.0} us, median {:.0} us, max {:.0} us {np:#?}", times[0], times[10], times[19]);
        if let Some(id) = np.players.iter().find_map(|p| p.artwork_id.clone()) {
            let t = std::time::Instant::now();
            let a = artwork(&id).unwrap();
            eprintln!("artwork {id}: {}x{}, {} chars, {:.1} ms first, ", a.width, a.height, a.data.len(), t.elapsed().as_secs_f64() * 1e3);
            let t = std::time::Instant::now();
            artwork(&id).unwrap();
            eprintln!("{:.2} ms again", t.elapsed().as_secs_f64() * 1e3);
        }
    }

    /// A 1x1 PNG (69 bytes) and a 2x1 one, as the adapter would send them.
    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    const PNG_2X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==";

    /// What the stream printed on hornet for the Chrome tab: the first line is the whole state (`--micros` keys), the next ones diffs.
    const STREAM_FULL: &str = r#"{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.google.Chrome","playing":true,"playbackRate":1,"title":"Taylor Tomlinson","artist":"Team Coco","album":"","durationMicros":3963081000,"elapsedTimeMicros":2778913524,"timestampEpochMicros":1789580149000000,"processIdentifier":79336,"artworkMimeType":"image/png","artworkData":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"}}"#;

    #[test]
    fn stream_lines_merge_full_then_diffs_and_a_null_removes() {
        let mut live = Live::default();
        assert!(live.feed(STREAM_FULL), "the first state is a change");
        assert!(live.up);
        let (bundle, p) = live.player(1789580149.0 + 10.0).unwrap();
        assert_eq!(bundle, "com.google.Chrome");
        assert_eq!((p.state, p.title.as_deref(), p.artist.as_deref(), p.album, p.artwork_id.is_some()), (State::Playing, Some("Taylor Tomlinson"), Some("Team Coco"), None, true));
        // Ticked: 2778.9 s at the timestamp, 10 s later at rate 1.
        assert_eq!((p.position.map(|s| (s * 10.0).round() / 10.0), p.duration.map(f64::round)), (Some(2788.9), Some(3963.0)));
        assert!(!live.fields.contains_key("artworkData"), "the base64 is taken out of the map");
        // A pause: one key, no artwork word, the cover stays; the position stops advancing.
        assert!(live.feed(r#"{"type":"data","diff":true,"payload":{"playing":false,"playbackRate":0,"elapsedTimeMicros":2790000000,"timestampEpochMicros":1789580160000000}}"#));
        let (_, p) = live.player(1789580160.0 + 60.0).unwrap();
        assert_eq!((p.state, p.title.as_deref(), p.position, p.artwork_id.is_some()), (State::Paused, Some("Taylor Tomlinson"), Some(2790.0), true));
        // A seek is not a change to tell about.
        assert!(!live.feed(r#"{"type":"data","diff":true,"payload":{"elapsedTimeMicros":100000000,"timestampEpochMicros":1789580170000000}}"#));
        // The title vanishing is a null; the artwork too.
        assert!(live.feed(r#"{"type":"data","diff":true,"payload":{"title":null,"artworkData":null,"artworkMimeType":null}}"#));
        let (_, p) = live.player(0.0).unwrap();
        assert_eq!((p.title, p.artwork_id), (None, None));
        // Nothing playing: an empty full state.
        assert!(live.feed(r#"{"type":"data","diff":false,"payload":{}}"#));
        assert!(live.player(0.0).is_none());
        assert!(live.up);
        // Noise is ignored and is no change.
        assert!(!live.feed("not json"));
        assert!(!live.feed(r#"{"type":"other","payload":{"title":"x"}}"#));
    }

    #[test]
    fn artwork_is_bytes_with_an_id_over_them_capped_and_thumbed() {
        let c = Cover::decode(PNG_1X1).unwrap();
        assert_eq!((c.width, c.height, c.bytes.len(), c.id.len()), (1, 1, 69, 16));
        assert_eq!(Cover::decode(PNG_1X1).unwrap().id, c.id, "the same bytes are the same id");
        assert_ne!(Cover::decode(PNG_2X1).unwrap().id, c.id);
        let png = c.thumb().unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(std::ptr::eq(png, c.thumb().unwrap()), "made once");
        assert!(Cover::decode("not base64!").is_none());
        assert!(Cover::decode("aGVsbG8=").is_none(), "not a picture");
        use base64::Engine;
        let big = base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_ARTWORK + 1]);
        assert!(Cover::decode(&big).is_none(), "over the cap");
        // The same cover on the next line is not re-decoded into a new Arc.
        let mut live = Live::default();
        live.feed(STREAM_FULL);
        let first = live.cover.clone().unwrap();
        assert!(!live.feed(&format!(r#"{{"type":"data","diff":true,"payload":{{"artworkData":"{PNG_1X1}"}}}}"#)), "the same picture is no change");
        assert!(std::sync::Arc::ptr_eq(&first, live.cover.as_ref().unwrap()));
        assert!(live.feed(&format!(r#"{{"type":"data","diff":true,"payload":{{"artworkData":"{PNG_2X1}"}}}}"#)), "a new picture is");
        assert_ne!(live.cover.as_ref().unwrap().id, first.id);
    }

    #[test]
    fn position_ticks_from_elapsed_and_timestamp_at_the_rate() {
        let r = |json: &str| serde_json::from_str::<Remote>(json).unwrap();
        // Playing at rate 1: 100 s at the timestamp, 5 s later.
        assert_eq!(r(r#"{"playing":true,"elapsedTimeMicros":100000000,"timestampEpochMicros":1000000000,"playbackRate":1}"#).position(1005.0), Some(105.0));
        // At 2x.
        assert_eq!(r(r#"{"playing":true,"elapsedTime":100,"timestampEpochMicros":1000000000,"playbackRate":2}"#).position(1005.0), Some(110.0));
        // Paused: rate 0 holds; so does `playing: false` while the rate has not dropped yet.
        assert_eq!(r(r#"{"playing":false,"elapsedTime":100,"timestampEpochMicros":1000000000,"playbackRate":0}"#).position(1005.0), Some(100.0));
        assert_eq!(r(r#"{"playing":false,"elapsedTime":100,"timestampEpochMicros":1000000000,"playbackRate":1}"#).position(1005.0), Some(100.0));
        // A clock behind the timestamp never goes backwards.
        assert_eq!(r(r#"{"playing":true,"elapsedTime":100,"timestampEpochMicros":1000000000,"playbackRate":1}"#).position(999.0), Some(100.0));
        // Without a timestamp there is nothing to tick from; `elapsedTimeNow` from `get --now` wins outright.
        assert_eq!(r(r#"{"playing":true,"elapsedTime":100,"playbackRate":1}"#).position(5000.0), Some(100.0));
        assert_eq!(r(r#"{"elapsedTime":100,"elapsedTimeNow":142.5,"timestampEpochMicros":1000000000,"playbackRate":1}"#).position(5000.0), Some(142.5));
        assert_eq!(r(r#"{"playbackRate":1}"#).position(5000.0), None);
    }

    /// The stream against a shell fake: lines are merged as they come, the
    /// state answers while the child lives, and its exit is `None` (fall
    /// back to `get`) until the restart brings a new child.
    #[test]
    #[cfg(unix)]
    fn stream_answers_while_up_and_falls_back_when_the_child_dies() {
        let dir = std::env::temp_dir().join(format!("pal-media-stream-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let flag = dir.join("second");
        // First run: a full state, a moment, exit. Second run: a different state, then hold until killed (`exec`: the wrapper kills the one process it started, as the adapter is one).
        let script = format!(
            "#!/bin/sh\nif [ -e '{flag}' ]; then printf '%s\\n' '{second}'; exec sleep 30; fi\ntouch '{flag}'\nprintf '%s\\n' '{first}'\nsleep 0.3\nexit 0\n",
            flag = flag.display(),
            first = r#"{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.example.one","playing":true,"title":"One"}}"#,
            second = r#"{"type":"data","diff":false,"payload":{"bundleIdentifier":"com.example.two","playing":false,"title":"Two"}}"#,
        );
        let path = dir.join("fake.sh");
        std::fs::write(&path, script).unwrap();
        use std::sync::Arc;
        let changes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let n = changes.clone();
        let _ = stream::CHANGED.set(Box::new(move || {
            n.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        let s = stream::Stream::start("sh", &[path.to_str().unwrap()]);
        let wait = |pred: &dyn Fn() -> bool| {
            let t = std::time::Instant::now();
            while !pred() {
                assert!(t.elapsed() < std::time::Duration::from_secs(5), "timed out");
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        };
        wait(&|| s.row(0.0).is_some());
        assert_eq!(s.row(0.0).unwrap().unwrap().1.title.as_deref(), Some("One"));
        // The child exits after its line: the stream is down, `row` is None, until the 1 s backoff restarts it.
        wait(&|| s.row(0.0).is_none());
        wait(&|| s.row(0.0).is_some());
        let (bundle, p) = s.row(0.0).unwrap().unwrap();
        assert_eq!((bundle.as_str(), p.state, p.title.as_deref()), ("com.example.two", State::Paused, Some("Two")));
        assert!(changes.load(std::sync::atomic::Ordering::SeqCst) >= 2, "both states were a change");
        // stop() closes the pipe: the wrapper kills the sleeping fake and the reader sees EOF.
        s.stop();
        wait(&|| s.row(0.0).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
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
