//! `icon://` URI scheme: `icon://localhost/app?path=<app>&size=24` and
//! `icon://localhost/favicon?url=<url>&size=16` answer with the PNG from
//! `pal_core::icons`, on the blocking pool since a favicon fetch may take
//! seconds (its timeouts are the core's) and a list paints hundreds at
//! once; `icon://localhost/clip?id=<entry>&size=48` is a clipboard
//! image's thumbnail, `size=0` the image itself;
//! `icon://localhost/shot?ext=<name>&file=<png>&size=0` is one of an
//! installed extension's store screenshots (`<root>/<name>/screenshots/`),
//! as is, for the Settings window's Extensions page;
//! `icon://localhost/file?path=<image>&size=48` is a thumbnail of an image
//! file on disk (`thumbnailUrl` in api.ts: the screenshots palette's rows,
//! a browsed folder's pictures), `size=0` the file itself when it is a
//! PNG or a JPEG. Any failure is a 404 so the `<img>` falls back to its
//! glyph.
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
        ("shot", _) => return std::fs::read(screenshot(app, &param("ext")?, &param("file")?)?).ok(),
        ("file", 0) => return std::fs::read(image_file(&param("path")?)?).ok(),
        ("file", _) => icons::thumbnail(image_file(&param("path")?)?.as_path(), size),
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

/// What the `file` route serves as is: the two formats the webview draws
/// straight from disk. A thumbnail goes through the image crate, which
/// also reads GIF.
const IMAGE_EXT: [&str; 4] = ["png", "jpg", "jpeg", "gif"];

/// An absolute path to an image file (by extension), else nothing: the
/// route is reachable by any extension, so it serves pictures and never
/// an arbitrary file.
fn image_file(path: &str) -> Option<std::path::PathBuf> {
    let p = std::path::PathBuf::from(path);
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    (p.is_absolute() && IMAGE_EXT.contains(&ext.as_str()) && p.is_file()).then_some(p)
}

/// `<root>/<ext>/screenshots/<file>` for a registered extension; `file` is
/// one name, never a path, and only a PNG (what the store ships).
fn screenshot(app: &AppHandle, ext: &str, file: &str) -> Option<std::path::PathBuf> {
    if file.contains(['/', '\\']) || file.starts_with('.') || !file.ends_with(".png") {
        return None;
    }
    let root = crate::settings::extensions(app).into_iter().find(|e| e.name == ext)?.root;
    Some(Path::new(&root).join(ext).join("screenshots").join(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_route_serves_images_by_absolute_path_only() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("shot.PNG");
        std::fs::write(&png, b"x").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        assert_eq!(image_file(png.to_str().unwrap()), Some(png.clone()));
        assert_eq!(image_file(dir.path().join("notes.txt").to_str().unwrap()), None, "not a picture");
        assert_eq!(image_file(dir.path().join("gone.png").to_str().unwrap()), None, "not there");
        assert_eq!(image_file("shot.png"), None, "relative");
    }
}
