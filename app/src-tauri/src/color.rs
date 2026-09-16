//! The colour capability: `core/color.sample` lets the user pick one pixel
//! off the screen with the OS's own loupe. The panel is hidden first (the
//! pick is usually of something behind it), then macOS runs
//! `NSColorSampler` (10.15+, no permission, the colour comes back in sRGB;
//! the sampler must be shown from the main thread and answers there) and
//! Linux the `org.freedesktop.portal.Screenshot.PickColor` portal over the
//! session bus (the portal draws the picker and may ask the user once,
//! depending on the desktop; the answer is an sRGB triple in 0..1). The
//! bridge thread waits on a channel for up to [`WAIT`]: the user is aiming,
//! not a handler hanging, and the SDK's call carries the same timeout.
//! Cancelling (Escape) answers `null`. The panel stays hidden; the
//! extension brings it back with `effects.run({ push })` once it has the
//! colour where it wants it.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

/// How long a pick may take. Past it the sampler is left to the user (there is no cancel for it) and the call answers null.
const WAIT: Duration = Duration::from_secs(120);

/// What the call answers: sRGB, 0..255 per channel, and the same as lower-case hex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub hex: String,
}

impl Color {
    /// From unit sRGB components (0.0..1.0, as both platforms report them), rounded to the nearest 8-bit value and clamped.
    pub fn from_unit(r: f64, g: f64, b: f64) -> Color {
        let ch = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        let (r, g, b) = (ch(r), ch(g), ch(b));
        Color { r, g, b, hex: format!("#{r:02x}{g:02x}{b:02x}") }
    }
}

pub fn call(app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "sample" => sample(app).map(|c| c.map_or(Value::Null, |c| serde_json::to_value(c).unwrap())),
        _ => Err(format!("unknown color.{func}")),
    }
}

/// Hide the panel on the main thread and wait for the orderOut to reach the window server, so the loupe never samples pal itself.
fn hide_panel(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || crate::panel::hide(&handle)).map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(80));
    Ok(())
}

#[cfg(target_os = "macos")]
fn sample(app: &AppHandle) -> Result<Option<Color>, String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
    use std::sync::mpsc;

    hide_panel(app)?;
    let (tx, rx) = mpsc::channel::<Option<Color>>();
    app.run_on_main_thread(move || {
        let sampler = NSColorSampler::new();
        let block = RcBlock::new(move |color: *mut NSColor| {
            // SAFETY: AppKit hands a live NSColor, or nil when the user cancelled; it is only read here, on the main thread, inside the callback.
            let picked = unsafe { color.as_ref() }.and_then(|c| c.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())).map(|c| Color::from_unit(c.redComponent(), c.greenComponent(), c.blueComponent()));
            let _ = tx.send(picked);
        });
        // SAFETY: called on the main thread; AppKit retains the sampler until the session ends and copies the handler (a heap block: one more reference), so ours may go when this closure returns.
        unsafe { sampler.showSamplerWithSelectionHandler(&block) };
    })
    .map_err(|e| e.to_string())?;
    match rx.recv_timeout(WAIT) {
        Ok(c) => Ok(c),
        Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("the colour sampler went away".into()),
    }
}

#[cfg(target_os = "linux")]
fn sample(app: &AppHandle) -> Result<Option<Color>, String> {
    hide_panel(app)?;
    portal::pick(WAIT)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn sample(_app: &AppHandle) -> Result<Option<Color>, String> {
    Err("no screen colour picker on this platform".into())
}

/// The portal's request object path for our connection and a token
/// (`org.freedesktop.portal.Request`): the sender's unique name with the
/// leading `:` dropped and `.` turned into `_`, then the token.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn request_path(unique_name: &str, token: &str) -> String {
    let sender = unique_name.trim_start_matches(':').replace('.', "_");
    format!("/org/freedesktop/portal/desktop/request/{sender}/{token}")
}

/// `PickColor`'s reply: response 0 with a `color` of three doubles is the pick, 1 is the user cancelling, anything else is a failure.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn portal_result(response: u32, color: Option<(f64, f64, f64)>) -> Result<Option<Color>, String> {
    match (response, color) {
        (0, Some((r, g, b))) => Ok(Some(Color::from_unit(r, g, b))),
        (0, None) => Err("the portal answered without a colour".into()),
        (1, _) => Ok(None),
        (n, _) => Err(format!("the screenshot portal failed (response {n})")),
    }
}

#[cfg(target_os = "linux")]
mod portal {
    use super::{portal_result, request_path, Color};
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    const DESTINATION: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";

    /// The `color` entry of the portal's results: a `(ddd)` struct.
    fn color_of(results: &HashMap<String, OwnedValue>) -> Option<(f64, f64, f64)> {
        let v = results.get("color")?;
        let s = match &**v {
            Value::Structure(s) => s,
            _ => return None,
        };
        let f = |i: usize| match s.fields().get(i) {
            Some(Value::F64(x)) => Some(*x),
            _ => None,
        };
        Some((f(0)?, f(1)?, f(2)?))
    }

    pub fn pick(wait: Duration) -> Result<Option<Color>, String> {
        let conn = Connection::session().map_err(|e| format!("no session bus: {e}"))?;
        let unique = conn.unique_name().map(|n| n.to_string()).ok_or("the session bus gave no unique name")?;
        let token = format!("pal{}", std::process::id() ^ (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)));
        let path = request_path(&unique, &token);
        // Subscribed before the call: the portal may answer before the method returns.
        let request = Proxy::new(&conn, DESTINATION, path.as_str(), "org.freedesktop.portal.Request").map_err(|e| e.to_string())?;
        let mut responses = request.receive_signal("Response").map_err(|e| e.to_string())?;
        let portal = Proxy::new(&conn, DESTINATION, PATH, "org.freedesktop.portal.Screenshot").map_err(|e| e.to_string())?;
        let mut options: HashMap<&str, Value> = HashMap::new();
        options.insert("handle_token", Value::from(token.as_str()));
        let _handle: OwnedObjectPath = portal.call("PickColor", &("", options)).map_err(|e| format!("the screenshot portal refused PickColor: {e}"))?;
        // The blocking signal stream has no timeout of its own: wait on it from a thread, over a channel that does.
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let r = responses.next().ok_or_else(|| "the portal request ended without a response".to_string()).and_then(|m| m.body().deserialize::<(u32, HashMap<String, OwnedValue>)>().map_err(|e| e.to_string()));
            let _ = tx.send(r);
        });
        match rx.recv_timeout(wait) {
            Ok(Ok((response, results))) => portal_result(response, color_of(&results)),
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_components_round_to_eight_bits_and_clamp() {
        assert_eq!(Color::from_unit(1.0, 0.5333, 0.0), Color { r: 255, g: 136, b: 0, hex: "#ff8800".into() });
        assert_eq!(Color::from_unit(0.0, 0.0, 0.0).hex, "#000000");
        assert_eq!(Color::from_unit(1.2, -0.3, 0.5).hex, "#ff0080");
        // Half-way rounds up, as the portal's doubles come from 8-bit pixels in the first place.
        assert_eq!(Color::from_unit(0.5, 0.5, 0.5), Color { r: 128, g: 128, b: 128, hex: "#808080".into() });
    }

    #[test]
    fn the_answer_is_json_with_channels_and_hex() {
        let v = serde_json::to_value(Color::from_unit(0.0, 0.0, 1.0)).unwrap();
        assert_eq!(v, serde_json::json!({ "r": 0, "g": 0, "b": 255, "hex": "#0000ff" }));
    }

    #[test]
    fn portal_request_path_mangles_the_unique_name() {
        assert_eq!(request_path(":1.42", "pal7"), "/org/freedesktop/portal/desktop/request/1_42/pal7");
        assert_eq!(request_path("1.2.3", "t"), "/org/freedesktop/portal/desktop/request/1_2_3/t");
    }

    #[test]
    fn portal_results_map_to_a_colour_a_cancel_or_a_failure() {
        assert_eq!(portal_result(0, Some((1.0, 0.0, 0.0))), Ok(Some(Color::from_unit(1.0, 0.0, 0.0))));
        assert_eq!(portal_result(1, None), Ok(None));
        assert_eq!(portal_result(1, Some((1.0, 0.0, 0.0))), Ok(None));
        assert!(portal_result(0, None).unwrap_err().contains("without a colour"));
        assert!(portal_result(2, None).unwrap_err().contains("response 2"));
    }
}
