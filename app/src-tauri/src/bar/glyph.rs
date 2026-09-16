//! The menu bar's icons, rasterised here rather than sent as title text:
//! the NSStatusItem title is a plain system-font string, and the Nerd Font
//! is not on users' Macs, so a private-use code point there is tofu
//! everywhere but the developer's machine. A glyph is drawn with
//! `ab_glyph` from the same Symbols Nerd Font the webview uses (the TTF,
//! fetched by `scripts/fetch-font.sh`, embedded at build time), at 2x
//! into a 36 px square, the size `tray.rs` ships its own icon at: the bar
//! draws it at 18 pt. The badge dot, the progress rule and the stale
//! dimming are drawn into the same image. Emoji are not in this font:
//! `render` answers `None` for them and the renderer puts the emoji in
//! the title text instead (Apple Color Emoji is on every Mac).
//!
//! An image is either a template (black on transparent, the system tints
//! it for a light or dark bar) or coloured; `Style::color` decides.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};

static FONT_BYTES: &[u8] = include_bytes!("../../fonts/SymbolsNerdFontMono-Regular.ttf");
static FONT: LazyLock<Option<FontRef<'static>>> = LazyLock::new(|| FontRef::try_from_slice(FONT_BYTES).ok());

/// The image's side in pixels: 18 pt at 2x.
pub const SIZE: u32 = 36;
/// The glyph's em size inside the square, leaving room for the badge dot
/// and the progress rule.
const GLYPH_PX: f32 = 28.0;
/// The badge dot's diameter (6 pt at 2x).
const DOT: f32 = 12.0;
/// The progress rule's height (2 pt at 2x).
const RULE: u32 = 4;
/// The alpha of a stale icon.
const STALE_ALPHA: f32 = 0.5;

const RED: [u8; 3] = [0xff, 0x3b, 0x30];

/// One RGBA image, row-major from the top.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Rgba {
    fn blank(width: u32, height: u32) -> Self {
        Self { width, height, data: vec![0; (width * height * 4) as usize] }
    }

    /// Alpha-blend `rgb` at `alpha` over the pixel at (x, y); off-image is ignored.
    fn blend(&mut self, x: i32, y: i32, rgb: [u8; 3], alpha: f32) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 || alpha <= 0.0 {
            return;
        }
        let i = ((y as u32 * self.width + x as u32) * 4) as usize;
        let a = alpha.min(1.0);
        let dst_a = self.data[i + 3] as f32 / 255.0;
        let out_a = a + dst_a * (1.0 - a);
        for (c, &src) in rgb.iter().enumerate() {
            let src = src as f32 / 255.0;
            let dst = self.data[i + c] as f32 / 255.0;
            let v = if out_a > 0.0 { (src * a + dst * dst_a * (1.0 - a)) / out_a } else { 0.0 };
            self.data[i + c] = (v * 255.0).round() as u8;
        }
        self.data[i + 3] = (out_a * 255.0).round() as u8;
    }

    /// Every alpha scaled by `f` (a stale icon at half strength).
    fn fade(&mut self, f: f32) {
        for px in self.data.chunks_exact_mut(4) {
            px[3] = (px[3] as f32 * f).round() as u8;
        }
    }

    /// The image as PNG bytes.
    pub fn png(&self) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        let img = image::RgbaImage::from_raw(self.width, self.height, self.data.clone()).expect("size matches");
        let _ = img.write_to(&mut out, image::ImageFormat::Png);
        out.into_inner()
    }

    /// Whether any pixel is visible.
    #[cfg(test)]
    pub fn is_blank(&self) -> bool {
        self.data.chunks_exact(4).all(|px| px[3] == 0)
    }
}

/// How a glyph is drawn. `color: None` is a template image (black; the
/// system tints it), `Some` a colour of its own. `template` is what the
/// renderer tells the tray: `color.is_none() && !dot`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Style {
    pub color: Option<[u8; 3]>,
    /// The badge dot in the top-right corner (red; makes the image non-template).
    pub dot: bool,
    /// 0..1: a thin fill along the bottom edge.
    pub progress: Option<f32>,
    pub stale: bool,
}

impl Style {
    /// Whether the tray should treat the image as a template.
    pub fn template(&self) -> bool {
        self.color.is_none() && !self.dot
    }
}

type CacheKey = (char, Option<[u8; 3]>, bool, Option<u32>, bool);

/// The glyph in `style`, from the cache. `None` when the font has no
/// outline for it (an emoji, any code point outside the symbol ranges).
pub fn render(glyph: char, style: &Style) -> Option<Arc<Rgba>> {
    static CACHE: LazyLock<Mutex<HashMap<CacheKey, Arc<Rgba>>>> = LazyLock::new(Mutex::default);
    // Progress is keyed at whole percents: a 1 Hz timer tick redraws, a jitter of a pixel does not.
    let key = (glyph, style.color, style.dot, style.progress.map(|p| (p.clamp(0.0, 1.0) * 100.0).round() as u32), style.stale);
    if let Some(hit) = crate::lock(&CACHE).get(&key) {
        return Some(hit.clone());
    }
    let img = Arc::new(draw(glyph, style)?);
    crate::lock(&CACHE).insert(key, img.clone());
    Some(img)
}

/// Whether the bundled font can draw `c`.
pub fn has_glyph(c: char) -> bool {
    FONT.as_ref().is_some_and(|f| f.glyph_id(c).0 != 0)
}

fn draw(glyph: char, style: &Style) -> Option<Rgba> {
    let font = FONT.as_ref()?;
    let id = font.glyph_id(glyph);
    if id.0 == 0 {
        return None;
    }
    let scaled = font.as_scaled(PxScale::from(GLYPH_PX));
    let g = id.with_scale_and_position(PxScale::from(GLYPH_PX), point(0.0, scaled.ascent()));
    let mut img = Rgba::blank(SIZE, SIZE);
    let rgb = style.color.unwrap_or([0, 0, 0]);
    if let Some(outline) = font.outline_glyph(g) {
        // Centre the ink in the square (a glyph's own advance leaves it off-centre otherwise).
        let b = outline.px_bounds();
        let dx = ((SIZE as f32 - (b.max.x - b.min.x)) / 2.0 - b.min.x).round() as i32;
        let dy = ((SIZE as f32 - (b.max.y - b.min.y)) / 2.0 - b.min.y).round() as i32;
        outline.draw(|x, y, c| img.blend(x as i32 + b.min.x as i32 + dx, y as i32 + b.min.y as i32 + dy, rgb, c));
    }
    if let Some(p) = style.progress {
        let p = p.clamp(0.0, 1.0);
        let fill = (SIZE as f32 * p).round() as u32;
        for y in SIZE - RULE..SIZE {
            for x in 0..SIZE {
                img.blend(x as i32, y as i32, rgb, if x < fill { 1.0 } else { 0.25 });
            }
        }
    }
    if style.stale {
        img.fade(STALE_ALPHA);
    }
    if style.dot {
        // Top-right, drawn after the fade: an alarm mark is never dim.
        let (cx, cy, r) = (SIZE as f32 - DOT / 2.0, DOT / 2.0, DOT / 2.0);
        for y in 0..SIZE {
            for x in 0..SIZE {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let a = (r - d + 0.5).clamp(0.0, 1.0);
                img.blend(x as i32, y as i32, RED, a);
            }
        }
    }
    Some(img)
}

/// An `{ image }` / `{ app }` icon as a `SIZE` square, decoded by the
/// core's icon cache: `icon://localhost/app?path=` and `favicon?url=`
/// through their PNG files, `data:image/...;base64,` inline, `{ app }` as
/// the bundle's artwork. Blocking (a favicon may fetch); `None` for
/// anything else or on failure.
pub fn image(icon: &serde_json::Value) -> Option<Rgba> {
    let png = image_png(icon)?;
    let img = image::load_from_memory(&png).ok()?.into_rgba8();
    let img = image::imageops::resize(&img, SIZE, SIZE, image::imageops::FilterType::Lanczos3);
    Some(Rgba { width: SIZE, height: SIZE, data: img.into_raw() })
}

/// The image bytes behind an `{ image }` / `{ app }` icon (see [`image`]):
/// a `data:` URI decoded, else the cached PNG file read.
pub fn image_png(icon: &serde_json::Value) -> Option<Vec<u8>> {
    if let Some(src) = icon.get("image").and_then(|s| s.as_str()).filter(|s| s.starts_with("data:image/")) {
        let (_, b64) = src.split_once(";base64,")?;
        use base64::Engine;
        return base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok();
    }
    std::fs::read(image_file(icon)?).ok()
}

/// A PNG file for an `{ app }`, `icon://` or `data:` icon (sketchybar
/// wants a path): the core's cache for the first two, a `SIZE` square
/// written next to them for a `data:` image, keyed on its bytes.
pub fn image_file(icon: &serde_json::Value) -> Option<std::path::PathBuf> {
    if let Some(app) = icon.get("app").and_then(|a| a.as_str()) {
        return pal_core::icons::app_icon(std::path::Path::new(app), SIZE).ok();
    }
    let src = icon.get("image")?.as_str()?;
    if src.starts_with("data:image/") {
        use std::hash::{Hash, Hasher};
        let mut h = std::hash::DefaultHasher::new();
        src.hash(&mut h);
        let path = pal_core::icons::cache_dir().join(format!("bar-{:016x}.png", h.finish()));
        if !path.is_file() {
            let img = image(icon)?;
            std::fs::create_dir_all(path.parent()?).ok()?;
            pal_core::fs::write_atomic(&path, img.png()).ok()?;
        }
        return Some(path);
    }
    let url = url::Url::parse(src).ok().filter(|u| u.scheme() == crate::icon::SCHEME)?;
    let param = |k: &str| url.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned());
    match url.path().trim_start_matches('/') {
        "app" => pal_core::icons::app_icon(std::path::Path::new(&param("path")?), SIZE).ok(),
        "favicon" => pal_core::icons::favicon(&param("url")?, SIZE).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_nerd_font_glyph_renders_to_a_png_and_an_emoji_does_not() {
        let img = render('\u{f09b}', &Style::default()).expect("github glyph is in the symbols font");
        assert_eq!((img.width, img.height), (SIZE, SIZE));
        assert!(!img.is_blank(), "ink landed");
        let png = img.png();
        assert!(png.starts_with(b"\x89PNG"), "a PNG comes out");
        assert!(png.len() > 100);
        assert!(has_glyph('\u{f0954}'), "a material design code point");
        assert!(render('🔔', &Style::default()).is_none(), "an emoji is the title text's, not the font's");
        assert!(!has_glyph('🔔'));
        assert!(render('a', &Style::default()).is_none(), "a plain letter is text too");
    }

    #[test]
    fn template_is_black_ink_and_colour_dot_and_progress_are_drawn_in() {
        let plain = render('\u{f09b}', &Style::default()).unwrap();
        assert!(plain.data.chunks_exact(4).filter(|p| p[3] > 0).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0), "a template image is black on transparent");
        assert!(Style::default().template());
        let red = Style { color: Some([0xe7, 0x82, 0x84]), ..Default::default() };
        assert!(!red.template());
        let coloured = render('\u{f09b}', &red).unwrap();
        assert!(coloured.data.chunks_exact(4).any(|p| p[3] > 200 && p[0] == 0xe7), "the colour is in the ink");
        let dotted = render('\u{f09b}', &Style { dot: true, ..Default::default() }).unwrap();
        assert!(!Style { dot: true, ..Default::default() }.template(), "a red dot cannot ride a template image");
        let corner = |img: &Rgba| { let i = ((2 * SIZE + SIZE - 3) * 4) as usize; [img.data[i], img.data[i + 1], img.data[i + 3]] };
        assert_eq!(corner(&plain)[2], 0, "nothing in the corner without a badge");
        assert_eq!(corner(&dotted), [RED[0], RED[1], 255], "the dot fills the top-right corner");
        let half = render('\u{f09b}', &Style { progress: Some(0.5), ..Default::default() }).unwrap();
        let bottom = |img: &Rgba, x: u32| img.data[(((SIZE - 1) * SIZE + x) * 4 + 3) as usize];
        assert_eq!(bottom(&half, 2), 255, "filled to the left of the mark");
        assert!(bottom(&half, SIZE - 2) < 100 && bottom(&half, SIZE - 2) > 0, "the track shows to its right");
        let stale = render('\u{f09b}', &Style { stale: true, ..Default::default() }).unwrap();
        let max = |img: &Rgba| img.data.chunks_exact(4).map(|p| p[3]).max().unwrap();
        assert!(max(&stale) <= max(&plain) / 2 + 1, "stale is half strength");
        assert!(Arc::ptr_eq(&render('\u{f09b}', &red).unwrap(), &coloured), "cached per glyph and style");
    }

    #[test]
    fn data_images_decode_and_other_icons_do_not() {
        let png = render('\u{f09b}', &Style::default()).unwrap().png();
        use base64::Engine;
        let uri = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
        let img = image(&serde_json::json!({ "image": uri })).expect("decodes");
        assert_eq!((img.width, img.height), (SIZE, SIZE));
        assert!(!img.is_blank());
        assert!(image(&serde_json::json!({ "image": "https://x/y.png" })).is_none(), "no network from the strip");
        assert!(image(&serde_json::json!("\u{f09b}")).is_none(), "a glyph is not an image");
        assert!(image_file(&serde_json::json!({ "image": "icon://localhost/clip?id=1&size=36" })).is_none(), "clipboard thumbnails are not icons");
    }
}
