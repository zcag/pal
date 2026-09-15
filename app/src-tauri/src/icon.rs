//! `icon://` URI scheme: `icon://localhost/app?path=<app>&size=24` and
//! `icon://localhost/favicon?url=<url>&size=16` answer with the PNG from
//! `pal_core::icons`, off the webview thread since a favicon may block for
//! seconds. Any failure is a 404 so the `<img>` falls back to its glyph.
//! On Windows the same handler sits at `http://icon.localhost/...`; the
//! UI derives the base the way Tauri's `convertFileSrc` does.

use std::path::Path;

use pal_core::icons;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Builder, Runtime, UriSchemeResponder};

pub const SCHEME: &str = "icon";
const MAX_SIZE: u32 = 256;

pub fn register<R: Runtime>(b: Builder<R>) -> Builder<R> {
    b.register_asynchronous_uri_scheme_protocol(SCHEME, |_ctx, req, responder: UriSchemeResponder| {
        std::thread::spawn(move || responder.respond(respond(&req)));
    })
}

fn respond(req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match png(req) {
        Some(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "max-age=3600")
            .body(bytes)
            .unwrap(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

fn png(req: &Request<Vec<u8>>) -> Option<Vec<u8>> {
    let url = url::Url::parse(&req.uri().to_string()).ok()?;
    let param = |k: &str| url.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned());
    let size = param("size")?.parse::<u32>().ok().filter(|s| (1..=MAX_SIZE).contains(s))?;
    let file = match url.path().trim_start_matches('/') {
        "app" => icons::app_icon(Path::new(&param("path")?), size),
        "favicon" => icons::favicon(&param("url")?, size),
        _ => return None,
    };
    match file {
        Ok(p) => std::fs::read(p).ok(),
        Err(e) => {
            eprintln!("icon\t{}\t{e}", url.path());
            None
        }
    }
}
