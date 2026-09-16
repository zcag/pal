//! `icon://` URI scheme: `icon://localhost/app?path=<app>&size=24` and
//! `icon://localhost/favicon?url=<url>&size=16` answer with the PNG from
//! `pal_core::icons`, on the blocking pool since a favicon fetch may take
//! seconds (its timeouts are the core's) and a list paints hundreds at
//! once; `icon://localhost/clip?id=<entry>&size=48` is a clipboard
//! image's thumbnail, `size=0` the image itself. Any failure is a 404 so
//! the `<img>` falls back to its glyph.
//! On Windows the same handler sits at `http://icon.localhost/...`; the
//! UI derives the base the way Tauri's `convertFileSrc` does.

use std::path::Path;

use pal_core::icons;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Builder, UriSchemeResponder, Wry};

pub const SCHEME: &str = "icon";
const MAX_SIZE: u32 = 256;

pub fn register(b: Builder<Wry>) -> Builder<Wry> {
    b.register_asynchronous_uri_scheme_protocol(SCHEME, |ctx, req, responder: UriSchemeResponder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn_blocking(move || responder.respond(respond(&app, &req)));
    })
}

fn respond(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let r = match png(app, req) {
        Some(bytes) => Response::builder().header(header::CONTENT_TYPE, "image/png").header(header::CACHE_CONTROL, "max-age=3600").body(bytes),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
    };
    r.expect("static headers build")
}

fn png(app: &AppHandle, req: &Request<Vec<u8>>) -> Option<Vec<u8>> {
    let url = url::Url::parse(&req.uri().to_string()).ok()?;
    let param = |k: &str| url.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned());
    let size = param("size")?.parse::<u32>().ok().filter(|s| *s <= MAX_SIZE)?;
    let file = match (url.path().trim_start_matches('/'), size) {
        ("clip", _) => return std::fs::read(crate::clipboard::image(app, param("id")?.parse().ok()?, size)?).ok(),
        (_, 0) => return None,
        ("app", _) => icons::app_icon(Path::new(&param("path")?), size),
        ("favicon", _) => icons::favicon(&param("url")?, size),
        _ => return None,
    };
    match file {
        Ok(p) => std::fs::read(p).ok(),
        Err(e) => {
            eprintln!("icon\tfailed\t{}: {e}", url.path().trim_start_matches('/'));
            None
        }
    }
}
