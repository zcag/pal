//! One read per panel show. What the app in front has (its open or save
//! panel, dialog.rs; its Finder selection, selection.rs) is asked by
//! several callers on every show (a listing per keystroke, the root's
//! hint, a suggest) and costs an AX walk or an `osascript` run each time;
//! `show_in` bumps a sequence ([`on_shown`]) and a [`PerShow`] cache hands
//! the first caller after it the read and the rest the answer, so a value
//! reflects the app that was in front when the panel was summoned.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::lock;

static SHOWN: AtomicU64 = AtomicU64::new(1);

/// The panel is showing again: the app in front may have changed.
pub fn on_shown() {
    SHOWN.fetch_add(1, Ordering::Relaxed);
}

/// A value computed once per show: `get_or` runs `f` the first time after
/// each [`on_shown`] and answers the kept value until the next.
pub struct PerShow<T>(Mutex<Option<(u64, T)>>);

impl<T: Clone> PerShow<T> {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn get_or(&self, f: impl FnOnce() -> T) -> T {
        let seq = SHOWN.load(Ordering::Relaxed);
        let mut cache = lock(&self.0);
        if let Some((at, v)) = cache.as_ref() {
            if *at == seq {
                return v.clone();
            }
        }
        let v = f();
        *cache = Some((seq, v.clone()));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_read_per_show() {
        static C: PerShow<u32> = PerShow::new();
        let mut reads = 0;
        let mut read = || { reads += 1; reads };
        assert_eq!(C.get_or(&mut read), 1);
        assert_eq!(C.get_or(&mut read), 1, "the second caller of a show gets the kept value");
        on_shown();
        assert_eq!(C.get_or(&mut read), 2, "a new show reads again");
        assert_eq!(reads, 2);
    }
}
