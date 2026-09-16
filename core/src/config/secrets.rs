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
    /// The store itself failed (locked, a denied or dismissed prompt); the
    /// secret may well exist.
    #[error("{0}")]
    Store(String),
    /// There is no store to ask: no `secret-tool` on PATH, no Secret Service
    /// on the session bus. Nothing `keychain:` can resolve until there is.
    #[error("{0}")]
    Unavailable(String),
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

/// Resolve, in place, the values of `values` whose spec in `specs` (a
/// manifest's `settings` list as JSON) is `kind: "secret"` and that are
/// string references. A failed lookup leaves the reference as written and
/// logs it, so a missing secret never blocks the caller; anything not
/// declared secret is left alone even when it looks like a reference.
pub fn resolve_declared(values: &mut toml::Table, specs: &serde_json::Value, store: &dyn SecretStore) {
    let secret_ids = specs.as_array().into_iter().flatten().filter(|s| s["kind"] == "secret").filter_map(|s| s["id"].as_str());
    for id in secret_ids {
        let Some(toml::Value::String(raw)) = values.get(id) else { continue };
        if SecretRef::parse(raw).is_none() {
            continue;
        }
        match resolve(raw, store) {
            Ok(v) => {
                values.insert(id.to_string(), toml::Value::String(v));
            }
            Err(e) => eprintln!("secrets\tunresolved\t{id}\t{e}"),
        }
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
        Box::new(SecretService::default())
    }
}

/// `keychain:<service>/<account>` as a generic password; `keychain:<account>`
/// means service `pal`. Add one with
/// `security add-generic-password -s pal -a github-token -w`.
#[cfg(target_os = "macos")]
pub struct Keychain;

/// `<service>/<account>`, or service `pal` for a bare key.
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

/// Secret Service (libsecret) through the `secret-tool` CLI, so pal needs no
/// D-Bus client of its own: `keychain:<service>/<account>` is the item with
/// attributes `service` and `account` (`keychain:<account>` means service
/// `pal`), the same two `secret-tool` takes on the command line. Add one by
/// hand with `secret-tool store --label="pal github-token" service pal
/// account github-token`. Compiled everywhere so the fake-tool tests run on
/// macOS too; only `platform_store` picks it.
pub struct SecretService {
    /// The program to run: `secret-tool` off PATH, or a path (tests).
    tool: std::ffi::OsString,
}

impl Default for SecretService {
    fn default() -> Self {
        Self::with_tool("secret-tool")
    }
}

impl SecretService {
    pub fn with_tool(tool: impl Into<std::ffi::OsString>) -> Self {
        Self { tool: tool.into() }
    }

    /// Runs `secret-tool <args>` with `stdin` fed to it and stdin closed
    /// after, mapping a missing binary to `Unavailable`.
    fn run(&self, args: &[&str], stdin: Option<&str>) -> Result<std::process::Output, SecretError> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new(&self.tool)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => SecretError::Unavailable("secret-tool (libsecret) is not installed; keychain: references need it, env: works without".into()),
                _ => SecretError::Store(e.to_string()),
            })?;
        if let (Some(mut pipe), Some(text)) = (child.stdin.take(), stdin) {
            pipe.write_all(text.as_bytes()).map_err(|e| SecretError::Store(e.to_string()))?;
        }
        child.wait_with_output().map_err(|e| SecretError::Store(e.to_string()))
    }

    /// `secret-tool` exits 1 for every failure, so the kind is in stderr:
    /// nothing said is a miss; a bus or activation complaint means no
    /// Secret Service is reachable; anything else (locked, denied, a
    /// dismissed prompt) is the store's problem and the item may exist.
    fn failure(key: &str, stderr: &[u8]) -> SecretError {
        let msg = String::from_utf8_lossy(stderr).trim().to_string();
        if msg.is_empty() {
            SecretError::NotFound(format!("keychain:{key}"))
        } else if ["org.freedesktop.secrets", "Could not connect", "D-Bus"].iter().any(|n| msg.contains(n)) {
            SecretError::Unavailable(format!("keychain:{key}: no Secret Service on the session bus ({msg})"))
        } else {
            SecretError::Store(format!("keychain:{key}: {msg}"))
        }
    }
}

impl SecretStore for SecretService {
    fn get(&self, key: &str) -> Result<String, SecretError> {
        let (service, account) = service_account(key);
        let out = self.run(&["lookup", "service", service, "account", account], None)?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
        } else {
            Err(Self::failure(key, &out.stderr))
        }
    }

    /// `store` replaces an item with the same attributes; the value goes on
    /// stdin, which is where `secret-tool` reads it from without a tty.
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let (service, account) = service_account(key);
        let label = format!("pal {key}");
        let out = self.run(&["store", "--label", &label, "service", service, "account", account], Some(value))?;
        if out.status.success() {
            Ok(())
        } else {
            // A miss makes no sense for a write: an empty stderr is still a store failure.
            Err(match Self::failure(key, &out.stderr) {
                SecretError::NotFound(_) => SecretError::Store(format!("keychain:{key}: secret-tool store failed")),
                e => e,
            })
        }
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

    /// A stand-in `secret-tool` that answers by account name, and records
    /// every `store` (args, then stdin) to `<dir>/stored`.
    fn fake_secret_tool(dir: &std::path::Path) -> SecretService {
        use std::os::unix::fs::PermissionsExt;
        let tool = dir.join("secret-tool");
        std::fs::write(
            &tool,
            format!(
                r#"#!/bin/sh
cmd=$1; shift
case "$cmd" in
  lookup)
    case "$4" in
      tok) printf 's3cret' ;;
      nl) printf 'ends-with-newline\n' ;;
      nope) exit 1 ;;
      nobus) echo 'secret-tool: Could not connect: No such file or directory' >&2; exit 1 ;;
      noservice) echo 'secret-tool: Error calling StartServiceByName for org.freedesktop.secrets: Timeout was reached' >&2; exit 1 ;;
      locked) echo 'secret-tool: The collection is locked' >&2; exit 1 ;;
    esac ;;
  store)
    printf '%s\n' "$*" > '{dir}/stored'; cat >> '{dir}/stored'
    case "$*" in
      *denied*) echo 'secret-tool: Access denied' >&2; exit 1 ;;
      *nobus*) echo 'secret-tool: Could not connect: No such file or directory' >&2; exit 1 ;;
    esac ;;
esac
"#,
                dir = dir.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        SecretService::with_tool(tool)
    }

    #[test]
    fn secret_tool_lookup_mapping() {
        let dir = tempfile::tempdir().unwrap();
        let store = fake_secret_tool(dir.path());
        assert_eq!(store.get("pal/tok").unwrap(), "s3cret");
        assert_eq!(store.get("tok").unwrap(), "s3cret", "bare key is service pal");
        assert_eq!(store.get("pal/nl").unwrap(), "ends-with-newline", "trailing newline dropped, as the keychain path does");
        assert_eq!(store.get("pal/nope"), Err(SecretError::NotFound("keychain:pal/nope".into())), "silent exit 1 is a miss");
        assert!(matches!(store.get("pal/nobus"), Err(SecretError::Unavailable(m)) if m.contains("no Secret Service") && m.contains("Could not connect")));
        assert!(matches!(store.get("pal/noservice"), Err(SecretError::Unavailable(m)) if m.contains("org.freedesktop.secrets")));
        assert!(matches!(store.get("pal/locked"), Err(SecretError::Store(m)) if m == "keychain:pal/locked: secret-tool: The collection is locked"));
    }

    #[test]
    fn secret_tool_store_args_and_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let store = fake_secret_tool(dir.path());
        store.set("pal/github-token", "va lue\n").unwrap();
        let rec = std::fs::read_to_string(dir.path().join("stored")).unwrap();
        assert_eq!(rec, "--label pal pal/github-token service pal account github-token\nva lue\n", "attributes on argv, the value on stdin verbatim");
        assert!(matches!(store.set("pal/denied", "x"), Err(SecretError::Store(m)) if m == "keychain:pal/denied: secret-tool: Access denied"));
        assert!(matches!(store.set("pal/nobus", "x"), Err(SecretError::Unavailable(_))));
    }

    #[test]
    fn secret_tool_absent_is_unavailable() {
        let store = SecretService::with_tool("/nonexistent/secret-tool");
        assert!(matches!(store.get("pal/tok"), Err(SecretError::Unavailable(m)) if m.contains("not installed")));
        assert!(matches!(store.set("pal/tok", "x"), Err(SecretError::Unavailable(_))));
    }

    /// Writes a real Secret Service item (`pal-test/roundtrip`) and removes
    /// it after. Needs `secret-tool` and an unlocked keyring on the session
    /// bus: `cargo test -p pal-core -- --ignored secret_tool_set_then_get_roundtrip`.
    #[test]
    #[cfg(not(target_os = "macos"))]
    #[ignore]
    fn secret_tool_set_then_get_roundtrip() {
        let store = SecretService::default();
        let key = "pal-test/roundtrip";
        store.set(key, "first").unwrap();
        assert_eq!(store.get(key).unwrap(), "first");
        store.set(key, "second").unwrap();
        assert_eq!(store.get(key).unwrap(), "second", "store replaces in place");
        let _ = std::process::Command::new("secret-tool").args(["clear", "service", "pal-test", "account", "roundtrip"]).output();
        assert!(matches!(store.get(key), Err(SecretError::NotFound(_))));
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
