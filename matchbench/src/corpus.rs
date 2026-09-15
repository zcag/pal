//! The item corpus as pal's fixtures ship it, plus the per-field text the
//! matchers index. Loaded once; the engines borrow it.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    pub palette: String,
}

impl Item {
    /// The haystack the webview builds today (`Launcher.tsx`): name, subtitle,
    /// keywords joined by one space. Positions index this string.
    pub fn haystack(&self) -> String {
        let mut s = self.name.clone();
        if let Some(sub) = &self.subtitle {
            s.push(' ');
            s.push_str(sub);
        }
        for k in self.keywords.iter().flatten() {
            s.push(' ');
            s.push_str(k);
        }
        s
    }
}

pub fn load(path: &str) -> Vec<Item> {
    let text = std::fs::read_to_string(path).expect("read corpus");
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse row"))
        .collect()
}

/// One ranked result as it would cross IPC to the webview: what the list
/// renders plus the score and the highlight positions (char indexes).
#[derive(Serialize)]
pub struct Hit<'a> {
    pub id: &'a str,
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<&'a str>,
    pub palette: &'a str,
    pub score: u32,
    pub name_pos: Vec<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sub_pos: Vec<u32>,
}

/// Highlight positions split per field, as the UI wants them.
#[derive(Default, Clone)]
pub struct Positions {
    pub name: Vec<u32>,
    pub subtitle: Vec<u32>,
}

impl Positions {
    /// Map positions over the joined haystack back onto name and subtitle,
    /// the same split `Launcher.tsx` does.
    pub fn from_haystack(item: &Item, pos: &[u32]) -> Self {
        let name_len = item.name.chars().count() as u32;
        let sub_len = item.subtitle.as_ref().map_or(0, |s| s.chars().count() as u32);
        let sub_start = name_len + 1;
        let mut out = Self::default();
        for &p in pos {
            if p < name_len {
                out.name.push(p);
            } else if sub_len > 0 && p >= sub_start && p < sub_start + sub_len {
                out.subtitle.push(p - sub_start);
            }
        }
        out
    }
}
