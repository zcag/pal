//! `BarColor` (the tag palette plus `text`, `muted`, `accent`,
//! `destructive`) as RGB, exported once from `app/src/ui/tokens.css` for
//! the light and the dark theme; a test keeps the two in step. The
//! sketchybar renderer wants `0xAARRGGBB`, the menu bar an RGB triple for
//! the glyph ink.

use std::collections::BTreeMap;

pub const NAMES: [&str; 12] = ["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "text", "muted", "accent", "destructive"];

const LIGHT: [u32; 12] = [0x55565F, 0x2457B0, 0x1B6B40, 0x874C00, 0xB02925, 0x5B39C2, 0xA0286A, 0x0B6664, 0x1A1A1F, 0x5C5D66, 0x4F46D6, 0xC02B27];
const DARK: [u32; 12] = [0xA3A4AE, 0x7FB0FF, 0x5CCB8E, 0xF0B25A, 0xFF8A82, 0xB39DFF, 0xF08CC0, 0x5FCFCB, 0xECECF0, 0xA3A4AE, 0x9F97FF, 0xFF6E66];

/// The map for one theme, with the config's `[bar.sketchybar.colors]`
/// overrides (`0xAARRGGBB`, `#rrggbb` or `rrggbb`) on top.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Palette {
    map: BTreeMap<&'static str, u32>,
    /// A subtle neutral hover wash, not an extension-facing colour role.
    hover: u32,
}

impl Palette {
    pub fn new(dark: bool, overrides: &BTreeMap<String, String>) -> Self {
        let base = if dark { &DARK } else { &LIGHT };
        let mut map: BTreeMap<&'static str, u32> = NAMES.iter().copied().zip(base.iter().map(|c| 0xFF00_0000 | c)).collect();
        for (name, value) in overrides {
            if let (Some(n), Some(v)) = (NAMES.iter().find(|n| *n == name), parse(value)) {
                map.insert(n, v);
            }
        }
        // Alpha composited over the owner's bar: dark gets a white lift,
        // light a black shade. The target's own palette remains in charge
        // of every semantic item colour.
        Self { map, hover: if dark { 0x26FF_FFFF } else { 0x1400_0000 } }
    }

    /// `0xAARRGGBB` for a colour name; `None` for a name the model does not have.
    pub fn argb(&self, name: &str) -> Option<u32> {
        self.map.get(name).copied()
    }

    /// `0xAARRGGBB` for a colour spec: a name of the map, else a hex
    /// spelling (`#rrggbb`, `0xAARRGGBB`); `None` for anything else.
    pub fn resolve(&self, spec: &str) -> Option<u32> {
        self.argb(spec).or_else(|| parse(spec))
    }

    /// The sketchybar spelling of a spec (see [`resolve`](Self::resolve)).
    pub fn hex_of(&self, spec: &str) -> Option<String> {
        self.resolve(spec).map(|c| format!("0x{c:08x}"))
    }

    /// The RGB triple of a spec (see [`resolve`](Self::resolve)), for the glyph rasteriser.
    pub fn rgb_of(&self, spec: &str) -> Option<[u8; 3]> {
        self.resolve(spec).map(|c| [(c >> 16) as u8, (c >> 8) as u8, c as u8])
    }

    /// The muted colour at `dim` percent: the map's `muted` (a token grey,
    /// or the bar's own through `[bar.sketchybar.colors]`) with its alpha
    /// scaled, the sketchybar spelling. This is what `[bar.menubar] dim`
    /// means on sketchybar, where a colour carries its own alpha.
    pub fn muted_hex(&self, dim: u32) -> String {
        let c = self.argb("muted").unwrap_or(0xFFA3_A4AE);
        let a = ((c >> 24) as f32 * dim.min(100) as f32 / 100.0).round() as u32;
        format!("0x{:08x}", (a << 24) | (c & 0x00FF_FFFF))
    }

    /// The sketchybar spelling, `0xffrrggbb`.
    pub fn hex(&self, name: &str) -> Option<String> {
        self.argb(name).map(|c| format!("0x{c:08x}"))
    }

    /// The sketchybar spelling of the transient hover wash.
    pub fn hover_hex(&self) -> String {
        format!("0x{:08x}", self.hover)
    }

}

/// `0xAARRGGBB`, `0xRRGGBB` (opaque), `#RRGGBB`, `RRGGBB`.
fn parse(s: &str) -> Option<u32> {
    let s = s.trim();
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).or_else(|| s.strip_prefix('#')).unwrap_or(s);
    let v = u32::from_str_radix(hex, 16).ok()?;
    match hex.len() {
        8 => Some(v),
        6 => Some(0xFF00_0000 | v),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The value of `--pal-<name>` inside the block between the two markers of tokens.css.
    fn token(css: &str, begin: &str, end: &str, name: &str) -> u32 {
        let block = &css[css.find(begin).unwrap()..css.find(end).unwrap()];
        let line = block.lines().find(|l| l.trim_start().starts_with(&format!("--pal-{name}:"))).unwrap_or_else(|| panic!("no --pal-{name} in {begin}"));
        let hex = line.split('#').nth(1).unwrap().trim_end_matches(';').trim();
        u32::from_str_radix(hex, 16).unwrap()
    }

    #[test]
    fn the_maps_match_tokens_css() {
        let css = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/ui/tokens.css")).unwrap();
        let var = |n: &str| match n { "text" => "fg".to_string(), "muted" => "fg-muted".into(), "accent" | "destructive" => n.into(), tag => format!("tag-{tag}") };
        for (i, n) in NAMES.iter().enumerate() {
            assert_eq!(LIGHT[i], token(&css, "light-begin", "light-end", &var(n)), "light {n}");
            assert_eq!(DARK[i], token(&css, "dark-begin", "dark-end", &var(n)), "dark {n}");
        }
    }

    #[test]
    fn overrides_and_spellings() {
        let p = Palette::new(true, &BTreeMap::new());
        assert_eq!(p.hex("red").as_deref(), Some("0xffff8a82"));
        assert_eq!(p.rgb_of("text"), Some([0xEC, 0xEC, 0xF0]));
        assert_eq!(p.hex("nope"), None);
        let o = BTreeMap::from([("red".to_string(), "0xffe78284".to_string()), ("muted".into(), "#737994".into()), ("bogus".into(), "0xff000000".into()), ("blue".into(), "zzz".into())]);
        let p = Palette::new(false, &o);
        assert_eq!(p.hex("red").as_deref(), Some("0xffe78284"), "a Catppuccin bar keeps its red");
        assert_eq!(p.hex("muted").as_deref(), Some("0xff737994"), "#rrggbb is opaque");
        assert_eq!(p.hex("blue").as_deref(), Some("0xff2457b0"), "junk keeps the token");
        assert_eq!(p.hex("bogus"), None, "an unknown name adds nothing");
        assert_eq!(parse("0x80ff0000"), Some(0x80ff0000));
        assert_eq!(parse("abc"), None);
        assert_eq!(p.hex_of("red").as_deref(), Some("0xffe78284"), "a name resolves through the map");
        assert_eq!(p.hex_of("#ff8800").as_deref(), Some("0xffff8800"), "a hex spelling is a colour of its own");
        assert_eq!(p.rgb_of("0x80102030"), Some([0x10, 0x20, 0x30]));
        assert_eq!(p.resolve("orange"), None, "not a name, not hex");
        assert_eq!(p.muted_hex(50), "0x80737994", "the muted override at half alpha");
        assert_eq!(Palette::new(true, &BTreeMap::new()).muted_hex(100), "0xffa3a4ae");
        assert_eq!(Palette::new(true, &BTreeMap::new()).muted_hex(0), "0x00a3a4ae");
    }
}
