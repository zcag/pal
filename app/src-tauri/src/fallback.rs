//! The root's fallback rows: what the typed query can still do when the
//! index has nothing for it (or under the hits with
//! `general.fallbacks_always`). Three kinds, ordered by `general.fallbacks`:
//! the shell's own two rows of the synthetic source `pal/fallback` ("Search
//! the web" through `general.search_engine`, "Open as URL" when the query
//! reads as one), an "Ask <palette>" row for every enabled palette whose
//! meta says `fallback: "ask"` (its title template with `{query}` filled;
//! the row carries a `push` with the query, which the page opens without a
//! round trip), and the rows a palette answers itself (`fallback: "rows"`,
//! the host's `fallback` request: quicklinks fills its `{query}` links).
//!
//! `pal/fallback` is never in the index: `rows` builds per query, the page
//! asks `fallback` after the local hits painted, and a pick on one of its
//! rows lands in `pick` here (the id says which). Nothing here is
//! remembered by frecency (`inert`): a row that changes with every query
//! has no history worth keeping.

use pal_core::config::Config;
use pal_core::index::{Hit, Item, Source};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use std::sync::Arc;

use crate::host::Host;
use crate::index::HitView;
use crate::registry::{palette_id, Palettes};
use crate::{effects, settings};

pub const WEB: &str = "web";
pub const URL: &str = "url";
/// The id of every "Ask <palette>" row (its source is the palette's); the
/// page opens the palette from the row's `push` and never picks it.
pub const ASK_ID: &str = "pal:ask";
/// The query is cut to this many chars in the section title.
const TITLE_QUERY_MAX: usize = 32;
/// nf-md-magnify, nf-md-link_variant: the two shell rows' glyphs.
const WEB_ICON: &str = "\u{f0349}";
const URL_ICON: &str = "\u{f0339}";

pub fn source() -> Source {
    Source::new("pal", "fallback")
}

/// Whether a pick on this row is not worth remembering: every row of the
/// shell's source, and every ask row.
pub fn inert(source: &Source, id: &str) -> bool {
    *source == self::source() || id == ASK_ID
}

/// The section title the rows go under: Raycast's "Use “q” with…".
pub fn group(q: &str) -> String {
    let q = q.trim();
    let short: String = q.chars().take(TITLE_QUERY_MAX).collect();
    format!("Use “{short}{}” with", if short.len() < q.len() { "…" } else { "" })
}

/// `template` with `{query}` percent-encoded into it (form encoding: a
/// space is `+`, what every search engine reads); a template without the
/// placeholder gets the query appended.
pub fn web_url(template: &str, q: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(q.trim().as_bytes()).collect();
    if template.contains("{query}") {
        template.replace("{query}", &encoded)
    } else {
        format!("{template}{encoded}")
    }
}

/// The URL the query names, when it reads as one: a scheme and `://` as
/// typed; `localhost` or a dotted host with a letters-only last label of
/// two or more (`example.com`, `docs.rs/serde`, `host:8080/x`) under
/// `https://`. Never with a space, never a bare word or a number
/// (`3.14`), never something with `@` (an email is not a page).
pub fn as_url(q: &str) -> Option<String> {
    let q = q.trim();
    if q.is_empty() || q.chars().any(char::is_whitespace) || q.contains('@') {
        return None;
    }
    match q.find("://") {
        Some(i) => {
            let scheme = &q[..i];
            let ok = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
            ok.then(|| q.to_string())
        }
        None => plain_host(q),
    }
}

/// [`as_url`] for the scheme-less form.
fn plain_host(q: &str) -> Option<String> {
    let end = q.find(['/', ':', '?', '#']).unwrap_or(q.len());
    let host = &q[..end];
    let labels: Vec<&str> = host.split('.').collect();
    let label_ok = |l: &str| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !l.starts_with('-') && !l.ends_with('-');
    let hostish = host == "localhost" || (labels.len() >= 2 && labels.iter().all(|l| label_ok(l)) && labels.last().is_some_and(|t| t.len() >= 2 && t.chars().all(|c| c.is_ascii_alphabetic())));
    if !hostish {
        return None;
    }
    // A port must be digits; anything after the host is taken as typed.
    if let Some(rest) = q[end..].strip_prefix(':') {
        if !rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return None;
        }
    }
    Some(format!("https://{q}"))
}

fn row(id: &str, name: &str, subtitle: Option<String>, icon: Value, extra: serde_json::Map<String, Value>) -> Item {
    Item { id: id.into(), name: name.into(), subtitle, keywords: Vec::new(), icon: Some(icon), section: None, extra }
}

fn view(source: Source, item: Item, group: &str) -> HitView {
    let mut v = HitView::new(Hit { source, id: item.id.clone(), score: 0.0, name_positions: Vec::new() }, item);
    v.set_group(group);
    v
}

/// One candidate section: its id in `general.fallbacks` (`web`, `url`, a
/// palette id) and its rows.
pub type Candidate = (String, Vec<HitView>);

/// The shell's rows for `q`: the web search (always), the URL (when it
/// reads as one). Keyed `web` and `url`.
pub fn shell_rows(q: &str, config: &Config) -> Vec<Candidate> {
    let g = group(q);
    let mut out = Vec::new();
    let engine = web_url(&config.general.search_engine, q);
    let host = url::Url::parse(&engine).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()));
    let mut extra = serde_json::Map::new();
    extra.insert("url".into(), json!(engine));
    extra.insert("actions".into(), json!([{ "id": "open", "title": "Search" }]));
    out.push((WEB.to_string(), vec![view(source(), row(WEB, "Search the web", host, json!(WEB_ICON), extra), &g)]));
    if let Some(url) = as_url(q) {
        let mut extra = serde_json::Map::new();
        extra.insert("url".into(), json!(url));
        extra.insert("actions".into(), json!([{ "id": "open", "title": "Open in browser" }]));
        out.push((URL.to_string(), vec![view(source(), row(URL, "Open as URL", Some(url.clone()), json!(URL_ICON), extra), &g)]));
    }
    out
}

/// The ask row's title: the palette's template with `{query}` filled, else "Ask <title>".
pub fn ask_title(template: Option<&str>, title: &str, q: &str) -> String {
    match template.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => t.replace("{query}", q.trim()),
        None => format!("Ask {title}"),
    }
}

/// The "Ask <palette>" rows: every enabled palette with `fallback: "ask"`,
/// keyed by its config id, in registry order. The row's `push` carries the
/// query in; the subtitle says what will be typed.
pub fn ask_rows(app: &AppHandle, q: &str) -> Vec<Candidate> {
    let g = group(q);
    Palettes::with(app, |reg| {
        reg.iter()
            .filter(|r| r.enabled && r.meta.fallback.as_deref() == Some("ask"))
            .map(|r| {
                let mut extra = serde_json::Map::new();
                extra.insert("push".into(), json!({ "extension": r.source.extension, "palette": r.source.palette, "query": q.trim() }));
                let name = ask_title(r.meta.fallback_title.as_deref(), &r.meta.title, q);
                let subtitle = if name.contains(q.trim()) { r.ext_title.clone() } else { format!("“{}” in {}", q.trim(), r.meta.title) };
                let item = row(ASK_ID, &name, Some(subtitle), r.meta.icon.clone().unwrap_or(json!(r.meta.title.chars().next().unwrap_or('?').to_string())), extra);
                (palette_id(&r.source), vec![view(r.source.clone(), item, &g)])
            })
            .collect()
    })
}

/// `cands` in the order `general.fallbacks` names them (an id it names
/// that no candidate has is skipped), then the rest as they came.
pub fn order(mut cands: Vec<Candidate>, fallbacks: &[String]) -> Vec<HitView> {
    let mut out = Vec::new();
    for id in fallbacks {
        if let Some(i) = cands.iter().position(|(c, _)| c == id.trim()) {
            out.extend(cands.remove(i).1);
        }
    }
    for (_, rows) in cands {
        out.extend(rows);
    }
    out
}

/// Every fallback row for `q`, ordered: the shell's, the ask rows, and
/// what the palettes with `fallback: "rows"` answered (the host, one
/// request, each palette on its own timeout there). Empty for an empty
/// query.
#[tauri::command]
pub async fn fallback(app: AppHandle, q: String, host: State<'_, Arc<Host>>) -> Result<Vec<HitView>, String> {
    if q.trim().is_empty() {
        return Ok(Vec::new());
    }
    let config = settings::config(&app);
    let mut cands = shell_rows(&q, &config);
    cands.extend(ask_rows(&app, &q));
    let asks = Palettes::with(&app, |reg| reg.iter().any(|r| r.enabled && r.meta.fallback.as_deref() == Some("rows")));
    if asks {
        let g = group(&q);
        match host.request("fallback", json!({ "query": q })).await {
            Ok(v) => {
                for sec in v.as_array().cloned().unwrap_or_default() {
                    let (Some(ext), Some(pal)) = (sec["extension"].as_str(), sec["palette"].as_str()) else { continue };
                    let source = Source::new(ext, pal);
                    let items: Vec<Item> = serde_json::from_value(sec["items"].clone()).unwrap_or_default();
                    cands.push((palette_id(&source), items.into_iter().map(|i| view(source.clone(), i, &g)).collect()));
                }
            }
            Err(e) => eprintln!("fallback\thost failed\t{e}"),
        }
    }
    Ok(order(cands, &config.general.fallbacks))
}

/// A pick on one of the shell's rows: the web search or the URL, opened.
pub async fn pick(app: &AppHandle, id: &str, query: &str) -> Result<Value, String> {
    let config = settings::config(app);
    let target = match id {
        WEB => web_url(&config.general.search_engine, query),
        URL => as_url(query).ok_or_else(|| format!("{query:?} is not a URL"))?,
        _ => return Ok(json!({ "keep": true })),
    };
    eprintln!("fallback\t{id}\t{target}");
    effects::apply(app, json!({ "open": target })).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_url_encodes_the_query_into_the_template() {
        assert_eq!(web_url("https://www.google.com/search?q={query}", "pal launcher"), "https://www.google.com/search?q=pal+launcher");
        assert_eq!(web_url("https://duckduckgo.com/?q={query}", " a&b=c "), "https://duckduckgo.com/?q=a%26b%3Dc");
        assert_eq!(web_url("https://kagi.com/search?q=", "x"), "https://kagi.com/search?q=x", "no placeholder: appended");
        assert_eq!(web_url("https://x.com/{query}/{query}", "é"), "https://x.com/%C3%A9/%C3%A9", "every placeholder");
    }

    #[test]
    fn urls_are_recognised_and_completed() {
        assert_eq!(as_url("https://example.com/a?b").as_deref(), Some("https://example.com/a?b"));
        assert_eq!(as_url("pal://open?q=x").as_deref(), Some("pal://open?q=x"), "any scheme as typed");
        assert_eq!(as_url("example.com").as_deref(), Some("https://example.com"));
        assert_eq!(as_url("docs.rs/serde").as_deref(), Some("https://docs.rs/serde"));
        assert_eq!(as_url("localhost:8080/x").as_deref(), Some("https://localhost:8080/x"));
        assert_eq!(as_url("sub.host.co.uk:443").as_deref(), Some("https://sub.host.co.uk:443"));
        for not in ["chrome", "3.14", "a b.com", "me@example.com", "foo.", ".com", "host:port", "-a.com", "1.2.3.4x"] {
            assert_eq!(as_url(not), None, "{not}");
        }
        assert_eq!(as_url("1.2.3.4"), None, "an address wants a scheme (the last label is digits)");
        assert_eq!(as_url("://x"), None);
    }

    #[test]
    fn shell_rows_are_the_web_search_and_the_url_when_it_is_one() {
        let c = Config::default();
        let rows = shell_rows("hello world", &c);
        assert_eq!(rows.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), [WEB]);
        let web = &rows[0].1[0];
        let v = serde_json::to_value(web).unwrap();
        assert_eq!(v["source"], json!({ "extension": "pal", "palette": "fallback" }));
        assert_eq!(v["id"], WEB);
        assert_eq!(v["item"]["name"], "Search the web");
        assert_eq!(v["item"]["subtitle"], "google.com", "the engine's host");
        assert_eq!(v["item"]["url"], "https://www.google.com/search?q=hello+world");
        assert_eq!(v["item"]["actions"][0]["title"], "Search", "the footer names what Enter does");
        assert_eq!(v["group"], "Use “hello world” with");
        let rows = shell_rows("docs.rs/serde", &c);
        assert_eq!(rows.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), [WEB, URL]);
        let url = serde_json::to_value(&rows[1].1[0]).unwrap();
        assert_eq!(url["item"]["name"], "Open as URL");
        assert_eq!(url["item"]["subtitle"], "https://docs.rs/serde");
        assert_eq!(url["item"]["url"], "https://docs.rs/serde");
        // A long query is cut in the section title, not in the rows.
        let long = "x".repeat(60);
        assert_eq!(group(&long), format!("Use “{}…” with", "x".repeat(TITLE_QUERY_MAX)));
        assert!(inert(&source(), WEB) && inert(&Source::new("calc", "calc"), ASK_ID) && !inert(&Source::new("calc", "calc"), "result"));
    }

    #[test]
    fn ask_titles_fill_the_template_or_say_ask() {
        assert_eq!(ask_title(None, "Calculator", " 2+2 "), "Ask Calculator");
        assert_eq!(ask_title(Some("Search Files for “{query}”"), "Files", "tax"), "Search Files for “tax”");
        assert_eq!(ask_title(Some("  "), "Files", "tax"), "Ask Files", "a blank template is none");
    }

    #[test]
    fn order_follows_the_config_then_load_order() {
        let c = Config::default();
        let one = |id: &str| -> Candidate { (id.to_string(), vec![view(source(), row(id, id, None, json!("x"), Default::default()), "g")]) };
        let ids = |rows: &[HitView]| rows.iter().map(|h| h.item_id().to_string()).collect::<Vec<_>>();
        let cands = || vec![one("files"), one("web"), one("docker"), one("calc"), one("url")];
        assert_eq!(ids(&order(cands(), &["calc".into(), "missing".into(), " web ".into()])), ["calc", "web", "files", "docker", "url"], "named first (trimmed, a missing id skipped), then as they came");
        assert_eq!(ids(&order(cands(), &[])), ["files", "web", "docker", "calc", "url"]);
        assert_eq!(pal_core::config::DEFAULT_FALLBACKS, [WEB, URL, "quicklinks", "calc", "files"]);
        assert_eq!(c.general.fallbacks, pal_core::config::DEFAULT_FALLBACKS.map(String::from).to_vec());
    }
}
