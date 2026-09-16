//! Secret references. A setting that needs a token holds a pointer to it,
//! `"keychain:pal/github-token"` or `"env:GITHUB_TOKEN"`, and the value is
//! fetched from the OS store when something actually needs it. Anything that
//! is not a reference passes through as itself, so callers resolve every
//! string that may be secret and never branch on the form.

use std::collections::HashMap;
use std::sync::Mutex;

/// `<store>:<key>`, e.g. `keychain:pal/github-token`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRef<'a> {
    pub store: &'a str,
    pub key: &'a str,
}

impl<'a> SecretRef<'a> {
    /// `None` when `s` is a plain value rather than a reference.
    pub fn parse(s: &'a str) -> Option<Self> {
        let (store, key) = s.split_once(':')?;
        matches!(store, "keychain" | "env").then_some(Self { store, key })
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SecretError {
    /// The reference points at nothing: the user has to add the secret.
    #[error("no secret at {0}")]
    NotFound(String),
    /// The store itself failed (locked, missing, no backend on this
    /// platform); the secret may well exist.
    #[error("{0}")]
    Store(String),
}

/// Where `keychain:` references are looked up.
pub trait SecretStore: Send + Sync {
    /// The secret behind `key` (the part after `keychain:`), or `NotFound`.
    fn get(&self, key: &str) -> Result<String, SecretError>;
    /// Store `value` under `key`, replacing what was there. What the
    /// settings view calls for a `secret` setting; the file then gets the
    /// `keychain:<key>` reference, never the value.
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError>;
}

/// Resolve `value` against `store`: a `keychain:` reference goes to the
/// store, `env:` to the environment, anything else is returned as is.
pub fn resolve(value: &str, store: &dyn SecretStore) -> Result<String, SecretError> {
    match SecretRef::parse(value) {
        Some(SecretRef { store: "env", key }) => std::env::var(key).map_err(|_| SecretError::NotFound(value.into())),
        Some(SecretRef { key, .. }) => store.get(key),
        None => Ok(value.to_string()),
    }
}

/// The OS store: macOS Keychain, Linux Secret Service.
pub fn platform_store() -> Box<dyn SecretStore> {
    #[cfg(target_os = "macos")]
    {
        Box::new(Keychain)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Box::new(SecretService)
    }
}

/// `keychain:<service>/<account>` as a generic password; `keychain:<account>`
/// means service `pal`. Add one with
/// `security add-generic-password -s pal -a github-token -w`.
#[cfg(target_os = "macos")]
pub struct Keychain;

#[cfg(target_os = "macos")]
fn service_account(key: &str) -> (&str, &str) {
    key.split_once('/').unwrap_or(("pal", key))
}

#[cfg(target_os = "macos")]
impl SecretStore for Keychain {
    fn get(&self, key: &str) -> Result<String, SecretError> {
        let (service, account) = service_account(key);
        let out = std::process::Command::new("security")
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .map_err(|e| SecretError::Store(e.to_string()))?;
        // 44 is errSecItemNotFound; anything else (a locked keychain, a
        // denied prompt) is the store's problem, not a missing item.
        match out.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string()),
            Some(44) => Err(SecretError::NotFound(format!("keychain:{key}"))),
            _ => Err(SecretError::Store(format!("keychain:{key}: {}", String::from_utf8_lossy(&out.stderr).trim()))),
        }
    }

    /// `-U` updates an existing item in place; the value goes on the
    /// command line, which is how `security` takes it (the alternative, an
    /// interactive prompt, has no tty here).
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let (service, account) = service_account(key);
        let out = std::process::Command::new("security")
            .args(["add-generic-password", "-U", "-s", service, "-a", account, "-w", value])
            .output()
            .map_err(|e| SecretError::Store(e.to_string()))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(SecretError::Store(format!("keychain:{key}: {}", String::from_utf8_lossy(&out.stderr).trim())))
        }
    }
}

/// TODO: Secret Service (libsecret) lookup, `secret-tool lookup service
/// <service> account <account>` or the `secret-service` crate. Every lookup
/// fails with a `Store` error until then; `env:` references work everywhere.
#[cfg(not(target_os = "macos"))]
pub struct SecretService;

#[cfg(not(target_os = "macos"))]
impl SecretStore for SecretService {
    fn get(&self, key: &str) -> Result<String, SecretError> {
        Err(SecretError::Store(format!("keychain:{key}: Secret Service lookup not implemented on this platform yet")))
    }

    fn set(&self, key: &str, _value: &str) -> Result<(), SecretError> {
        Err(SecretError::Store(format!("keychain:{key}: Secret Service store not implemented on this platform yet")))
    }
}

/// In-memory store for tests and for hosts that inject secrets themselves.
#[derive(Debug, Default)]
pub struct MemStore(pub Mutex<HashMap<String, String>>);

impl MemStore {
    pub fn from(entries: HashMap<String, String>) -> Self {
        Self(Mutex::new(entries))
    }
}

impl SecretStore for MemStore {
    fn get(&self, key: &str) -> Result<String, SecretError> {
        self.0.lock().unwrap().get(key).cloned().ok_or_else(|| SecretError::NotFound(format!("keychain:{key}")))
    }

    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        self.0.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_forms() {
        assert_eq!(SecretRef::parse("keychain:pal/x"), Some(SecretRef { store: "keychain", key: "pal/x" }));
        assert_eq!(SecretRef::parse("env:X"), Some(SecretRef { store: "env", key: "X" }));
        assert_eq!(SecretRef::parse("https://x"), None, "other scheme-looking strings are plain values");
        assert_eq!(SecretRef::parse("plain"), None);
    }

    #[test]
    fn resolve_lazily_through_store() {
        let store = MemStore::from(HashMap::from([("pal/tok".to_string(), "s3cret".to_string())]));
        assert_eq!(resolve("keychain:pal/tok", &store).unwrap(), "s3cret");
        store.set("pal/tok", "new").unwrap();
        assert_eq!(resolve("keychain:pal/tok", &store).unwrap(), "new", "set replaces");
        assert_eq!(resolve("keychain:pal/nope", &store), Err(SecretError::NotFound("keychain:pal/nope".into())));
        assert_eq!(resolve("literal", &store).unwrap(), "literal");
        std::env::set_var("PAL_TEST_SECRET", "from-env");
        assert_eq!(resolve("env:PAL_TEST_SECRET", &store).unwrap(), "from-env");
        assert!(matches!(resolve("env:PAL_TEST_MISSING", &store), Err(SecretError::NotFound(_))));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn keychain_miss_is_not_found() {
        assert!(matches!(Keychain.get("pal/definitely-not-a-real-item-0xdeadbeef"), Err(SecretError::NotFound(_))));
    }

    /// Writes a real keychain item (`pal-test/roundtrip`) and removes it after.
    /// Needs an unlocked login keychain, which a CI runner does not have:
    /// `cargo test -p pal-core -- --ignored keychain_set_then_get_roundtrip`.
    #[test]
    #[cfg(target_os = "macos")]
    #[ignore]
    fn keychain_set_then_get_roundtrip() {
        let key = "pal-test/roundtrip";
        Keychain.set(key, "first").unwrap();
        assert_eq!(Keychain.get(key).unwrap(), "first");
        Keychain.set(key, "second").unwrap();
        assert_eq!(Keychain.get(key).unwrap(), "second", "-U replaces in place");
        let _ = std::process::Command::new("security").args(["delete-generic-password", "-s", "pal-test", "-a", "roundtrip"]).output();
        assert!(matches!(Keychain.get(key), Err(SecretError::NotFound(_))));
    }
}
