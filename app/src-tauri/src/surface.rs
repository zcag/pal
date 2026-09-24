//! `ext://` URI scheme: the files of an extension's game surface
//! (docs/design/game-surface.md). `ext://<extension>/<path>` is a file
//! under that extension's folder, in the root the host loaded it from
//! (`settings::extensions`, so a later root's copy wins as for its code);
//! a `*.ts` comes back as JavaScript, transpiled by the host
//! (`surface/transpile`, host/src/surface.ts). `/__pal/<file>` on every
//! extension's origin is the kit: `surface.js`, the Kenney deck under
//! `cards/`, and `tokens.css` (the app's own, compiled in). On Windows the
//! same handler sits at `http://ext.localhost/<extension>/<path>`, which
//! the UI derives the way it does `icon://`'s base.
//!
//! Every response carries [`CSP`]: the page loads from its own origin
//! (the kit included) and nothing else, no network, no eval, no inline
//! script; and `Access-Control-Allow-Origin: *`, since the frame is
//! sandboxed without `allow-same-origin` and so fetches its own module
//! scripts from an opaque origin. A path that is not a plain file inside
//! the folder (a `..`, a dotfile, a symlink out) or of a type not served
//! is a 404.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Builder, Manager, UriSchemeResponder, Wry};
use url::Url;

use crate::host::Host;

pub const SCHEME: &str = "ext";
/// The kit's route, first segment of a path on any extension's origin.
const KIT: &str = "__pal";
/// The Windows form's host (`http://ext.localhost/<extension>/...`).
const WINDOWS_HOST: &str = "ext.localhost";
/// host/src/surface.ts `CSP`, kept the same (its dev server sends it too); [`csp`] adds the origin.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/// The design tokens, one source for the panel and the pages.
const TOKENS: &str = include_str!("../../src/ui/tokens.css");

pub fn register(b: Builder<Wry>) -> Builder<Wry> {
    b.register_asynchronous_uri_scheme_protocol(SCHEME, |ctx, req, responder: UriSchemeResponder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move { responder.respond(respond(&app, &req).await) });
    })
}

/// [`CSP`] with the request's own origin (`ext://<extension>`) spelled out
/// beside `'self'`: the frame is sandboxed, so its origin is opaque, and
/// WebKit matches `'self'` against that, which nothing is.
fn csp(uri: &tauri::http::Uri) -> String {
    let origin = match (uri.scheme_str(), uri.host()) {
        (Some(s), Some(h)) => format!("{s}://{h}"),
        _ => return CSP.to_string(),
    };
    CSP.replace("'self'", &format!("'self' {origin}"))
}

async fn respond(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let b = Response::builder()
        .header(header::CONTENT_SECURITY_POLICY, csp(req.uri()))
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    match serve(app, &req.uri().to_string()).await {
        Ok((mime, body)) => b.header(header::CONTENT_TYPE, mime).body(body),
        Err((status, why)) => {
            if status != StatusCode::NOT_FOUND {
                eprintln!("surface\t{}\t{why}", req.uri());
            }
            b.status(status).header(header::CONTENT_TYPE, "text/plain; charset=utf-8").body(why.into_bytes())
        }
    }
    .expect("static headers build")
}

type Served = Result<(&'static str, Vec<u8>), (StatusCode, String)>;

async fn serve(app: &AppHandle, uri: &str) -> Served {
    let missing = || (StatusCode::NOT_FOUND, String::new());
    let (ext, rel) = Url::parse(uri).ok().as_ref().and_then(target).ok_or_else(missing)?;
    let mime = mime(&rel).ok_or_else(missing)?;
    let file = match ext {
        None if rel == Path::new("tokens.css") => return Ok((mime, TOKENS.as_bytes().to_vec())),
        None => inside(&kit_dir(app), &rel),
        Some(name) => crate::settings::extensions(app).into_iter().find(|e| e.name == name).and_then(|e| inside(&Path::new(&e.root).join(&name), &rel)),
    }
    .ok_or_else(missing)?;
    if file.extension().is_some_and(|e| e == "ts") {
        let host = app.try_state::<Arc<Host>>().ok_or((StatusCode::SERVICE_UNAVAILABLE, "no extension host".into()))?.inner().clone();
        return match host.request("surface/transpile", json!({ "path": file })).await {
            Ok(Value::String(js)) => Ok((mime, js.into_bytes())),
            Ok(_) => Err((StatusCode::INTERNAL_SERVER_ERROR, "surface/transpile answered no text".into())),
            Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
        };
    }
    std::fs::read(&file).map(|b| (mime, b)).map_err(|_| missing())
}

/// The kit: the resource tree's copy in a bundle, the repo's in a debug build (edits show on reload).
fn kit_dir(app: &AppHandle) -> PathBuf {
    let staged = app.path().resource_dir().ok().map(|d| d.join("surface-kit")).filter(|d| d.is_dir());
    match (cfg!(debug_assertions), staged) {
        (false, Some(dir)) => dir,
        _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/surface-kit")),
    }
}

/// A URL as the extension it names (`None`: the kit) and the relative path
/// in it, both from segments that are plain names: not empty, no leading
/// dot (so no `.` or `..`), no separator or drive colon once decoded.
fn target(url: &Url) -> Option<(Option<String>, PathBuf)> {
    let mut segs: Vec<String> = url.path().strip_prefix('/')?.split('/').map(|s| percent_decode_str(s).decode_utf8().ok().map(|s| s.into_owned()).filter(|s| plain(s))).collect::<Option<_>>()?;
    let host = url.host_str()?;
    let mut ext = if host == WINDOWS_HOST { Some(segs.remove(0)) } else { Some(host.to_string()).filter(|h| plain(h)) };
    if ext.as_deref() == Some(KIT) {
        ext = None;
    } else if segs.first().map(String::as_str) == Some(KIT) {
        segs.remove(0);
        ext = None;
    } else {
        ext.as_ref()?;
    }
    (!segs.is_empty()).then(|| (ext, segs.iter().collect()))
}

fn plain(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('.') && !s.contains(['/', '\\', ':', '\0'])
}

/// `rel` under `dir` as a file whose real path stays inside it (a symlink pointing out is refused).
fn inside(dir: &Path, rel: &Path) -> Option<PathBuf> {
    let base = dir.canonicalize().ok()?;
    let p = base.join(rel).canonicalize().ok()?;
    (p.starts_with(&base) && p.is_file()).then_some(p)
}

/// What a page may load, by extension; anything else is not served.
fn mime(path: &Path) -> Option<&'static str> {
    Some(match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" | "ts" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(url: &str) -> Option<(Option<String>, PathBuf)> {
        target(&Url::parse(url).unwrap())
    }

    #[test]
    fn a_url_names_an_extension_file_or_the_kit() {
        assert_eq!(t("ext://solitaire/surface/index.html"), Some((Some("solitaire".into()), PathBuf::from("surface/index.html"))));
        assert_eq!(t("ext://solitaire/__pal/surface.js"), Some((None, PathBuf::from("surface.js"))));
        assert_eq!(t("ext://solitaire/__pal/cards/10H.png"), Some((None, PathBuf::from("cards/10H.png"))));
        assert_eq!(t("ext://solitaire/my%20card.png"), Some((Some("solitaire".into()), PathBuf::from("my card.png"))));
        // Windows: the extension is the first segment; the kit is at the origin's root.
        assert_eq!(t("http://ext.localhost/solitaire/surface/main.ts"), Some((Some("solitaire".into()), PathBuf::from("surface/main.ts"))));
        assert_eq!(t("http://ext.localhost/__pal/surface.js"), Some((None, PathBuf::from("surface.js"))));
    }

    #[test]
    fn a_path_that_could_leave_the_folder_is_refused() {
        // A `..` (or `%2e%2e`) is resolved by the URL parser, as the browser does, against the extension's own root: still inside.
        assert_eq!(t("ext://solitaire/surface/%2e%2e/%2e%2e/secret.ts"), Some((Some("solitaire".into()), PathBuf::from("secret.ts"))));
        assert_eq!(t("ext://solitaire/../minesweeper/game.ts"), Some((Some("solitaire".into()), PathBuf::from("minesweeper/game.ts"))));
        for bad in [
            "ext://solitaire/surface/..%2f..%2fx.ts",
            "ext://solitaire/.env",
            "ext://solitaire/surface/.hidden.js",
            "ext://solitaire/a//b.js",
            "ext://solitaire/c%3a%5cwin.ini",
            "ext://solitaire/",
            "ext://solitaire",
            "http://ext.localhost/solitaire",
            "http://ext.localhost/..%2fx/y.js",
        ] {
            assert_eq!(t(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_file_must_really_be_inside_the_folder() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("game");
        std::fs::create_dir_all(dir.join("surface")).unwrap();
        std::fs::write(dir.join("surface/index.html"), "x").unwrap();
        std::fs::write(root.path().join("secret.txt"), "x").unwrap();
        assert!(inside(&dir, Path::new("surface/index.html")).is_some());
        assert_eq!(inside(&dir, Path::new("surface")), None, "a directory");
        assert_eq!(inside(&dir, Path::new("gone.html")), None);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("secret.txt"), dir.join("link.txt")).unwrap();
            assert_eq!(inside(&dir, Path::new("link.txt")), None, "a symlink out");
        }
    }

    #[test]
    fn the_policy_names_the_page_s_own_origin() {
        let c = csp(&"ext://solitaire/surface/index.html".parse().unwrap());
        assert!(c.starts_with("default-src 'self' ext://solitaire; script-src 'self' ext://solitaire;"), "{c}");
        assert!(c.contains("connect-src 'self' ext://solitaire;"));
        assert!(csp(&"http://ext.localhost/solitaire/a.js".parse().unwrap()).contains("script-src 'self' http://ext.localhost;"));
    }

    #[test]
    fn served_types_by_extension() {
        assert_eq!(mime(Path::new("surface/main.ts")), Some("text/javascript; charset=utf-8"));
        assert_eq!(mime(Path::new("index.HTML")), Some("text/html; charset=utf-8"));
        assert_eq!(mime(Path::new("cards/AS.png")), Some("image/png"));
        assert_eq!(mime(Path::new("tokens.css")), Some("text/css; charset=utf-8"));
        assert_eq!(mime(Path::new("pal.toml")), None);
        assert_eq!(mime(Path::new("run.sh")), None);
        assert_eq!(mime(Path::new("Makefile")), None);
    }
}
