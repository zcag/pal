//! Anonymous usage counts (docs/usage.md is the contract and the promise:
//! nothing leaves that is not listed there).
//!
//! Everything lives in pal's data directory: the random install id
//! (`usage-id`), the events waiting to be sent (`usage-queue.jsonl`, one per
//! line), palette opens counted per UTC day (`usage-opens.json`) and the
//! last day a daily summary covered (`usage-daily`). Everything is a no-op
//! while sharing is off, which is the id file not existing; [`Usage::set_enabled`]
//! is the one switch, called at start and when the setting changes.
//!
//! The app sends: [`Usage::flush`] posts the queue in batches to
//! `POST https://pal.cagdas.io/api/events`, each batch with at most one
//! daily summary (the oldest completed day not yet sent), keeps what failed
//! to send, and drops events older than 30 days.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::extensions::{Kind as InstallKind, Store};
use crate::fs::write_atomic;
use crate::registry::PAL;

pub const EVENTS_URL: &str = "https://pal.cagdas.io/api/events";
const ID: &str = "usage-id";
const QUEUE: &str = "usage-queue.jsonl";
const OPENS: &str = "usage-opens.json";
const DAILY: &str = "usage-daily";
/// Unsent events older than this are dropped.
const KEEP_SECS: u64 = 30 * 86_400;
const BATCH: usize = 500;
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Install,
    Update,
    Remove,
    Rollback,
    Fail,
    Enable,
    Disable,
}

/// Where an action started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum From {
    Store,
    Settings,
    Search,
    Games,
    Welcome,
    Web,
    Deeplink,
    Migration,
    Reconcile,
    Auto,
    Cli,
}

/// A failure's kind; never its message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    Download,
    Verify,
    Load,
    Offline,
    Incompatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    /// Unix seconds.
    pub at: u64,
    pub kind: EventKind,
    pub ext: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    pub from: From,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorKind>,
}

impl Event {
    /// An event now, without a build.
    pub fn now(kind: EventKind, ext: &str, from: From) -> Event {
        Event { at: crate::registry::now(), kind, ext: ext.into(), hash: None, seq: None, from, error: None }
    }

    pub fn build(mut self, hash: &str, seq: u64) -> Event {
        self.hash = Some(hash.into());
        self.seq = Some(seq);
        self
    }

    pub fn error(mut self, e: ErrorKind) -> Event {
        self.error = Some(e);
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Daily {
    /// `YYYY-MM-DD`, UTC.
    pub day: String,
    /// Our registry's installs and their builds.
    pub installed: Vec<InstalledBuild>,
    /// How many store extensions come from other registries (a count, no names).
    pub third_party: usize,
    /// How many are source installs.
    pub source: usize,
    pub opens: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledBuild {
    pub ext: String,
    pub hash: String,
}

/// One `POST /api/events` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payload {
    pub pal: String,
    pub os: String,
    pub arch: String,
    pub events: Vec<Event>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily: Option<Daily>,
}

/// The usage files in one data directory.
#[derive(Debug, Clone)]
pub struct Usage {
    dir: PathBuf,
}

impl Usage {
    pub fn at(dir: impl Into<PathBuf>) -> Usage {
        Usage { dir: dir.into() }
    }

    /// In pal's data directory, beside the store.
    pub fn locate() -> Usage {
        Usage::at(crate::fs::data_dir())
    }

    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// The install id while sharing is on.
    pub fn id(&self) -> Option<String> {
        std::fs::read_to_string(self.path(ID)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    pub fn enabled(&self) -> bool {
        self.id().is_some()
    }

    /// The one switch (`general.usage`): on makes the id when there is none;
    /// off deletes it and everything waiting. Either way, what
    /// [`crate::net`] sends to pal.cagdas.io follows at once.
    pub fn set_enabled(&self, on: bool) -> std::io::Result<()> {
        if on {
            let id = match self.id() {
                Some(id) => id,
                None => {
                    let id = uuid::Uuid::new_v4().to_string();
                    write_atomic(&self.path(ID), &id)?;
                    id
                }
            };
            crate::net::set_install_id(Some(id));
        } else {
            crate::net::set_install_id(None);
            for f in [ID, QUEUE, OPENS, DAILY] {
                match std::fs::remove_file(self.path(f)) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                    _ => {}
                }
            }
        }
        Ok(())
    }

    /// Queues `event`; nothing while sharing is off.
    pub fn record(&self, event: Event) {
        if !self.enabled() {
            return;
        }
        let Ok(line) = serde_json::to_string(&event) else { return };
        // One short line per write with O_APPEND: the CLI and the app can
        // both append without interleaving.
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(self.path(QUEUE)) {
            let _ = f.write_all(format!("{line}\n").as_bytes());
        }
    }

    /// Counts one open of `ext`'s palettes today (an instance counts for its
    /// extension); nothing while sharing is off.
    pub fn opened(&self, ext: &str) {
        if !self.enabled() {
            return;
        }
        let ext = crate::config::instance::name_of(ext).to_string();
        let mut opens = self.opens();
        *opens.entry(day(crate::registry::now())).or_default().entry(ext).or_default() += 1;
        // Only the days a summary can still cover.
        let oldest = day(crate::registry::now().saturating_sub(KEEP_SECS));
        opens.retain(|d, _| *d >= oldest);
        let _ = write_atomic(&self.path(OPENS), serde_json::to_vec(&opens).unwrap_or_default());
    }

    fn opens(&self) -> BTreeMap<String, BTreeMap<String, u64>> {
        std::fs::read(self.path(OPENS)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// The daily summary for `day`: the store's installs now, that day's opens.
    pub fn daily(&self, store: &Store, day: &str) -> Daily {
        let mut d = Daily { day: day.into(), opens: self.opens().remove(day).unwrap_or_default(), ..Default::default() };
        for i in store.list().unwrap_or_default() {
            match i.kind() {
                InstallKind::Registry { registry, hash, .. } if registry == PAL => d.installed.push(InstalledBuild { ext: i.name.clone(), hash: hash.into() }),
                InstallKind::Registry { .. } => d.third_party += 1,
                InstallKind::Source(_) => d.source += 1,
                InstallKind::Hand => {}
            }
        }
        d
    }

    /// Sends what is waiting to [`EVENTS_URL`]. See [`Usage::flush_to`].
    pub fn flush(&self, store: &Store) -> Result<usize, String> {
        self.flush_to(EVENTS_URL, store)
    }

    /// Posts the queue in batches of 500 to `url`, each with the oldest
    /// completed day's summary not yet sent. Returns how many events went;
    /// on a failure what did not go stays queued. Drops events older than
    /// 30 days first. Nothing while sharing is off.
    pub fn flush_to(&self, url: &str, store: &Store) -> Result<usize, String> {
        if !self.enabled() {
            return Ok(0);
        }
        let now = crate::registry::now();
        let queued = self.queue();
        let fresh: Vec<&String> = queued.iter().filter(|l| serde_json::from_str::<Event>(l).is_ok_and(|e| e.at + KEEP_SECS >= now)).collect();
        if fresh.len() != queued.len() {
            let fresh: Vec<String> = fresh.iter().map(|s| s.to_string()).collect();
            self.drop_sent(&queued, &fresh)?;
        }
        let agent = crate::net::agent(TIMEOUT);
        let mut sent = 0;
        loop {
            let queued = self.queue();
            let batch: Vec<String> = queued.iter().take(BATCH).cloned().collect();
            let daily = self.pending_day(now).map(|d| self.daily(store, &d));
            if batch.is_empty() && daily.is_none() {
                return Ok(sent);
            }
            let payload = Payload {
                pal: crate::net::version().to_string(),
                os: std::env::consts::OS.into(),
                arch: std::env::consts::ARCH.into(),
                events: batch.iter().filter_map(|l| serde_json::from_str(l).ok()).collect(),
                daily: daily.clone(),
            };
            let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
            crate::net::post(&agent, url).header("Content-Type", "application/json").send(&body[..]).map_err(|e| e.to_string())?;
            self.drop_sent(&batch, &[])?;
            if let Some(d) = daily {
                let _ = write_atomic(&self.path(DAILY), d.day);
            }
            sent += batch.len();
        }
    }

    fn queue(&self) -> Vec<String> {
        std::fs::read_to_string(self.path(QUEUE)).unwrap_or_default().lines().filter(|l| !l.trim().is_empty()).map(str::to_string).collect()
    }

    /// Removes the lines of `gone` from the queue and appends `keep`.
    /// Lines appended meanwhile (by the CLI) stay.
    fn drop_sent(&self, gone: &[String], keep: &[String]) -> Result<(), String> {
        let mut left: Vec<String> = self.queue();
        for g in gone {
            if let Some(i) = left.iter().position(|l| l == g) {
                left.remove(i);
            }
        }
        left.splice(0..0, keep.iter().cloned());
        let text: String = left.iter().map(|l| format!("{l}\n")).collect();
        write_atomic(&self.path(QUEUE), text).map_err(|e| e.to_string())
    }

    /// The oldest completed day (before today) after the last one a
    /// summary covered: the day with opens, else yesterday. `None` when
    /// yesterday is covered.
    fn pending_day(&self, now: u64) -> Option<String> {
        let today = day(now);
        let yesterday = day(now.saturating_sub(86_400));
        let last = std::fs::read_to_string(self.path(DAILY)).unwrap_or_default().trim().to_string();
        let opened = self.opens().into_keys().find(|d| *d < today && *d > last);
        opened.or(Some(yesterday)).filter(|d| *d > last)
    }
}

/// `YYYY-MM-DD` of unix seconds, UTC.
fn day(secs: u64) -> String {
    let (y, m, d, ..) = crate::calendar::civil_utc(secs as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Server;

    fn file(u: &Usage, name: &str) -> PathBuf {
        u.path(name)
    }

    #[test]
    fn everything_is_off_until_enabled() {
        let tmp = tempfile::tempdir().unwrap();
        let u = Usage::at(tmp.path());
        u.record(Event::now(EventKind::Install, "weather", From::Cli));
        u.opened("weather");
        assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_none(), "no file while off");
        assert_eq!(u.flush_to("http://127.0.0.1:1/never", &Store::at(tmp.path().join("x"))), Ok(0));

        u.set_enabled(true).unwrap();
        let id = u.id().unwrap();
        assert_eq!(id.len(), 36);
        u.set_enabled(true).unwrap();
        assert_eq!(u.id().unwrap(), id, "kept across starts");
        u.record(Event::now(EventKind::Install, "weather", From::Cli));
        u.opened("gmail@work");
        assert!(file(&u, QUEUE).is_file() && file(&u, OPENS).is_file());
        u.set_enabled(false).unwrap();
        assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_none(), "off deletes the id and everything waiting");
        u.set_enabled(true).unwrap();
        assert_ne!(u.id().unwrap(), id, "on again is a new id");
        u.set_enabled(false).unwrap();
    }

    #[test]
    fn flush_sends_batches_with_a_daily_summary() {
        let server = Server::start();
        server.ok("/api/events", "{}");
        let tmp = tempfile::tempdir().unwrap();
        let u = Usage::at(tmp.path());
        u.set_enabled(true).unwrap();
        let store = Store::at(tmp.path().join("extensions"));
        let now = crate::registry::now();
        u.record(Event::now(EventKind::Install, "weather", From::Search).build("h", 7));
        u.record(Event { at: now - KEEP_SECS - 10, ..Event::now(EventKind::Fail, "old", From::Auto).error(ErrorKind::Download) });
        let yesterday = day(now - 86_400);
        std::fs::write(file(&u, OPENS), format!(r#"{{"{yesterday}":{{"calc":12}}}}"#)).unwrap();
        u.opened("calc");

        assert_eq!(u.flush_to(&server.url("/api/events"), &store), Ok(1));
        let reqs = server.requests_to("/api/events");
        assert_eq!((reqs.len(), reqs[0].method.as_str()), (1, "POST"));
        let p: Payload = serde_json::from_slice(&reqs[0].body).unwrap();
        assert_eq!(p.events.len(), 1, "the 31-day-old event was dropped");
        assert_eq!((p.events[0].ext.as_str(), p.events[0].from, p.events[0].hash.as_deref()), ("weather", From::Search, Some("h")));
        assert_eq!((p.os.as_str(), p.arch.as_str()), (std::env::consts::OS, std::env::consts::ARCH));
        let d = p.daily.unwrap();
        assert_eq!((d.day.as_str(), d.opens.get("calc")), (yesterday.as_str(), Some(&12)), "a completed day, not today's running count");
        assert_eq!(std::fs::read_to_string(file(&u, QUEUE)).unwrap(), "");
        // Nothing waiting, yesterday covered: no request.
        assert_eq!(u.flush_to(&server.url("/api/events"), &store), Ok(0));
        assert_eq!(server.requests_to("/api/events").len(), 1);
        let body = String::from_utf8_lossy(&reqs[0].body).into_owned();
        assert!(!body.contains(&u.id().unwrap()), "the id is a header, not in the body");

        // A failure keeps the queue.
        u.record(Event::now(EventKind::Remove, "weather", From::Cli));
        assert!(u.flush_to(&server.url("/api/missing"), &store).is_err());
        assert_eq!(u.queue().len(), 1);
    }

    #[test]
    fn daily_counts_without_naming_other_registries() {
        let tmp = tempfile::tempdir().unwrap();
        let u = Usage::at(tmp.path());
        let store = Store::at(tmp.path().join("extensions"));
        let put = |name: &str, record: Option<crate::extensions::Record>| {
            let d = store.dir().join(name);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("pal.json"), format!(r#"{{"name":"{name}"}}"#)).unwrap();
            if let Some(r) = record {
                std::fs::write(d.join(crate::extensions::RECORD), serde_json::to_vec(&r).unwrap()).unwrap();
            }
        };
        use crate::extensions::Record;
        use crate::registry::Channel;
        put("weather", Some(Record::from_registry("pal", Channel::Stable, "h1", 1, 1, "")));
        put("todo", Some(Record::from_registry("acme", Channel::Stable, "h2", 1, 1, "")));
        put("mine", Some(Record::from_source("/x")));
        put("hand", None);
        let d = u.daily(&store, "2026-09-30");
        assert_eq!(d.installed, [InstalledBuild { ext: "weather".into(), hash: "h1".into() }]);
        assert_eq!((d.third_party, d.source), (1, 1));
        assert!(!serde_json::to_string(&d).unwrap().contains("todo"));
    }
}
