//! Everything the core sends to the network goes through here, so every
//! request says which pal sent it (`User-Agent: pal/<version> (<os>; <arch>)`,
//! docs/registry.md "Calls the app makes") and only pal.cagdas.io ever sees
//! the install id (`X-Pal-Install`, docs/usage.md), and only while usage
//! sharing is on.
//!
//! The version is the app's, set once at startup ([`init`]); the core's own
//! crate version stands in until then (tests, examples). The install id is
//! set by [`crate::usage::Usage::set_enabled`], the one switch.

use std::sync::{OnceLock, RwLock};
use std::time::Duration;

/// The site that may see the install id. Other registries never do.
pub const SITE: &str = "pal.cagdas.io";

static VERSION: OnceLock<String> = OnceLock::new();
static INSTALL: RwLock<Option<String>> = RwLock::new(None);

/// The app's version, for the user agent. First call wins; the app and the
/// CLI call it before anything touches the network.
pub fn init(version: &str) {
    let _ = VERSION.set(version.to_string());
}

/// The app's version as [`init`] set it.
pub fn version() -> &'static str {
    VERSION.get().map_or(env!("CARGO_PKG_VERSION"), String::as_str)
}

/// `pal/0.8.0 (macos; aarch64)`.
pub fn user_agent() -> String {
    format!("pal/{} ({}; {})", version(), std::env::consts::OS, std::env::consts::ARCH)
}

/// The install id sent to [`SITE`], `None` to send none.
pub(crate) fn set_install_id(id: Option<String>) {
    *INSTALL.write().unwrap_or_else(|e| e.into_inner()) = id;
}

/// An agent with pal's user agent and one deadline per request.
pub fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder().user_agent(user_agent()).timeout_global(Some(timeout)).build().new_agent()
}

/// `GET url` on `agent`, with `X-Pal-Install` when `url` is on [`SITE`] and
/// usage sharing is on.
pub fn get(agent: &ureq::Agent, url: &str) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    let req = agent.get(url);
    match install_header(url) {
        Some(id) => req.header("X-Pal-Install", id),
        None => req,
    }
}

/// `POST url` on `agent`, the same header rule as [`get`].
pub fn post(agent: &ureq::Agent, url: &str) -> ureq::RequestBuilder<ureq::typestate::WithBody> {
    let req = agent.post(url);
    match install_header(url) {
        Some(id) => req.header("X-Pal-Install", id),
        None => req,
    }
}

fn install_header(url: &str) -> Option<String> {
    is_site(url).then(|| INSTALL.read().unwrap_or_else(|e| e.into_inner()).clone()).flatten()
}

/// Whether `url` is on [`SITE`] itself, not a lookalike host.
fn is_site(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| u.host_str() == Some(SITE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_names_os_and_arch() {
        let ua = user_agent();
        assert!(ua.starts_with("pal/"), "{ua}");
        assert!(ua.ends_with(&format!("({}; {})", std::env::consts::OS, std::env::consts::ARCH)), "{ua}");
    }

    #[test]
    fn the_id_goes_to_the_site_only() {
        assert!(is_site("https://pal.cagdas.io/registry/stable/index.json"));
        assert!(!is_site("https://acme.github.io/pal/index.json"), "another registry");
        assert!(!is_site("https://pal.cagdas.io.evil.com/x"));
        assert!(!is_site("https://evil.com/?pal.cagdas.io"));
        assert!(!is_site("http://127.0.0.1:1/x"));
    }
}
