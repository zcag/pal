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
//!
//! The title is a plain `NSString` too, so a look the title cannot carry
//! (`font = "mono"`, a `size`, a fixed `width`) prerenders the whole item
//! into one wide image ([`strip`]): the glyph square, then the text in the
//! system's own face read from `/System/Library/Fonts` (SF Pro, or SF Mono
//! for `mono`; Helvetica and Menlo as the fallbacks), a Nerd glyph inside
//! the text (a segment's icon) from the symbols font. The tray scales the
//! image to 18 pt high and keeps its aspect, so a 2x image of any width
//! lands at half its pixels in points.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};

static FONT_BYTES: &[u8] = include_bytes!("../../fonts/SymbolsNerdFontMono-Regular.ttf");
static FONT: LazyLock<Option<FontRef<'static>>> = LazyLock::new(|| FontRef::try_from_slice(FONT_BYTES).ok());

/// The system's text faces for a prerendered strip, read once from disk:
/// SF Pro and SF Mono (Helvetica and Menlo where a macOS lacks them);
/// `None` off macOS, where nothing prerenders.
static TEXT_FONTS: LazyLock<[Option<FontRef<'static>>; 2]> = LazyLock::new(|| {
    let load = |paths: &[&str]| {
        paths.iter().find_map(|p| {
            let bytes: &'static [u8] = Box::leak(std::fs::read(p).ok()?.into_boxed_slice());
            FontRef::try_from_slice_and_index(bytes, 0).ok()
        })
    };
    [load(&["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]), load(&["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"])]
});

/// The image's side in pixels: 18 pt at 2x.
pub const SIZE: u32 = 36;
/// The glyph's em size inside the square, leaving room for the badge dot
/// and the progress rule: 14 pt at 2x.
const GLYPH_PX: f32 = 28.0;
/// The text's em size in a strip: the bar's 13 pt at 2x.
const TEXT_PX: f32 = 26.0;
/// The badge dot's diameter (6 pt at 2x).
const DOT: f32 = 12.0;
/// The progress rule's height (2 pt at 2x).
const RULE: u32 = 4;
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
        for px in self.data.as_chunks_mut::<4>().0 {
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
        self.data.as_chunks::<4>().0.iter().all(|px| px[3] == 0)
    }
}

/// How a glyph is drawn. `color: None` is a template image (black; the
/// system tints it), `Some` a colour of its own. `template` is what the
/// renderer tells the tray: `color.is_none() && !dot`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Style {
    pub color: Option<[u8; 3]>,
    /// The badge dot in the top-right corner (red; makes the image non-template).
    pub dot: bool,
    /// 0..1: a thin fill along the bottom edge.
    pub progress: Option<f32>,
    /// 0..1: the ink's strength; a muted item at its `dim`.
    pub alpha: f32,
    /// The glyph's point size; `0` is the 14 pt default.
    pub size: f32,
}

impl Default for Style {
    fn default() -> Self {
        Self { color: None, dot: false, progress: None, alpha: 1.0, size: 0.0 }
    }
}

impl Style {
    /// Whether the tray should treat the image as a template.
    pub fn template(&self) -> bool {
        self.color.is_none() && !self.dot
    }

    /// The glyph's em size in pixels (2x), never past the square.
    fn glyph_px(&self) -> f32 {
        if self.size > 0.0 { (self.size * 2.0).min(SIZE as f32) } else { GLYPH_PX }
    }

    /// The cache key: progress at whole percents (a 1 Hz timer tick
    /// redraws, a jitter of a pixel does not), alpha likewise, size at tenths.
    fn key(&self) -> (Option<[u8; 3]>, bool, Option<u32>, u32, u32) {
        (self.color, self.dot, self.progress.map(|p| (p.clamp(0.0, 1.0) * 100.0).round() as u32), (self.alpha.clamp(0.0, 1.0) * 100.0).round() as u32, (self.size.max(0.0) * 10.0).round() as u32)
    }
}

type CacheKey = (char, Option<[u8; 3]>, bool, Option<u32>, u32, u32);
/// The glyph, the text and its face, spacing and width at tenths, the style.
type StripKey = (Option<char>, String, bool, u32, u32, CacheKey);

/// The glyph in `style`, from the cache. `None` when the font has no
/// outline for it (an emoji, any code point outside the symbol ranges).
pub fn render(glyph: char, style: &Style) -> Option<Arc<Rgba>> {
    static CACHE: LazyLock<Mutex<HashMap<CacheKey, Arc<Rgba>>>> = LazyLock::new(Mutex::default);
    let (c, d, p, a, s) = style.key();
    let key = (glyph, c, d, p, a, s);
    if let Some(hit) = crate::lock(&CACHE).get(&key) {
        return Some(hit.clone());
    }
    let img = Arc::new(draw(glyph, style)?);
    crate::lock(&CACHE).insert(key, img.clone());
    Some(img)
}

/// The text part of a prerendered strip.
#[derive(Debug, Clone, PartialEq)]
pub struct Text {
    pub text: String,
    /// `font = "mono"`.
    pub mono: bool,
    /// Points between the glyph square and the text.
    pub spacing: f32,
    /// A fixed width in points for the whole image; `0` is natural.
    pub width: f32,
}

/// Whether a strip can be prerendered here: the text face is on disk.
pub fn can_strip(mono: bool) -> bool {
    TEXT_FONTS[usize::from(mono)].is_some()
}

/// The whole item as one image: the glyph square (as [`render`] draws it,
/// badge and progress included; absent when `glyph` is `None`), the gap,
/// the text in the system face at `style.size` (13 pt when `0`), a Nerd
/// glyph inside the text from the symbols font. A fixed `width` clips
/// the text to it (an ellipsis is the caller's, `menubar::clip`). `None`
/// when no text face is on disk, or when nothing would be drawn.
pub fn strip(glyph: Option<char>, text: &Text, style: &Style) -> Option<Arc<Rgba>> {
    static CACHE: LazyLock<Mutex<HashMap<StripKey, Arc<Rgba>>>> = LazyLock::new(Mutex::default);
    let (c, d, p, a, s) = style.key();
    let key = (glyph, text.text.clone(), text.mono, (text.spacing * 10.0) as u32, (text.width * 10.0) as u32, (' ', c, d, p, a, s));
    if let Some(hit) = crate::lock(&CACHE).get(&key) {
        return Some(hit.clone());
    }
    let img = Arc::new(draw_strip(glyph, text, style)?);
    crate::lock(&CACHE).insert(key, img.clone());
    Some(img)
}

/// Whether the bundled font can draw `c`.
pub fn has_glyph(c: char) -> bool {
    FONT.as_ref().is_some_and(|f| f.glyph_id(c).0 != 0)
}

fn draw(glyph: char, style: &Style) -> Option<Rgba> {
    let font = FONT.as_ref()?;
    if font.glyph_id(glyph).0 == 0 {
        return None;
    }
    let mut img = Rgba::blank(SIZE, SIZE);
    square(&mut img, 0, Some(glyph), style, SIZE);
    Some(img)
}

/// The glyph square into `img` at `x0`: the glyph centred at
/// `style.glyph_px`, the progress rule along its bottom over `rule_w`
/// pixels, the fade, then the dot in its top-right corner. `None` glyph
/// draws the marks alone (a text-only strip).
fn square(img: &mut Rgba, x0: i32, glyph: Option<char>, style: &Style, rule_w: u32) {
    let rgb = style.color.unwrap_or([0, 0, 0]);
    if let (Some(font), Some(glyph)) = (FONT.as_ref(), glyph) {
        let px = style.glyph_px();
        let scaled = font.as_scaled(PxScale::from(px));
        let g = font.glyph_id(glyph).with_scale_and_position(PxScale::from(px), point(0.0, scaled.ascent()));
        if let Some(outline) = font.outline_glyph(g) {
            // Centre the ink in the square (a glyph's own advance leaves it off-centre otherwise).
            let b = outline.px_bounds();
            let dx = ((SIZE as f32 - (b.max.x - b.min.x)) / 2.0 - b.min.x).round() as i32 + x0;
            let dy = ((SIZE as f32 - (b.max.y - b.min.y)) / 2.0 - b.min.y).round() as i32;
            outline.draw(|x, y, c| img.blend(x as i32 + b.min.x as i32 + dx, y as i32 + b.min.y as i32 + dy, rgb, c));
        }
    }
    if let Some(p) = style.progress {
        let p = p.clamp(0.0, 1.0);
        let fill = (rule_w as f32 * p).round() as u32;
        for y in SIZE - RULE..SIZE {
            for x in 0..rule_w {
                img.blend(x as i32 + x0, y as i32, rgb, if x < fill { 1.0 } else { 0.25 });
            }
        }
    }
    if style.alpha < 1.0 {
        img.fade(style.alpha.max(0.0));
    }
    if style.dot {
        // Top-right of the whole image, drawn after the fade: an alarm mark is never dim.
        let (cx, cy, r) = (img.width as f32 - DOT / 2.0, DOT / 2.0, DOT / 2.0);
        let (x_from, x_to) = ((cx - DOT) as i32, img.width as i32);
        for y in 0..DOT as i32 + 1 {
            for x in x_from..x_to {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let a = (r - d + 0.5).clamp(0.0, 1.0);
                img.blend(x, y, RED, a);
            }
        }
    }
}

/// One run of text: each character in the text face, a symbol in the
/// Nerd font; the advance in pixels, and the ink when `img` is given.
fn text_run(text: &str, mono: bool, px: f32, mut img: Option<(&mut Rgba, i32, [u8; 3])>) -> Option<f32> {
    let face = TEXT_FONTS[usize::from(mono)].as_ref()?;
    let symbols = FONT.as_ref();
    let mut x = 0.0f32;
    for c in text.chars() {
        let font = match symbols {
            Some(f) if f.glyph_id(c).0 != 0 && face.glyph_id(c).0 == 0 => f,
            _ => face,
        };
        let scaled = font.as_scaled(PxScale::from(px));
        let id = font.glyph_id(c);
        if let Some((img, x0, rgb)) = img.as_mut() {
            // The text sits on a baseline that centres its ascent and descent in the square.
            let baseline = (SIZE as f32 + scaled.ascent() + scaled.descent()) / 2.0;
            let g = id.with_scale_and_position(PxScale::from(px), point(*x0 as f32 + x, baseline));
            if let Some(o) = font.outline_glyph(g) {
                let b = o.px_bounds();
                o.draw(|gx, gy, cov| img.blend(gx as i32 + b.min.x as i32, gy as i32 + b.min.y as i32, *rgb, cov));
            }
        }
        x += scaled.h_advance(id);
    }
    Some(x)
}

fn draw_strip(glyph: Option<char>, text: &Text, style: &Style) -> Option<Rgba> {
    let has_glyph = glyph.is_some_and(|c| FONT.as_ref().is_some_and(|f| f.glyph_id(c).0 != 0));
    let px = if style.size > 0.0 { style.size * 2.0 } else { TEXT_PX };
    let text_w = if text.text.is_empty() { 0.0 } else { text_run(&text.text, text.mono, px, None)? };
    if !has_glyph && text_w == 0.0 {
        return None;
    }
    let gap = if has_glyph && text_w > 0.0 { (text.spacing * 2.0).round() } else { 0.0 };
    let natural = (if has_glyph { SIZE as f32 } else { 0.0 }) + gap + text_w.ceil();
    let width = if text.width > 0.0 { (text.width * 2.0).round().max(4.0) } else { natural };
    let mut img = Rgba::blank(width as u32, SIZE);
    let rgb = style.color.unwrap_or([0, 0, 0]);
    let text_x = if has_glyph { SIZE as i32 + gap as i32 } else { 0 };
    if text_w > 0.0 {
        text_run(&text.text, text.mono, px, Some((&mut img, text_x, rgb)));
    }
    // The marks: the square's rule spans the glyph, or the whole width without one; the dot rides the image's corner.
    let marks = Style { dot: false, ..*style };
    square(&mut img, 0, glyph.filter(|_| has_glyph), &marks, if has_glyph { SIZE } else { width as u32 });
    if style.dot {
        square(&mut img, 0, None, &Style { progress: None, alpha: 1.0, ..*style }, 0);
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
        assert!(plain.data.as_chunks::<4>().0.iter().filter(|p| p[3] > 0).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0), "a template image is black on transparent");
        assert!(Style::default().template());
        let red = Style { color: Some([0xe7, 0x82, 0x84]), ..Default::default() };
        assert!(!red.template());
        let coloured = render('\u{f09b}', &red).unwrap();
        assert!(coloured.data.as_chunks::<4>().0.iter().any(|p| p[3] > 200 && p[0] == 0xe7), "the colour is in the ink");
        let dotted = render('\u{f09b}', &Style { dot: true, ..Default::default() }).unwrap();
        assert!(!Style { dot: true, ..Default::default() }.template(), "a red dot cannot ride a template image");
        let corner = |img: &Rgba| { let i = ((2 * SIZE + SIZE - 3) * 4) as usize; [img.data[i], img.data[i + 1], img.data[i + 3]] };
        assert_eq!(corner(&plain)[2], 0, "nothing in the corner without a badge");
        assert_eq!(corner(&dotted), [RED[0], RED[1], 255], "the dot fills the top-right corner");
        let half = render('\u{f09b}', &Style { progress: Some(0.5), ..Default::default() }).unwrap();
        let bottom = |img: &Rgba, x: u32| img.data[(((SIZE - 1) * SIZE + x) * 4 + 3) as usize];
        assert_eq!(bottom(&half, 2), 255, "filled to the left of the mark");
        assert!(bottom(&half, SIZE - 2) < 100 && bottom(&half, SIZE - 2) > 0, "the track shows to its right");
        let stale = render('\u{f09b}', &Style { alpha: 0.5, ..Default::default() }).unwrap();
        let max = |img: &Rgba| img.data.as_chunks::<4>().0.iter().map(|p| p[3]).max().unwrap();
        assert!(max(&stale) <= max(&plain) / 2 + 1, "a muted item is drawn at its dim");
        assert!(max(&render('\u{f09b}', &Style { alpha: 0.2, ..Default::default() }).unwrap()) <= max(&plain) / 5 + 1);
        assert!(Arc::ptr_eq(&render('\u{f09b}', &red).unwrap(), &coloured), "cached per glyph and style");
        let inked = |img: &Rgba| img.data.as_chunks::<4>().0.iter().filter(|p| p[3] > 128).count();
        let small = render('\u{f09b}', &Style { size: 9.0, ..Default::default() }).unwrap();
        let big = render('\u{f09b}', &Style { size: 17.0, ..Default::default() }).unwrap();
        assert!(inked(&small) < inked(&plain) && inked(&plain) < inked(&big), "size scales the glyph: {} < {} < {}", inked(&small), inked(&plain), inked(&big));
        assert_eq!((big.width, big.height), (SIZE, SIZE), "never past the square");
    }

    #[test]
    fn a_strip_prerenders_the_text_beside_the_glyph() {
        if !can_strip(false) {
            eprintln!("no system text face here: the strip is a menu bar thing");
            return;
        }
        let text = Text { text: "3:12".into(), mono: false, spacing: 4.0, width: 0.0 };
        let img = strip(Some('\u{f09b}'), &text, &Style::default()).expect("a strip");
        assert_eq!(img.height, SIZE);
        assert!(img.width > SIZE + 8 + 30, "the glyph square, the gap and four characters: {}", img.width);
        let col = |img: &Rgba, x: u32| (0..SIZE).map(|y| img.data[((y * img.width + x) * 4 + 3) as usize]).max().unwrap();
        assert!((0..SIZE).any(|x| col(&img, x) > 0), "the glyph is inked");
        assert!((SIZE..SIZE + 8).all(|x| col(&img, x) == 0), "the gap is clear");
        assert!((SIZE + 8..img.width).any(|x| col(&img, x) > 200), "the text is inked");
        assert!(img.data.as_chunks::<4>().0.iter().filter(|p| p[3] > 0).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0), "still a template: black ink");
        let mono = strip(Some('\u{f09b}'), &Text { mono: true, ..text.clone() }, &Style::default()).unwrap();
        assert_ne!(mono.width, img.width, "SF Mono sets the digits wider than SF Pro");
        let wide = strip(Some('\u{f09b}'), &Text { mono: true, ..text.clone() }, &Style::default()).unwrap();
        assert!(Arc::ptr_eq(&mono, &wide), "cached");
        let fixed = strip(Some('\u{f09b}'), &Text { width: 40.0, ..text.clone() }, &Style::default()).unwrap();
        assert_eq!(fixed.width, 80, "a fixed width in points, at 2x");
        let ticked = strip(Some('\u{f09b}'), &Text { text: "3:11".into(), width: 40.0, ..text.clone() }, &Style::default()).unwrap();
        assert_eq!(ticked.width, fixed.width, "a tick does not move the neighbours");
        let text_only = strip(None, &text, &Style { dot: true, progress: Some(0.5), ..Default::default() }).unwrap();
        assert!(text_only.width < img.width, "no glyph square");
        let corner = text_only.data[((2 * text_only.width + text_only.width - 3) * 4) as usize..][..4].to_vec();
        assert_eq!((corner[0], corner[3]), (RED[0], 255), "the dot rides the image's corner");
        let bottom = |x: u32| text_only.data[(((SIZE - 1) * text_only.width + x) * 4 + 3) as usize];
        assert_eq!(bottom(1), 255, "the rule spans the text without a glyph");
        assert!(bottom(text_only.width - 2) < 100);
        let big = strip(Some('\u{f09b}'), &text, &Style { size: 16.0, ..Default::default() }).unwrap();
        assert!(big.width > img.width, "size scales the text");
        assert!(strip(None, &Text { text: String::new(), ..text.clone() }, &Style::default()).is_none(), "nothing to draw");
        assert!(strip(Some('🔔'), &Text { text: String::new(), ..text }, &Style::default()).is_none(), "an emoji is not the font's");
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
