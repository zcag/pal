//! The storage capability: `pal_core::storage` over the bridge
//! (`storage.get` / `set` / `remove` / `keys`), one JSON file per extension
//! under `<data dir>/pal/storage`. The extension name comes with the
//! params (api.ts fills it from the caller's context); every extension runs
//! in the one host anyway, so the name is a namespace, not a boundary.

use pal_core::storage::Storage;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
struct Params {
    extension: String,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    value: Value,
}

pub fn install(app: &AppHandle) {
    let s = Storage::open();
    eprintln!("storage\tdir\t{}", s.dir().display());
    app.manage(s);
}

pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let p: Params = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
    let store = app.state::<Storage>();
    let key = || p.key.as_deref().ok_or("storage: no key");
    let r = match func {
        "get" => store.get(&p.extension, key()?).map_err(|e| e.to_string())?,
        "set" => store.set(&p.extension, key()?, p.value).map(|_| Value::Null).map_err(|e| e.to_string())?,
        "remove" => store.remove(&p.extension, key()?).map(|_| Value::Null).map_err(|e| e.to_string())?,
        "keys" => serde_json::to_value(store.keys(&p.extension).map_err(|e| e.to_string())?).unwrap(),
        _ => return Err(format!("unknown storage.{func}")),
    };
    Ok(r)
}
