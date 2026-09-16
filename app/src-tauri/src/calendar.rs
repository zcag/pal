//! The calendar capability: `pal_core::calendar` over the bridge
//! (`calendar.permission` / `request` / `calendars` / `events` / `create`
//! / `delete` / `open` / `open_settings`). Every call runs on the bridge's
//! blocking thread: EventKit's store is thread-safe and each call makes
//! and drops its own, so nothing here touches the main thread. `request`
//! waits for the system prompt at most [`REQUEST_WAIT`], under the host's
//! 10 s pick timeout; an unanswered prompt leaves the state
//! `not_determined` and the extension asks again on its next show.

use std::time::Duration;

use pal_core::calendar::{self, NewEvent};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

const REQUEST_WAIT: Duration = Duration::from_secs(8);

#[derive(Deserialize)]
struct EventsParams {
    from: i64,
    to: i64,
    #[serde(default)]
    calendars: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct IdParams {
    id: String,
    #[serde(default)]
    occurrence: Option<i64>,
}

fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("bad params: {e}"))
}

fn json<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let r = match func {
        "permission" => Ok(json(calendar::permission())),
        "request" => calendar::request(REQUEST_WAIT).map(json),
        "open_settings" => return calendar::open_settings().map(|_| Value::Null).map_err(|e| format!("could not open System Settings: {e}")),
        "calendars" => calendar::calendars().map(json),
        "events" => {
            let p: EventsParams = parse(params)?;
            calendar::events(p.from, p.to, p.calendars.as_deref()).map(json)
        }
        "create" => {
            let p: NewEvent = parse(params)?;
            calendar::create(&p).map(Value::String)
        }
        "delete" | "open" => {
            let p: IdParams = parse(params)?;
            if func == "delete" { calendar::delete(&p.id, p.occurrence) } else { calendar::open(&p.id, p.occurrence) }.map(|_| Value::Null)
        }
        _ => return Err(format!("unknown calendar.{func}")),
    };
    r.map_err(|e| e.to_string())
}
