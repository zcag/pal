//! The apps capability: `pal_core::apps` over the bridge (`apps.for_file`
//! lists the apps registered for a file, the default first, each with the
//! `.app` / `.desktop` `path` the webview renders through `icon://app`;
//! `apps.open_with` opens the file with one of them).

use std::path::PathBuf;

use pal_core::apps;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
struct ForFileParams {
    path: PathBuf,
}

#[derive(Deserialize)]
struct OpenWithParams {
    path: PathBuf,
    app: PathBuf,
}

fn err(e: apps::Error) -> String {
    e.to_string()
}

fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("bad params: {e}"))
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "for_file" => {
            let p: ForFileParams = parse(params)?;
            Ok(serde_json::to_value(apps::for_file(&p.path).map_err(err)?).unwrap())
        }
        "open_with" => {
            let p: OpenWithParams = parse(params)?;
            apps::open_with(&p.path, &p.app).map_err(err).map(|_| Value::Null)
        }
        _ => Err(format!("unknown apps.{func}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn params_are_paths_and_missing_ones_are_refused() {
        assert!(parse::<ForFileParams>(json!({ "path": "/tmp/x" })).is_ok());
        assert!(parse::<ForFileParams>(json!({})).is_err());
        assert!(parse::<OpenWithParams>(json!({ "path": "/tmp/x" })).is_err(), "open_with needs the app");
        assert!(parse::<OpenWithParams>(json!({ "path": "/tmp/x", "app": "/Applications/TextEdit.app" })).is_ok());
    }
}
