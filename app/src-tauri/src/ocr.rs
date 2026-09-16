//! The OCR capability: `pal_core::ocr` over the bridge, `core/ocr.image
//! { path } | { data }` (a file, or base64 image bytes) answering
//! `{ text }`; `core/ocr.available` says whether a recogniser is there.

use base64::Engine;
use pal_core::ocr;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Deserialize)]
struct Params {
    path: Option<String>,
    /// Base64 (standard alphabet) image bytes.
    data: Option<String>,
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "available" => Ok(json!(ocr::available())),
        "image" => {
            let p: Params = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
            let text = match (p.path, p.data) {
                (Some(path), _) => ocr::image(std::path::Path::new(&path)),
                (None, Some(data)) => {
                    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|e| format!("bad params: data is not base64: {e}"))?;
                    ocr::bytes(&bytes)
                }
                (None, None) => return Err("bad params: `path` or `data`".into()),
            };
            text.map(|t| json!({ "text": t })).map_err(|e| e.to_string())
        }
        _ => Err(format!("unknown ocr.{func}")),
    }
}
