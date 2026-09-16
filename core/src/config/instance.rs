//! Instance keys (`docs/design/instances.md`): one extension, several
//! configured copies. The default instance is the extension's bare name;
//! another is `<name>@<suffix>`, the one identity string every table, file
//! and link uses for it. These are the pure helpers on that string.

use std::collections::BTreeSet;

/// Longest suffix (`[a-z0-9][a-z0-9_-]{0,31}`).
pub const MAX_SUFFIX: usize = 32;

/// A manifest name (the directory, the config key): lowercase letters,
/// digits, `-`, `_`, `.`; not starting with a dot; no `@`.
pub fn valid_name(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('.') && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_' || b == b'.')
}

/// An instance suffix: `[a-z0-9][a-z0-9_-]{0,31}`, and never `default`
/// (the default instance is the bare name).
pub fn valid_suffix(s: &str) -> bool {
    let mut bytes = s.bytes();
    let first = bytes.next().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    first && s.len() <= MAX_SUFFIX && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_') && s != "default"
}

/// `<name>@<suffix>` into its parts; a bare name has no suffix. Only the
/// first `@` splits, so a second one lands in the suffix and fails
/// [`is_key`].
pub fn split(key: &str) -> (&str, Option<&str>) {
    match key.split_once('@') {
        Some((name, suffix)) => (name, Some(suffix)),
        None => (key, None),
    }
}

/// The extension's name behind a key: `gmail` for `gmail@work` and for `gmail`.
pub fn name_of(key: &str) -> &str {
    split(key).0
}

/// Whether `s` is a well-formed non-default instance key: a valid name, one
/// `@`, a valid suffix.
pub fn is_key(s: &str) -> bool {
    matches!(split(s), (name, Some(suffix)) if valid_name(name) && valid_suffix(suffix))
}

/// The palette's key in the config file, `[palettes.<id>]`: the instance
/// key when the palette is named like the extension's *name* (`emoji`,
/// `gmail@work` for the `gmail` palette of `gmail@work`), else
/// `<key>-<palette>` (`clipboard-history`, `gmail@work-inbox`). Readable in
/// the file and needs no quoting without an `@`; the registry resolves it
/// back, so a clash between a hyphenated extension name and a palette is
/// the one case it cannot tell apart.
pub fn palette_id(key: &str, palette: &str) -> String {
    if name_of(key) == palette {
        key.to_string()
    } else {
        format!("{key}-{palette}")
    }
}

/// The ids of the setting specs a non-default instance never inherits from
/// the default's table: `kind: "secret"` (a token identifies the account)
/// and `scope: "instance"` (a Home Assistant `url`, a Slack `workspace`).
pub fn private_ids(specs: &serde_json::Value) -> BTreeSet<&str> {
    specs.as_array().into_iter().flatten().filter(|s| s["kind"] == "secret" || s["scope"] == "instance").filter_map(|s| s["id"].as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_name_of_and_is_key() {
        assert_eq!(split("gmail"), ("gmail", None));
        assert_eq!(split("gmail@work"), ("gmail", Some("work")));
        assert_eq!(split("gmail@w@x"), ("gmail", Some("w@x")), "only the first @ splits");
        assert_eq!(name_of("gmail@work"), "gmail");
        assert_eq!(name_of("home-assistant@flat_2"), "home-assistant");
        assert_eq!(name_of("gmail"), "gmail");
        for ok in ["gmail@work", "home-assistant@flat_2", "a@b", "x.y@0-a"] {
            assert!(is_key(ok), "{ok}");
        }
        for bad in ["gmail", "gmail@", "@work", "gmail@w@x", "gmail@Work", "gmail@-work", "gmail@default", "Gmail@work", ".g@work", "gmail@wörk", "gmail@a.b"] {
            assert!(!is_key(bad), "{bad}");
        }
        assert!(is_key(&format!("g@{}", "a".repeat(MAX_SUFFIX))));
        assert!(!is_key(&format!("g@{}", "a".repeat(MAX_SUFFIX + 1))), "a suffix has a length");
        assert!(valid_name("home-assistant") && valid_name("a.b_c") && !valid_name(".hidden") && !valid_name("") && !valid_name("g@w"));
    }

    #[test]
    fn palette_id_of_an_instance() {
        assert_eq!(palette_id("emoji", "emoji"), "emoji");
        assert_eq!(palette_id("clipboard", "history"), "clipboard-history");
        assert_eq!(palette_id("gmail@work", "gmail"), "gmail@work", "named like the extension's name: the key");
        assert_eq!(palette_id("gmail@work", "inbox"), "gmail@work-inbox");
    }

    #[test]
    fn private_ids_are_secrets_and_instance_scoped() {
        let specs = serde_json::json!([
            { "id": "token", "kind": "secret" },
            { "id": "url", "kind": "text", "scope": "instance" },
            { "id": "org", "kind": "text" },
            { "kind": "text" },
        ]);
        assert_eq!(private_ids(&specs).into_iter().collect::<Vec<_>>(), ["token", "url"]);
        assert!(private_ids(&serde_json::Value::Null).is_empty());
    }
}
