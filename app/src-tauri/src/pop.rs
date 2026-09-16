//! Pop to root (`general.pop_to_root`): whether a show lands where the
//! last hide left the page (its level and query) or at the root. The panel
//! notes when it hid (`note_hidden`, from both platforms' `panel::hide`);
//! `show_in` asks `keep` and tells the page in the `pal://shown` payload.
//! `"always"` is the old behaviour, `"never"` keeps the level for ever, and
//! `"after 90s"` keeps it while the hide is younger than that. A palette
//! hotkey opens its palette either way (the page's `open` resets first).

use std::sync::Mutex;
use std::time::Instant;

use pal_core::config::PopToRoot;

use crate::lock;

/// When the panel last hid; `None` before the first hide of the run (a
/// fresh page: nothing to keep).
static HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// The panel hid now.
pub fn note_hidden() {
    *lock(&HIDDEN_AT) = Some(Instant::now());
}

/// Whether the page keeps its level on this show.
pub fn keep(mode: &PopToRoot) -> bool {
    let hidden_for = lock(&HIDDEN_AT).map(|t| t.elapsed().as_secs_f64());
    decide(mode, hidden_for)
}

/// The rule, pure: never before the first hide, else what the mode says
/// of the hide's age in seconds.
pub fn decide(mode: &PopToRoot, hidden_for: Option<f64>) -> bool {
    hidden_for.is_some_and(|secs| mode.keeps(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_by_mode_and_age() {
        assert!(!decide(&PopToRoot::Never, None), "nothing to keep before the first hide");
        assert!(decide(&PopToRoot::Never, Some(1e9)));
        assert!(!decide(&PopToRoot::Always, Some(0.0)));
        assert!(decide(&PopToRoot::After(90), Some(89.9)));
        assert!(!decide(&PopToRoot::After(90), Some(90.0)));
        assert!(decide(&PopToRoot::default(), Some(30.0)), "the default is after 90s");
    }

    #[test]
    fn modes_parse_and_print() {
        assert_eq!(PopToRoot::parse("always"), Some(PopToRoot::Always));
        assert_eq!(PopToRoot::parse(" Never "), Some(PopToRoot::Never));
        assert_eq!(PopToRoot::parse("after 90s"), Some(PopToRoot::After(90)));
        assert_eq!(PopToRoot::parse("after 2m"), Some(PopToRoot::After(120)));
        assert_eq!(PopToRoot::parse("after1h"), Some(PopToRoot::After(3600)));
        assert_eq!(PopToRoot::parse("45"), Some(PopToRoot::After(45)), "a bare number is seconds");
        assert_eq!(PopToRoot::parse("after 0s"), Some(PopToRoot::Always));
        assert_eq!(PopToRoot::parse("after x"), None);
        assert_eq!(PopToRoot::parse("soon"), None);
        assert_eq!(PopToRoot::After(90).to_string(), "after 90s");
        let c: pal_core::config::Config = toml::from_str("[general]\npop_to_root = \"after 30s\"\n").unwrap();
        assert_eq!(c.general.pop_to_root, PopToRoot::After(30));
        assert_eq!(serde_json::to_value(PopToRoot::Never).unwrap(), "never");
        assert!(toml::from_str::<pal_core::config::Config>("[general]\npop_to_root = \"later\"\n").is_err());
    }
}
