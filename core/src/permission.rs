//! Where the app stands with the OS on a permission that has a prompt,
//! shared by every capability gated by one (Calendars in [`crate::calendar`],
//! Location Services for the Wi-Fi names in the app's `permissions.rs`).

use serde::{Deserialize, Serialize};

/// `granted` works; `not_determined` means a request will prompt; `denied`
/// and `restricted` are switched in System Settings (restricted: a profile
/// forbids it); `unavailable` is a machine without the backend at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
    Unavailable,
}

impl Status {
    /// Something a Grant button can still do: the prompt (`not_determined`)
    /// or the pane (`denied`). Restricted and unavailable are nobody's to fix.
    pub fn missing(self) -> bool {
        matches!(self, Status::NotDetermined | Status::Denied)
    }
}
