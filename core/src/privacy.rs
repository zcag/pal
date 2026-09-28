//! What is using the camera, the microphone or the screen right now: the
//! macOS menu bar's orange, green and purple dots, as data.
//!
//! macOS: the dots' own source for the camera and the screen, Control
//! Center's `sensor-indicators` log (`Active activity attributions changed
//! to ["cam:us.zoom.xos", "scr:com.google.Chrome", "mic:…"]`, a public
//! format string), read once with `log show` and then followed with one
//! long-lived `log stream`, so a change arrives as it happens and names the
//! app (a bundle id, a bare executable such as `ffmpeg`, or `System` for
//! macOS's own capture). The microphone per process from the CoreAudio
//! HAL's process objects (`kAudioProcessPropertyIsRunningInput` and its
//! pid; macOS 14.2+), named by the app responsible for it, so `ffmpeg` in
//! kitty reads "kitty" with `ffmpeg` as the process. Two fallbacks for what
//! the log may not have said yet: a camera CoreMediaIO sees running
//! (`kCMIODevicePropertyDeviceIsRunningSomewhere`, the device without the
//! app) and a Screen Sharing session (`screensharingd`). Linux: `pactl -f
//! json list source-outputs` (PipeWire's pulse server included) for the
//! microphone, `/proc/*/fd` links into `/dev/video*` for the camera.
//!
//! [`on_change`] starts one watcher thread that looks every [`EVERY`] (and
//! at once on a log line) and calls back only when the answer differs.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub use crate::tool::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensor {
    Camera,
    Microphone,
    Screen,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Use {
    pub sensor: Sensor,
    /// The app responsible, by its display name; None for a camera no one has named (the device alone).
    pub app: Option<String>,
    /// The process doing it, when it is not the app itself (`ffmpeg` under kitty).
    pub process: Option<String>,
    pub pid: Option<u32>,
    /// The app's bundle (macOS), for its icon.
    pub path: Option<String>,
    /// The camera's name.
    pub device: Option<String>,
}

/// Everything in use, cameras first, one row per app per sensor.
pub fn in_use() -> Result<Vec<Use>> {
    let mut v = platform::in_use()?;
    v.sort_by(|a, b| (a.sensor, &a.app, &a.device).cmp(&(b.sensor, &b.app, &b.device)));
    v.dedup_by(|a, b| a.sensor == b.sensor && a.app.is_some() && a.app == b.app && a.device == b.device);
    Ok(v)
}

#[cfg(target_os = "macos")]
const EVERY: Duration = Duration::from_secs(1);
#[cfg(not(target_os = "macos"))]
const EVERY: Duration = Duration::from_secs(2);

type Listener = Box<dyn Fn() + Send>;
static WATCHERS: OnceLock<Mutex<Vec<Listener>>> = OnceLock::new();

/// Call `f` whenever [`in_use`] changes. The first call starts the watcher; later ones add listeners.
pub fn on_change(f: impl Fn() + Send + 'static) {
    let mut started = true;
    let watchers = WATCHERS.get_or_init(|| {
        started = false;
        Mutex::new(vec![])
    });
    watchers.lock().unwrap().push(Box::new(f));
    if started {
        return;
    }
    check();
    std::thread::Builder::new()
        .name("privacy".into())
        .spawn(|| loop {
            std::thread::sleep(EVERY);
            check();
        })
        .expect("spawn the privacy watcher");
}

/// Look now; tell the listeners when the answer moved since the last look.
fn check() {
    static LAST: Mutex<Option<Vec<Use>>> = Mutex::new(None);
    let Some(watchers) = WATCHERS.get() else { return };
    let now = in_use().ok();
    let mut last = LAST.lock().unwrap();
    if *last != now {
        *last = now;
        drop(last);
        for f in watchers.lock().unwrap().iter() {
            f();
        }
    }
}

/// Control Center's `Active activity attributions changed to [...]`: each `kind:who` (`cam`, `mic`, `scr`, `loc`).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_attributions(message: &str) -> Option<Vec<(String, String)>> {
    let list = message.strip_prefix("Active activity attributions changed to ")?;
    let items: Vec<String> = serde_json::from_str(list).ok()?;
    Some(items.into_iter().filter_map(|i| i.split_once(':').map(|(k, w)| (k.to_string(), w.to_string()))).collect())
}

// ---- Linux parser, compiled everywhere for the tests -------------------

/// `pactl -f json list source-outputs`: each stream's app and pid; a peak meter reading a monitor (pavucontrol's) is not a recording.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_source_outputs(json: &str) -> Vec<Use> {
    #[derive(Deserialize)]
    struct Out {
        #[serde(default)]
        properties: std::collections::HashMap<String, serde_json::Value>,
    }
    let outs: Vec<Out> = serde_json::from_str(json).unwrap_or_default();
    let prop = |o: &Out, k: &str| o.properties.get(k).and_then(|v| v.as_str()).map(str::to_string);
    outs.iter()
        .filter(|o| prop(o, "media.name").as_deref() != Some("Peak detect"))
        .map(|o| Use {
            sensor: Sensor::Microphone,
            app: prop(o, "application.name").or_else(|| prop(o, "application.process.binary")),
            process: None,
            pid: prop(o, "application.process.id").and_then(|p| p.parse().ok()),
            path: None,
            device: None,
        })
        .collect()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};
    use objc2_core_audio::{
        kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioProcessPropertyIsRunningInput, kAudioProcessPropertyPID,
        AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertySelector,
    };
    use objc2_core_foundation::{CFRetained, CFString};
    use objc2_core_media_io::{
        kCMIODevicePropertyDeviceIsRunningSomewhere, kCMIOHardwarePropertyDevices, kCMIOObjectPropertyElementMain, kCMIOObjectPropertyName, kCMIOObjectPropertyScopeGlobal, kCMIOObjectSystemObject,
        CMIOObjectGetPropertyData, CMIOObjectGetPropertyDataSize, CMIOObjectID, CMIOObjectPropertyAddress,
    };
    use objc2_foundation::NSString;
    use std::io::BufRead;
    use std::process::{Command, Stdio};
    use std::ptr::NonNull;
    use std::sync::Once;

    extern "C" {
        /// libquarantine's, exported by libSystem: the app a helper or a child counts against (what TCC asks about).
        fn responsibility_get_pid_responsible_for_pid(pid: libc::pid_t) -> libc::pid_t;
    }

    fn ca_addr(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress { mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain }
    }

    fn ca_get<T: Copy + Default>(obj: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<T> {
        let a = ca_addr(selector);
        let mut v = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        // SAFETY: the out buffer is `size` bytes of a T.
        let rc = unsafe { AudioObjectGetPropertyData(obj, NonNull::from(&a), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::from(&mut v).cast()) };
        (rc == 0).then_some(v)
    }

    fn ca_processes() -> Vec<AudioObjectID> {
        let (sys, a) = (kAudioObjectSystemObject as AudioObjectID, ca_addr(kAudioHardwarePropertyProcessObjectList));
        let mut size = 0u32;
        // SAFETY: valid pointers for the call's duration.
        if unsafe { AudioObjectGetPropertyDataSize(sys, NonNull::from(&a), 0, std::ptr::null(), NonNull::from(&mut size)) } != 0 {
            return vec![];
        }
        let mut v = vec![0 as AudioObjectID; size as usize / 4];
        // SAFETY: the buffer holds `size` bytes.
        let rc = unsafe { AudioObjectGetPropertyData(sys, NonNull::from(&a), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new(v.as_mut_ptr().cast()).unwrap()) };
        v.truncate(if rc == 0 { size as usize / 4 } else { 0 });
        v
    }

    fn cmio_addr(selector: u32) -> CMIOObjectPropertyAddress {
        CMIOObjectPropertyAddress { mSelector: selector, mScope: kCMIOObjectPropertyScopeGlobal, mElement: kCMIOObjectPropertyElementMain }
    }

    fn cmio_get<T: Copy>(obj: CMIOObjectID, selector: u32, out: &mut T) -> bool {
        let (a, mut used) = (cmio_addr(selector), 0u32);
        // SAFETY: `out` is a T of the size passed.
        unsafe { CMIOObjectGetPropertyData(obj, &a, 0, std::ptr::null(), std::mem::size_of::<T>() as u32, &mut used, (out as *mut T).cast()) == 0 }
    }

    fn cameras() -> Vec<Use> {
        let (sys, a) = (kCMIOObjectSystemObject, cmio_addr(kCMIOHardwarePropertyDevices));
        let (mut size, mut used) = (0u32, 0u32);
        // SAFETY: valid pointers for the call's duration.
        if unsafe { CMIOObjectGetPropertyDataSize(sys, &a, 0, std::ptr::null(), &mut size) } != 0 {
            return vec![];
        }
        let mut ids = vec![0 as CMIOObjectID; size as usize / 4];
        // SAFETY: the buffer holds `size` bytes.
        if unsafe { CMIOObjectGetPropertyData(sys, &a, 0, std::ptr::null(), size, &mut used, ids.as_mut_ptr().cast()) } != 0 {
            return vec![];
        }
        ids.truncate(used as usize / 4);
        ids.into_iter()
            .filter(|&id| {
                let mut running = 0u32;
                cmio_get(id, kCMIODevicePropertyDeviceIsRunningSomewhere, &mut running) && running != 0
            })
            .map(|id| {
                let mut name: *const CFString = std::ptr::null();
                let device = (cmio_get(id, kCMIOObjectPropertyName, &mut name) && !name.is_null())
                    // SAFETY: a +1 reference, released with the CFRetained.
                    .then(|| unsafe { CFRetained::from_raw(NonNull::new_unchecked(name.cast_mut())) }.to_string());
                Use { sensor: Sensor::Camera, app: None, process: None, pid: None, path: None, device }
            })
            .collect()
    }

    fn proc_name(pid: i32) -> Option<String> {
        let mut buf = [0u8; 256];
        // SAFETY: the buffer is its length.
        let n = unsafe { libc::proc_name(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
    }

    /// The row for `pid`: the responsible app's name and bundle, the process when it is another.
    fn attribute(sensor: Sensor, pid: i32) -> Use {
        // SAFETY: a plain lookup; it answers the pid itself when nothing else is responsible.
        let owner = unsafe { responsibility_get_pid_responsible_for_pid(pid) };
        let owner = if owner > 0 { owner } else { pid };
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(owner);
        let name = app.as_ref().and_then(|a| a.localizedName()).map(|s| s.to_string()).or_else(|| proc_name(owner));
        let path = app.as_ref().and_then(|a| a.bundleURL()).and_then(|u| u.path()).map(|p| p.to_string());
        let process = if owner != pid { proc_name(pid) } else { None };
        Use { sensor, app: name, process, pid: Some(owner as u32), path, device: None }
    }

    fn microphones() -> Vec<Use> {
        ca_processes()
            .into_iter()
            .filter(|&p| ca_get::<u32>(p, kAudioProcessPropertyIsRunningInput).unwrap_or(0) != 0)
            .filter_map(|p| ca_get::<i32>(p, kAudioProcessPropertyPID))
            .map(|pid| attribute(Sensor::Microphone, pid))
            .collect()
    }

    fn running(name: &str) -> bool {
        let mut pids = vec![0 as libc::pid_t; 4096];
        // SAFETY: the buffer is its length in bytes.
        let n = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), (pids.len() * 4) as i32) };
        pids.truncate(n.max(0) as usize);
        pids.into_iter().any(|p| proc_name(p).as_deref() == Some(name))
    }

    const PREDICATE: &str = r#"subsystem == "com.apple.controlcenter" AND category == "sensor-indicators" AND eventMessage BEGINSWITH "Active activity attributions""#;
    /// What Control Center last said is in use; None until the log has been read.
    static ATTRIBUTIONS: Mutex<Option<Vec<(String, String)>>> = Mutex::new(None);

    fn message(line: &str) -> Option<Vec<(String, String)>> {
        let v: serde_json::Value = serde_json::from_str(line).ok()?;
        parse_attributions(v.get("eventMessage")?.as_str()?)
    }

    fn set(a: Vec<(String, String)>) {
        *ATTRIBUTIONS.lock().unwrap() = Some(a);
        super::check();
    }

    /// Once, on a thread: the last attributions of the past day (a few
    /// seconds of `log show`, meanwhile the fallbacks answer), then every new one as
    /// Control Center logs it. The stream runs under a shell that kills it
    /// when pal's end of its stdin closes, so it ends with pal; a stream
    /// that dies is started again.
    fn follow() {
        static START: Once = Once::new();
        START.call_once(|| {
            std::thread::Builder::new()
                .name("privacy-log".into())
                .spawn(|| {
                    let last = crate::tool::run("/usr/bin/log", &["show", "--last", "1d", "--style", "ndjson", "--predicate", PREDICATE]).ok().and_then(|out| out.lines().rev().find_map(message));
                    set(last.unwrap_or_default());
                    let script = format!("/usr/bin/log stream --style ndjson --predicate '{PREDICATE}' </dev/null & p=$!; cat >/dev/null; kill $p");
                    loop {
                        if let Ok(mut child) = Command::new("/bin/sh").args(["-c", &script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() {
                            let _keep = child.stdin.take();
                            for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines().map_while(|l| l.ok()) {
                                if let Some(a) = message(&line) {
                                    set(a);
                                }
                            }
                            drop(_keep);
                            let _ = child.wait();
                        }
                        std::thread::sleep(Duration::from_secs(10));
                    }
                })
                .expect("spawn the privacy log reader");
        });
    }

    /// A row for what the log names: a bundle id (its app, running or installed), a bare executable, or `System` (macOS itself).
    fn resolve(sensor: Sensor, who: &str, device: Option<String>) -> Use {
        let id = NSString::from_str(who);
        let app = NSRunningApplication::runningApplicationsWithBundleIdentifier(&id).firstObject();
        let url = app.as_ref().and_then(|a| a.bundleURL()).or_else(|| NSWorkspace::sharedWorkspace().URLForApplicationWithBundleIdentifier(&id));
        let path = url.and_then(|u| u.path()).map(|p| p.to_string());
        let stem = || path.as_deref().and_then(|p| std::path::Path::new(p).file_stem()).map(|s| s.to_string_lossy().into_owned());
        let name = if who == "System" { "macOS".into() } else { app.as_ref().and_then(|a| a.localizedName()).map(|s| s.to_string()).or_else(stem).unwrap_or_else(|| who.to_string()) };
        Use { sensor, app: Some(name), process: None, pid: app.map(|a| a.processIdentifier() as u32), path, device }
    }

    pub fn in_use() -> Result<Vec<Use>> {
        follow();
        let said = ATTRIBUTIONS.lock().unwrap().clone().unwrap_or_default();
        let of = |kind: &'static str| said.iter().filter(move |(k, _)| k == kind).map(|(_, w)| w.as_str());
        // A camera the log has not named yet (or never will) is still a camera: the device, no app.
        let devices = cameras();
        let mut v: Vec<Use> = if of("cam").next().is_none() {
            devices
        } else {
            let device = (devices.len() == 1).then(|| devices[0].device.clone()).flatten();
            of("cam").map(|w| resolve(Sensor::Camera, w, device.clone())).collect()
        };
        v.extend(microphones());
        v.extend(of("scr").map(|w| resolve(Sensor::Screen, w, None)));
        if running("screensharingd") {
            v.push(Use { sensor: Sensor::Screen, app: Some("Screen Sharing".into()), process: None, pid: None, path: None, device: None });
        }
        Ok(v)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    fn cameras() -> Vec<Use> {
        let Ok(procs) = std::fs::read_dir("/proc") else { return vec![] };
        let mut v = vec![];
        for p in procs.flatten() {
            let Some(pid) = p.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
            let Ok(fds) = std::fs::read_dir(p.path().join("fd")) else { continue };
            let dev = fds.flatten().filter_map(|fd| std::fs::read_link(fd.path()).ok()).find(|l| l.to_string_lossy().starts_with("/dev/video"));
            if let Some(dev) = dev {
                let comm = std::fs::read_to_string(p.path().join("comm")).ok().map(|s| s.trim().to_string());
                v.push(Use { sensor: Sensor::Camera, app: comm, process: None, pid: Some(pid), path: None, device: Some(dev.to_string_lossy().into_owned()) });
            }
        }
        v
    }

    pub fn in_use() -> Result<Vec<Use>> {
        let mut v = cameras();
        match crate::tool::run("pactl", &["-f", "json", "list", "source-outputs"]) {
            Ok(json) => v.extend(parse_source_outputs(&json)),
            Err(Error::Unavailable(_)) => {}
            Err(e) => return Err(e),
        }
        Ok(v)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn in_use() -> Result<Vec<Use>> {
        Err(Error::Unavailable("privacy: not on this platform".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_outputs_name_the_app_and_skip_peak_meters() {
        let json = r#"[
          {"index":41,"properties":{"application.name":"Firefox","application.process.id":"4242","media.name":"AudioCallbackDriver"}},
          {"index":42,"properties":{"application.name":"PulseAudio Volume Control","media.name":"Peak detect"}},
          {"index":43,"properties":{"application.process.binary":"arecord","application.process.id":"77"}}
        ]"#;
        let v = parse_source_outputs(json);
        assert_eq!(v.iter().map(|u| (u.app.as_deref(), u.pid)).collect::<Vec<_>>(), [(Some("Firefox"), Some(4242)), (Some("arecord"), Some(77))]);
        assert!(v.iter().all(|u| u.sensor == Sensor::Microphone));
        assert!(parse_source_outputs("not json").is_empty());
    }

    #[test]
    fn attributions_split_kind_and_who() {
        let a = parse_attributions(r#"Active activity attributions changed to ["cam:us.zoom.xos", "scr:System", "mic:ffmpeg"]"#).unwrap();
        assert_eq!(a, [("cam".into(), "us.zoom.xos".into()), ("scr".into(), "System".into()), ("mic".into(), "ffmpeg".into())]);
        assert_eq!(parse_attributions("Active activity attributions changed to []"), Some(vec![]));
        assert_eq!(parse_attributions("Recent activity attributions changed to []"), None);
    }
}
