//! Icons as size-normalised PNG files in a disk cache.
//!
//! `app_icon` reads an application's own artwork (an `.app` bundle on macOS, a
//! `.desktop` entry on Linux); `favicon` fetches a site's icon. Both return the
//! path of a `size`x`size` PNG under [`cache_dir`], which the app can serve
//! through an `icon://` URI scheme. Callers run these off the UI thread: the
//! network half blocks for up to [`TIMEOUT`].

use image::{imageops::FilterType, RgbaImage};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use url::Url;

/// Upper bound on the wall time one `favicon` call may spend on the network.
pub const TIMEOUT: Duration = Duration::from_secs(3);
/// A failed favicon fetch is remembered this long so a list does not re-hit
/// the network on every render while offline.
pub const MISS_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_HTML: u64 = 256 * 1024;
const MAX_IMAGE: u64 = 2 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The app ships no icon we can read; the UI shows its letter placeholder.
    #[error("no icon for {0}")]
    NoIcon(String),
    /// Offline, refused, or not an image; the UI shows the globe glyph.
    #[error("favicon unavailable: {0}")]
    Unavailable(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// `~/Library/Caches/pal/icons` on macOS, `$XDG_CACHE_HOME/pal/icons` on Linux.
pub fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("pal/icons")
}

/// PNG of the application's icon at `size` px. `path` is a `.app` bundle on
/// macOS (any file works there, Finder's icon for it) or a `.desktop` file on
/// Linux. The cache key carries the source's mtime, so a reinstall refreshes.
pub fn app_icon(path: &Path, size: u32) -> Result<PathBuf> {
    app_icon_in(&cache_dir(), path, size)
}

/// PNG of the site's icon at `size` px, keyed by origin: one fetch serves every
/// URL on the host. Fails with [`Error::Unavailable`] when offline or when the
/// site has nothing decodable; that failure is cached for [`MISS_TTL`].
pub fn favicon(url: &str, size: u32) -> Result<PathBuf> {
    favicon_in(&cache_dir(), url, size)
}

/// Delete cached files older than `max_age`; returns how many went.
pub fn prune(max_age: Duration) -> std::io::Result<usize> {
    let cutoff = SystemTime::now() - max_age;
    let mut n = 0;
    for entry in fs::read_dir(cache_dir())?.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).map(|t| t < cutoff);
        if old.unwrap_or(false) && fs::remove_file(entry.path()).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

fn app_icon_in(dir: &Path, path: &Path, size: u32) -> Result<PathBuf> {
    let mtime = fs::metadata(path)?.modified().ok().and_then(unix_secs);
    let key = cache_key("app", &path.to_string_lossy(), size, mtime);
    if let Some(hit) = cached(dir, &key) {
        return Ok(hit);
    }
    let img = platform::load(path, size).ok_or_else(|| Error::NoIcon(path.display().to_string()))?;
    store(dir, &key, fit(img, size))
}

fn favicon_in(dir: &Path, url: &str, size: u32) -> Result<PathBuf> {
    let origin = Url::parse(url).ok().filter(|u| u.has_host()).ok_or_else(|| Error::Unavailable(format!("bad url {url}")))?;
    let origin = origin.join("/").unwrap();
    let key = cache_key("fav", origin.as_str(), size, None);
    if let Some(hit) = cached(dir, &key) {
        return Ok(hit);
    }
    // The fetched bytes are kept per origin so 16 and 32 cost one round trip.
    let src_key = cache_key("fav-src", origin.as_str(), 0, None);
    let (src, miss) = (dir.join(format!("{src_key}.src")), dir.join(format!("{src_key}.miss")));
    let bytes = match fs::read(&src) {
        Ok(b) => b,
        Err(_) => {
            if fs::metadata(&miss).and_then(|m| m.modified()).map(|t| t.elapsed().unwrap_or_default() < MISS_TTL).unwrap_or(false) {
                return Err(Error::Unavailable("recent miss".into()));
            }
            fs::create_dir_all(dir)?;
            let b = web::fetch(&origin, size).inspect_err(|_| { let _ = fs::write(&miss, b""); })?;
            fs::write(&src, &b)?;
            b
        }
    };
    let img = decode(&bytes, size).ok_or_else(|| Error::Unavailable("cached source undecodable".into()))?;
    store(dir, &key, fit(img, size))
}

fn unix_secs(t: SystemTime) -> Option<u64> {
    t.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// Stable across runs and versions: the cache survives upgrades.
fn cache_key(kind: &str, source: &str, size: u32, mtime: Option<u64>) -> String {
    let mut h = Sha256::new();
    h.update(format!("{kind}\0{source}\0{size}\0{}", mtime.unwrap_or(0)));
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn cached(dir: &Path, key: &str) -> Option<PathBuf> {
    let p = dir.join(format!("{key}.png"));
    p.is_file().then_some(p)
}

/// Write via a temp file and rename so a concurrent reader never sees a partial PNG.
fn store(dir: &Path, key: &str, img: RgbaImage) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("{key}.png"));
    let tmp = dir.join(format!("{key}.{}.tmp", std::process::id()));
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| Error::Unavailable(e.to_string()))?;
    fs::write(&tmp, buf.into_inner())?;
    fs::rename(&tmp, &path)?;
    Ok(path)
}

/// Scale to fit a `size` square, centred on transparent, so every cached file
/// has the same geometry regardless of source aspect.
fn fit(img: RgbaImage, size: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    if w == size && h == size {
        return img;
    }
    let s = size as f64 / w.max(h).max(1) as f64;
    let (nw, nh) = (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1));
    let scaled = image::imageops::resize(&img, nw, nh, FilterType::Lanczos3);
    let mut out = RgbaImage::new(size, size);
    image::imageops::overlay(&mut out, &scaled, ((size - nw) / 2).into(), ((size - nh) / 2).into());
    out
}

/// Decode PNG/JPEG/GIF, ICO (the entry closest to `size` from above), or SVG
/// (rasterised at `size`).
fn decode(bytes: &[u8], size: u32) -> Option<RgbaImage> {
    if bytes.starts_with(&[0, 0, 1, 0]) {
        return decode_ico(bytes, size);
    }
    let head = &bytes[..bytes.len().min(1024)];
    if head.starts_with(b"<") && head.windows(4).any(|w| w == b"<svg") {
        return decode_svg(bytes, size);
    }
    Some(image::load_from_memory(bytes).ok()?.into_rgba8())
}

fn decode_ico(bytes: &[u8], size: u32) -> Option<RgbaImage> {
    let dir = ico::IconDir::read(Cursor::new(bytes)).ok()?;
    let entry = closest(dir.entries().iter(), |e| e.width(), size)?;
    let img = entry.decode().ok()?;
    RgbaImage::from_raw(img.width(), img.height(), img.rgba_data().to_vec())
}

fn decode_svg(bytes: &[u8], size: u32) -> Option<RgbaImage> {
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).ok()?;
    let (w, h) = (tree.size().width(), tree.size().height());
    let s = size as f32 / w.max(h);
    let mut pix = resvg::tiny_skia::Pixmap::new(size, size)?;
    let t = resvg::tiny_skia::Transform::from_scale(s, s).post_translate((size as f32 - w * s) / 2.0, (size as f32 - h * s) / 2.0);
    resvg::render(&tree, t, &mut pix.as_mut());
    let data = pix.pixels().iter().flat_map(|p| { let c = p.demultiply(); [c.red(), c.green(), c.blue(), c.alpha()] }).collect();
    RgbaImage::from_raw(size, size, data)
}

/// Smallest candidate at or above `size`; the largest below it otherwise.
fn closest<T>(items: impl Iterator<Item = T>, dim: impl Fn(&T) -> u32, size: u32) -> Option<T> {
    let mut best: Option<(u32, T)> = None;
    for it in items {
        let d = dim(&it);
        let better = match &best {
            None => true,
            Some((b, _)) => (d >= size && (*b < size || d < *b)) || (*b < size && d > *b),
        };
        if better {
            best = Some((d, it));
        }
    }
    best.map(|(_, t)| t)
}

/// `Icon=` from a `.desktop` file's `[Desktop Entry]` group.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_icon_key(text: &str) -> Option<&str> {
    let mut in_entry = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
        } else if in_entry {
            if let Some(v) = line.strip_prefix("Icon=") {
                return Some(v.trim()).filter(|v| !v.is_empty());
            }
        }
    }
    None
}

mod web {
    use super::*;
    use std::io::Read;

    /// Bytes of the first candidate icon that decodes, within [`TIMEOUT`].
    pub fn fetch(origin: &Url, size: u32) -> Result<Vec<u8>> {
        let deadline = Instant::now() + TIMEOUT;
        let agent = ureq::Agent::config_builder().user_agent("pal/0.1").build().new_agent();
        let mut candidates = Vec::new();
        // A refused or unreadable page still leaves /favicon.ico to try.
        if let Ok((base, html)) = get(&agent, origin, deadline, MAX_HTML) {
            candidates.extend(pick_icon(&String::from_utf8_lossy(&html), &base, size));
        }
        let ico = origin.join("/favicon.ico").unwrap();
        if !candidates.contains(&ico) {
            candidates.push(ico);
        }
        let mut last = String::from("no candidates");
        for url in candidates {
            match get(&agent, &url, deadline, MAX_IMAGE) {
                Ok((_, bytes)) if decode(&bytes, size).is_some() => return Ok(bytes),
                Ok(_) => last = format!("{url}: not an image"),
                Err(Error::Unavailable(m)) => last = m,
                Err(e) => last = e.to_string(),
            }
        }
        Err(Error::Unavailable(last))
    }

    /// GET with whatever is left of the deadline; returns the final URL after
    /// redirects so relative hrefs resolve against the page actually served.
    fn get(agent: &ureq::Agent, url: &Url, deadline: Instant, limit: u64) -> Result<(Url, Vec<u8>)> {
        use ureq::ResponseExt;
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(Error::Unavailable("timeout".into()));
        }
        let err = |e: ureq::Error| Error::Unavailable(format!("{url}: {e}"));
        let mut resp = agent.get(url.as_str()).config().timeout_global(Some(left)).build().call().map_err(err)?;
        let final_url = Url::parse(&resp.get_uri().to_string()).unwrap_or_else(|_| url.clone());
        let mut bytes = Vec::new();
        resp.body_mut().as_reader().take(limit).read_to_end(&mut bytes)?;
        Ok((final_url, bytes))
    }

    /// Icon links from the page, best first: the smallest declared size at or
    /// above `size`, then undeclared sizes in page order, then the largest
    /// below. SVG counts as an exact fit.
    pub fn pick_icon(html: &str, base: &Url, size: u32) -> Vec<Url> {
        let head = html.find("</head").map(|i| &html[..i]).unwrap_or(html);
        let mut links: Vec<(u32, usize, Url)> = Vec::new();
        for (i, attrs) in link_tags(head).enumerate() {
            let rel = attr(&attrs, "rel").unwrap_or_default().to_ascii_lowercase();
            if !rel.split_whitespace().any(|t| t == "icon" || t == "apple-touch-icon") {
                continue;
            }
            let Some(href) = attr(&attrs, "href") else { continue };
            let Ok(url) = base.join(href.trim()) else { continue };
            let svg = attr(&attrs, "type").is_some_and(|t| t.contains("svg")) || url.path().ends_with(".svg");
            let sizes = attr(&attrs, "sizes").unwrap_or_default().to_ascii_lowercase();
            let declared = sizes.split_whitespace().filter_map(|s| s.split('x').next()?.parse::<u32>().ok()).max();
            let eff = match (svg || sizes == "any", declared) {
                (true, _) => size,
                (false, Some(d)) => d,
                (false, None) => u32::MAX, // unknown: try after any declared fit
            };
            links.push((eff, i, url));
        }
        links.sort_by_key(|(eff, i, _)| if *eff >= size { (0, *eff, *i) } else { (1, u32::MAX - eff, *i) });
        links.into_iter().map(|(_, _, u)| u).collect()
    }

    /// Attribute text of every `<link ...>` tag, case-insensitively.
    fn link_tags(html: &str) -> impl Iterator<Item = String> + '_ {
        let lower = html.to_ascii_lowercase();
        let mut from = 0;
        std::iter::from_fn(move || {
            let start = from + lower[from..].find("<link")?;
            let end = start + lower[start..].find('>').unwrap_or(lower.len() - start);
            from = end.min(lower.len());
            Some(html[start + 5..end].to_string())
        })
    }

    /// Value of `name=` in a tag's attribute text: quoted or bare.
    fn attr(attrs: &str, name: &str) -> Option<String> {
        let lower = attrs.to_ascii_lowercase();
        let mut from = 0;
        while let Some(i) = lower[from..].find(name) {
            let at = from + i;
            from = at + name.len();
            let before_ok = at == 0 || !matches!(lower.as_bytes()[at - 1], b'a'..=b'z' | b'0'..=b'9' | b'-');
            let rest = attrs[at + name.len()..].trim_start();
            if !before_ok || !rest.starts_with('=') {
                continue;
            }
            let rest = rest[1..].trim_start();
            return Some(match rest.chars().next() {
                Some(q @ ('"' | '\'')) => rest[1..].split(q).next().unwrap_or("").to_string(),
                _ => {
                    // Bare value runs to whitespace; a trailing `/` is the tag's self-close.
                    let v = rest.split_whitespace().next().unwrap_or("");
                    let last = rest[v.len()..].trim().is_empty();
                    if last { v.trim_end_matches('/') } else { v }.to_string()
                }
            });
        }
        None
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use icns::{IconFamily, PixelFormat};
    use std::io::BufReader;

    pub fn load(path: &Path, size: u32) -> Option<RgbaImage> {
        bundle_icns(path).and_then(|p| read_icns(&p, size)).or_else(|| workspace_icon(path, size))
    }

    /// The `.icns` named by Info.plist, when the bundle ships one.
    pub fn bundle_icns(app: &Path) -> Option<PathBuf> {
        let info: plist::Dictionary = plist::from_file(app.join("Contents/Info.plist")).ok()?;
        let res = app.join("Contents/Resources");
        ["CFBundleIconFile", "CFBundleIconName"].iter().filter_map(|k| info.get(k)?.as_string()).find_map(|name| {
            let p = res.join(name);
            let p = if name.ends_with(".icns") { p } else { p.with_extension("icns") };
            p.is_file().then_some(p)
        })
    }

    pub fn read_icns(path: &Path, size: u32) -> Option<RgbaImage> {
        let family = IconFamily::read(BufReader::new(fs::File::open(path).ok()?)).ok()?;
        let ty = closest(family.available_icons().into_iter().filter(|t| !t.is_mask()), |t| t.pixel_width(), size)?;
        let img = family.get_icon_with_type(ty).ok()?.convert_to(PixelFormat::RGBA);
        RgbaImage::from_raw(img.width(), img.height(), img.into_data().into_vec())
    }

    /// What Finder shows: covers bundles whose only artwork is in `Assets.car`,
    /// and any plain file. AppKit picks the representation nearest `size`.
    pub fn workspace_icon(path: &Path, size: u32) -> Option<RgbaImage> {
        use objc2::AnyThread;
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
        use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path.to_str()?));
        let mut rect = NSRect::new(NSPoint::ZERO, NSSize::new(size as f64, size as f64));
        // SAFETY: rect is a valid pointer for the call; no hints passed.
        let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
        // SAFETY: an empty properties dictionary is valid for PNG.
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        decode(&png.to_vec(), size)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    pub fn load(path: &Path, size: u32) -> Option<RgbaImage> {
        let text = fs::read_to_string(path).ok()?;
        let name = desktop_icon_key(&text)?;
        let file = if name.starts_with('/') {
            PathBuf::from(name)
        } else {
            let theme = freedesktop_icons::default_theme_gtk().unwrap_or_else(|| "hicolor".into());
            let name = name.strip_suffix(".png").or_else(|| name.strip_suffix(".svg")).unwrap_or(name);
            freedesktop_icons::lookup(name).with_size(size as u16).with_theme(&theme).with_cache().find()?
        };
        decode(&fs::read(file).ok()?, size)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn load(_: &Path, _: u32) -> Option<RgbaImage> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_stable() {
        assert_eq!(cache_key("app", "/Applications/Foo.app", 24, Some(1_700_000_000)), "3989f380068d186d414f1cd311411aca");
        assert_eq!(cache_key("fav", "https://github.com/", 16, None), "5f415e122ef1cc305b025b767ebdf1f0");
        assert_ne!(cache_key("app", "/Applications/Foo.app", 24, Some(1)), cache_key("app", "/Applications/Foo.app", 24, Some(2)));
        assert_ne!(cache_key("app", "x", 24, None), cache_key("app", "x", 48, None));
    }

    fn rgba(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_pixel(w, h, image::Rgba(px))
    }

    #[test]
    fn ico_picks_entry_at_or_above_size() {
        let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
        for (n, c) in [(16, [255, 0, 0, 255]), (32, [0, 255, 0, 255]), (64, [0, 0, 255, 255])] {
            let img = ico::IconImage::from_rgba_data(n, n, rgba(n, n, c).into_raw());
            dir.add_entry(ico::IconDirEntry::encode(&img).unwrap());
        }
        let mut bytes = Vec::new();
        dir.write(&mut bytes).unwrap();
        let img = decode(&bytes, 24).unwrap();
        assert_eq!((img.dimensions(), img.get_pixel(0, 0).0), ((32, 32), [0, 255, 0, 255]));
        assert_eq!(decode(&bytes, 128).unwrap().dimensions(), (64, 64));
        assert_eq!(fit(decode(&bytes, 24).unwrap(), 24).dimensions(), (24, 24));
    }

    #[test]
    fn svg_and_png_decode() {
        let svg = br##"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>"##;
        let img = decode(svg, 16).unwrap();
        assert_eq!((img.dimensions(), img.get_pixel(8, 8).0), ((16, 16), [255, 0, 0, 255]));
        let mut png = Cursor::new(Vec::new());
        rgba(20, 10, [1, 2, 3, 255]).write_to(&mut png, image::ImageFormat::Png).unwrap();
        let out = fit(decode(png.get_ref(), 16).unwrap(), 16);
        assert_eq!(out.dimensions(), (16, 16));
        assert_eq!(out.get_pixel(0, 0).0[3], 0, "letterboxed rows are transparent");
        assert_eq!(out.get_pixel(8, 8).0, [1, 2, 3, 255]);
        assert!(decode(b"<html>not an icon</html>", 16).is_none());
    }

    #[test]
    fn link_scan_picks_closest_at_or_above() {
        let base = Url::parse("https://example.com/a/b").unwrap();
        let pick = |html: &str, size| web::pick_icon(html, &base, size).into_iter().map(String::from).collect::<Vec<_>>();
        let html = r#"<html><head>
            <LINK REL="Shortcut Icon" HREF="/fav.ico">
            <link rel="icon" sizes="16x16" href="s16.png">
            <link rel=icon sizes=64x64 href=//cdn.example.org/s64.png>
            <link rel="icon" sizes="32x32" href='https://x.example/s32.png'>
            <link rel="stylesheet" href="/style.css">
            <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
            </head><body><link rel="icon" href="/late.png"></body></html>"#;
        assert_eq!(
            pick(html, 24),
            ["https://x.example/s32.png", "https://cdn.example.org/s64.png", "https://example.com/apple.png", "https://example.com/fav.ico", "https://example.com/a/s16.png"]
        );
        assert_eq!(pick(html, 64)[0], "https://cdn.example.org/s64.png");
        assert_eq!(pick(html, 256)[0], "https://example.com/fav.ico", "nothing above: unknown size before the largest below");
        assert_eq!(pick(html, 256)[1], "https://example.com/apple.png");
        let svg = r#"<link rel="icon" type="image/svg+xml" href="/i.svg"><link rel="icon" sizes="32x32" href="/i32.png">"#;
        assert_eq!(pick(svg, 24)[0], "https://example.com/i.svg", "svg is an exact fit");
        assert!(pick("<head><link rel=stylesheet href=a.css></head>", 16).is_empty());
    }

    #[test]
    fn desktop_icon_key_reads_entry_group() {
        let text = "[Desktop Action new]\nIcon=wrong\n[Desktop Entry]\nName=Kitty\nIcon=kitty \nExec=kitty\n";
        assert_eq!(desktop_icon_key(text), Some("kitty"));
        assert_eq!(desktop_icon_key("[Desktop Entry]\nName=x\n"), None);
    }

    #[test]
    fn favicon_caches_by_origin_and_misses() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(favicon_in(dir.path(), "not a url", 16), Err(Error::Unavailable(_))));
        // An unroutable port on localhost fails fast; the second call hits the miss marker.
        let e = favicon_in(dir.path(), "http://127.0.0.1:1/x", 16).unwrap_err();
        assert!(matches!(e, Error::Unavailable(_)), "{e}");
        assert_eq!(favicon_in(dir.path(), "http://127.0.0.1:1/y", 16).unwrap_err().to_string(), "favicon unavailable: recent miss");
        assert_eq!(favicon_in(dir.path(), "http://127.0.0.1:1/y", 32).unwrap_err().to_string(), "favicon unavailable: recent miss", "miss is per origin, not per size");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn bundle_icns_from_plist_fixture() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("Foo.app");
        fs::create_dir_all(app.join("Contents/Resources")).unwrap();
        let mut family = icns::IconFamily::new();
        let px = icns::Image::from_data(icns::PixelFormat::RGBA, 32, 32, rgba(32, 32, [9, 8, 7, 255]).into_raw()).unwrap();
        family.add_icon(&px).unwrap();
        family.write(fs::File::create(app.join("Contents/Resources/foo.icns")).unwrap()).unwrap();
        let mut info = plist::Dictionary::new();
        info.insert("CFBundleIconFile".into(), "foo".into());
        plist::to_file_xml(app.join("Contents/Info.plist"), &info).unwrap();

        assert_eq!(platform::bundle_icns(&app).unwrap(), app.join("Contents/Resources/foo.icns"));
        let cache = dir.path().join("cache");
        let out = app_icon_in(&cache, &app, 24).unwrap();
        let img = image::open(&out).unwrap().into_rgba8();
        assert_eq!((img.dimensions(), img.get_pixel(12, 12).0), ((24, 24), [9, 8, 7, 255]));
        assert_eq!(app_icon_in(&cache, &app, 24).unwrap(), out, "second call is a cache hit");
    }
}
