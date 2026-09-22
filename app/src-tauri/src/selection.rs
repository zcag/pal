//! The selection capability: `pal_core::selection` over the bridge.
//! `core/selection.text` answers the frontmost app's selected text or
//! null; the Cmd+C snapshot fallback runs only when
//! `general.selection_snapshot` allows it (it touches the clipboard for a
//! moment). Without Accessibility on macOS the call is an error naming
//! the permission, and the prompt is shown once per run like paste's.
//! `core/selection.files` answers the Finder selection as paths, read once
//! per panel show (pershow.rs, like the dialog): the files palette's
//! suggest, the system palette's relist and a pick inside the palette all
//! ask on one show, and the answer is what was marked when the panel came
//! up, with Finder still in front of it.

use pal_core::selection;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::pershow::PerShow;
use crate::{permissions, settings};

static FILES: PerShow<Vec<String>> = PerShow::new();

/// The Finder selection, read once per show.
pub fn files() -> Vec<String> {
    FILES.get_or(|| {
        let t0 = std::time::Instant::now();
        let paths = selection::files();
        if !paths.is_empty() {
            eprintln!("selection	{} finder items	{:.1}ms", paths.len(), t0.elapsed().as_secs_f64() * 1000.0);
        }
        paths
    })
}

pub fn call(app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "files" => Ok(json!(files())),
        "text" => {
            let snapshot = settings::config(app).general.selection_snapshot;
            match selection::text(snapshot) {
                Ok(t) => Ok(json!(t)),
                Err(selection::Error::NeedsAccessibility) => {
                    permissions::ask(app, "accessibility", "Reading the selected text");
                    Err(selection::Error::NeedsAccessibility.to_string())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        _ => Err(format!("unknown selection.{func}")),
    }
}
