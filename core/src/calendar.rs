//! The calendar capability: the events of the next days, the calendars
//! they live in, a new event, a deleted one, and the permission that
//! gates it all. macOS is EventKit in-process (`objc2-event-kit`): every
//! account Calendar.app has (iCloud, Google, Exchange) comes through the
//! one store, and the permission is the Calendars item under Privacy &
//! Security. Linux is `khal` on PATH (its `list --json`, `printcalendars`,
//! `new`); without it the capability is [`Status::Unavailable`].
//!
//! Times on the wire are unix milliseconds, like the clipboard's `at`.
//! [`conference_url`] is the pure part every backend shares: the Zoom /
//! Meet / Teams / Webex link hidden in an event's url, location or notes.
//!
//! macOS permission: `EKEventStore` answers [`permission`] without a
//! prompt; [`request`] shows the system dialog once (`not_determined` only)
//! and needs `NSCalendarsFullAccessUsageDescription` in the app's
//! Info.plist, else TCC ends the process instead of asking. A denied
//! state is switched in System Settings ([`open_settings`]).

use serde::{Deserialize, Serialize};

pub use crate::tool::{Error, Result};

/// Where the app stands with the OS: `granted` lists and writes;
/// `not_determined` means [`request`] will prompt; `denied` and
/// `restricted` are switched in System Settings (restricted: a profile
/// forbids it); `unavailable` is a machine without a backend (Linux
/// without `khal`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Calendar {
    /// What `events` filters on and `create` takes: the EventKit
    /// identifier, or khal's calendar name.
    pub id: String,
    pub title: String,
    /// `#rrggbb` when the backend has one.
    pub color: Option<String>,
    /// The account (`iCloud`, `Google`); khal has none.
    pub source: Option<String>,
    /// Whether events can be added to it (a subscribed or holiday calendar
    /// cannot).
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attendee {
    pub name: String,
    /// `accepted`, `declined`, `tentative`, `pending`, `unknown`.
    pub status: String,
    /// The user's own entry, which is where their reply lives.
    pub me: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// The backend's identifier: shared by every occurrence of a recurring
    /// event, so with `occurrence` it names one.
    pub id: String,
    /// The start of this occurrence, ms, set on recurring events only;
    /// what `delete` and `open` take beside the id.
    pub occurrence: Option<i64>,
    pub title: String,
    /// Unix ms.
    pub start: i64,
    /// Unix ms; for an all-day event the midnight after its last day.
    pub end: i64,
    pub all_day: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub calendar: Calendar,
    pub attendees: Vec<Attendee>,
    pub organizer: Option<String>,
    /// The join link found in `url`, `location` or `notes` ([`conference_url`]).
    pub conference_url: Option<String>,
    pub recurring: bool,
    /// The user's reply on an invitation (`accepted`, `declined`,
    /// `tentative`, `pending`); none on an event they own or without
    /// attendees.
    pub my_status: Option<String>,
}

/// What `create` takes. `calendar` is a [`Calendar::id`]; the backend's
/// default calendar when absent. With `all_day`, `start`/`end` are read as
/// the days they fall on (end exclusive, like [`Event::end`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NewEvent {
    pub title: String,
    pub start: i64,
    pub end: i64,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub calendar: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// The state, without prompting.
pub fn permission() -> Status {
    platform::permission()
}

/// macOS: show the system prompt when the state is `not_determined` and
/// wait for the answer up to `wait`; the state after (unchanged when the
/// user has not answered yet, or was never asked). No-op elsewhere.
pub fn request(wait: std::time::Duration) -> Result<Status> {
    platform::request(wait)
}

/// macOS: System Settings on Privacy & Security > Calendars.
pub fn open_settings() -> std::io::Result<()> {
    platform::open_settings()
}

/// Every event calendar, by source then title.
pub fn calendars() -> Result<Vec<Calendar>> {
    platform::calendars()
}

/// Events overlapping `[from, to)` (ms), by start; `calendars` narrows to
/// those ids, none means all. Occurrences of recurring events are expanded.
pub fn events(from: i64, to: i64, calendars: Option<&[String]>) -> Result<Vec<Event>> {
    platform::events(from, to, calendars)
}

/// Save a new event; its id.
pub fn create(e: &NewEvent) -> Result<String> {
    platform::create(e)
}

/// Remove one event, or with `occurrence` one occurrence of a recurring
/// one (the rest stay).
pub fn delete(id: &str, occurrence: Option<i64>) -> Result<()> {
    platform::delete(id, occurrence)
}

/// Show the event in the calendar app: `ical://ekevent/<id>` on macOS
/// (with the occurrence's stamp in front for a recurring one); nothing
/// on Linux, where khal has no deep link.
pub fn open(id: &str, occurrence: Option<i64>) -> Result<()> {
    platform::open(id, occurrence)
}

// ---- conference links --------------------------------------------------

/// The video-call link in an event: the `url` field first, then the
/// location, then the notes, the first link of a known provider (Zoom,
/// Google Meet, Teams, Webex, Jitsi, Whereby, GoTo) wins. Outlook's
/// safelinks wrapper is unwrapped, `&amp;` in an HTML-ish body is
/// unescaped, and trailing punctuation or a closing bracket is dropped.
pub fn conference_url(url: Option<&str>, location: Option<&str>, notes: Option<&str>) -> Option<String> {
    [url, location, notes].into_iter().flatten().find_map(|text| links(text).into_iter().find(|u| is_conference(u)))
}

/// The `https?://` links in `text`, in order, unwrapped and cleaned.
fn links(text: &str) -> Vec<String> {
    let text = text.replace("&amp;", "&");
    // ASCII lower-casing keeps byte offsets, so the search runs on the copy and the slices come from the original.
    let lower = text.to_ascii_lowercase();
    let mut out = vec![];
    let mut at = 0;
    while let Some(i) = lower[at..].find("http") {
        let s = &text[at + i..];
        let Some(scheme) = ["https://", "http://"].into_iter().find(|p| lower[at + i..].starts_with(p)) else {
            at += i + 4;
            continue;
        };
        let end = s.find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '`')).unwrap_or(s.len());
        let raw = s[..end].trim_end_matches(['.', ',', ';', ':', ')', ']', '}', '!', '?']);
        if raw.len() > scheme.len() {
            out.push(unwrap_safelink(raw).unwrap_or_else(|| raw.to_string()));
        }
        at += i + end;
    }
    out
}

/// `https://…safelinks.protection.outlook.com/?url=<encoded>&…` to the
/// link inside.
fn unwrap_safelink(u: &str) -> Option<String> {
    let host = host_of(u)?;
    if !host.ends_with("safelinks.protection.outlook.com") {
        return None;
    }
    let q = u.split_once('?')?.1;
    let enc = q.split('&').find_map(|kv| kv.strip_prefix("url="))?;
    Some(percent_decode(enc))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Lower-cased host of a link, port dropped.
fn host_of(u: &str) -> Option<String> {
    let after = u.split_once("://")?.1;
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let host = after[..end].rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

fn path_of(u: &str) -> &str {
    u.split_once("://").map_or("", |(_, r)| r.find(['/', '?', '#']).map_or("", |i| &r[i..]))
}

/// Provider by host, with the path shape that is a meeting (a Zoom
/// marketing page is not a call).
fn is_conference(u: &str) -> bool {
    let Some(host) = host_of(u) else { return false };
    let path = path_of(u);
    let under = |d: &str| host == d || host.ends_with(&format!(".{d}"));
    let has = |p: &[&str]| p.iter().any(|p| path.starts_with(p));
    (under("zoom.us") || under("zoomgov.com") || under("zoom.com")) && has(&["/j/", "/my/", "/w/", "/s/", "/wc/"])
        || host == "meet.google.com" && path.len() > 1 && !path.starts_with("/new")
        || under("teams.microsoft.com") && has(&["/l/meetup-join/", "/meet/"])
        || under("teams.live.com") && has(&["/meet/"])
        || under("webex.com") && path.len() > 1 && !has(&["/signin", "/webappng/sites"])
        || host == "meet.jit.si" && path.len() > 1
        || under("whereby.com") && path.len() > 1
        || under("meet.goto.com") && path.len() > 1
}

// ---- time helpers ------------------------------------------------------

/// Unix seconds to a civil date and time in UTC: `(y, m, d, hh, mm, ss)`.
/// Howard Hinnant's `civil_from_days`, so no date crate.
pub fn civil_utc(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400) as u32;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, rem / 3600, rem / 60 % 60, rem % 60)
}

/// `20260916T070000Z`: the UTC stamp Calendar.app's `ical://ekevent/`
/// link puts before a recurring event's id.
pub fn ical_stamp(ms: i64) -> String {
    let (y, m, d, hh, mm, ss) = civil_utc(ms.div_euclid(1000));
    format!("{y:04}{m:02}{d:02}T{hh:02}{mm:02}{ss:02}Z")
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2::sel;
    use objc2_core_graphics::CGColor;
    use objc2_event_kit::{EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore, EKParticipant, EKParticipantStatus, EKSpan};
    use objc2_foundation::{NSArray, NSDate, NSError, NSString};

    use super::{Attendee, Calendar, Error, Event, NewEvent, Result, Status};

    /// Seconds of slack around an occurrence's start when looking it up.
    const OCCURRENCE_SLACK: f64 = 1.0;

    fn store() -> Retained<EKEventStore> {
        // SAFETY: plain init; the store is used on this thread only and dropped with it (EventKit: the store is thread-safe, fetched objects are not shared).
        unsafe { EKEventStore::new() }
    }

    fn status_of(s: EKAuthorizationStatus) -> Status {
        match s {
            EKAuthorizationStatus::FullAccess => Status::Granted,
            EKAuthorizationStatus::NotDetermined => Status::NotDetermined,
            EKAuthorizationStatus::Restricted => Status::Restricted,
            // Write-only (macOS 14+) cannot list a schedule; for pal it is a refusal.
            _ => Status::Denied,
        }
    }

    pub fn permission() -> Status {
        // SAFETY: a class method with a plain enum argument.
        status_of(unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) })
    }

    pub fn request(wait: Duration) -> Result<Status> {
        if permission() != Status::NotDetermined {
            return Ok(permission());
        }
        let s = store();
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |ok: Bool, _err: *mut NSError| {
            let _ = tx.send(ok.as_bool());
        });
        let handler = &*block as *const _ as *mut _;
        // SAFETY: the block lives until this function returns; the completion runs on EventKit's own queue and only sends on the channel, which a dropped receiver tolerates.
        unsafe {
            if s.respondsToSelector(sel!(requestFullAccessToEventsWithCompletion:)) {
                s.requestFullAccessToEventsWithCompletion(handler);
            } else {
                #[allow(deprecated)]
                s.requestAccessToEntityType_completion(EKEntityType::Event, handler);
            }
        }
        let _ = rx.recv_timeout(wait);
        Ok(permission())
    }

    pub fn open_settings() -> std::io::Result<()> {
        let mut child = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars").spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }

    fn need_access() -> Result<()> {
        match permission() {
            Status::Granted => Ok(()),
            Status::NotDetermined => Err(Error::Failed("calendar access not requested yet".into())),
            Status::Restricted => Err(Error::Failed("calendar access is restricted on this machine".into())),
            _ => Err(Error::Failed("calendar access denied: Privacy & Security > Calendars".into())),
        }
    }

    fn text(s: Option<Retained<NSString>>) -> Option<String> {
        s.map(|s| s.to_string()).filter(|s| !s.trim().is_empty())
    }

    fn ms(d: &NSDate) -> i64 {
        (d.timeIntervalSince1970() * 1000.0).round() as i64
    }

    fn date(ms: i64) -> Retained<NSDate> {
        NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0)
    }

    /// `#rrggbb` from the calendar's CGColor: RGB(A) or grey(A) components.
    fn hex(c: Option<Retained<CGColor>>) -> Option<String> {
        let c = c?;
        let n = CGColor::number_of_components(Some(&c));
        let p = CGColor::components(Some(&c));
        if p.is_null() || n < 2 {
            return None;
        }
        // SAFETY: `p` points at `n` CGFloats owned by the colour, which outlives this read.
        let comps = unsafe { std::slice::from_raw_parts(p, n) };
        let ch = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        let (r, g, b) = if n >= 3 { (comps[0], comps[1], comps[2]) } else { (comps[0], comps[0], comps[0]) };
        Some(format!("#{:02x}{:02x}{:02x}", ch(r), ch(g), ch(b)))
    }

    fn calendar(c: &EKCalendar) -> Calendar {
        // SAFETY: plain getters on a live calendar.
        unsafe {
            Calendar {
                id: c.calendarIdentifier().to_string(),
                title: c.title().to_string(),
                color: hex(c.CGColor()),
                source: c.source().map(|s| s.title().to_string()),
                writable: c.allowsContentModifications(),
            }
        }
    }

    fn participant_status(s: EKParticipantStatus) -> &'static str {
        match s {
            EKParticipantStatus::Accepted => "accepted",
            EKParticipantStatus::Declined => "declined",
            EKParticipantStatus::Tentative => "tentative",
            EKParticipantStatus::Pending => "pending",
            _ => "unknown",
        }
    }

    /// A participant's name, else the address behind its `mailto:` url.
    fn participant_name(p: &EKParticipant) -> String {
        // SAFETY: plain getters.
        unsafe {
            text(p.name()).unwrap_or_else(|| {
                let u = p.URL().absoluteString().map(|s| s.to_string()).unwrap_or_default();
                u.strip_prefix("mailto:").unwrap_or(&u).to_string()
            })
        }
    }

    fn event(e: &EKEvent) -> Event {
        // SAFETY: plain getters on a live event, on the thread that fetched it.
        unsafe {
            let attendees: Vec<Attendee> = e
                .attendees()
                .map(|a| a.iter().map(|p| Attendee { name: participant_name(&p), status: participant_status(p.participantStatus()).into(), me: p.isCurrentUser() }).collect())
                .unwrap_or_default();
            let my_status = attendees.iter().find(|a| a.me).map(|a| a.status.clone());
            let recurring = e.hasRecurrenceRules() || e.isDetached();
            let location = text(e.location());
            let notes = text(e.notes());
            let url = e.URL().and_then(|u| u.absoluteString()).map(|s| s.to_string()).filter(|s| !s.is_empty());
            Event {
                id: e.eventIdentifier().map(|s| s.to_string()).unwrap_or_default(),
                occurrence: recurring.then(|| e.occurrenceDate().map_or_else(|| ms(&e.startDate()), |d| ms(&d))),
                title: e.title().to_string(),
                start: ms(&e.startDate()),
                end: ms(&e.endDate()),
                all_day: e.isAllDay(),
                conference_url: super::conference_url(url.as_deref(), location.as_deref(), notes.as_deref()),
                location,
                notes,
                url,
                calendar: e.calendar().map(|c| calendar(&c)).unwrap_or(Calendar { id: String::new(), title: String::new(), color: None, source: None, writable: false }),
                attendees,
                organizer: e.organizer().map(|o| participant_name(&o)),
                recurring,
                my_status,
            }
        }
    }

    pub fn calendars() -> Result<Vec<Calendar>> {
        need_access()?;
        let s = store();
        // SAFETY: the store is live; the array is ours.
        let mut out: Vec<Calendar> = unsafe { s.calendarsForEntityType(EKEntityType::Event) }.iter().map(|c| calendar(&c)).collect();
        out.sort_by(|a, b| (a.source.as_deref().unwrap_or(""), a.title.to_lowercase()).cmp(&(b.source.as_deref().unwrap_or(""), b.title.to_lowercase())));
        Ok(out)
    }

    /// The store's calendars with these ids, or none for "all"; an unknown
    /// id is a refusal rather than silently everything.
    fn chosen(s: &EKEventStore, ids: Option<&[String]>) -> Result<Option<Retained<NSArray<EKCalendar>>>> {
        let Some(ids) = ids.filter(|ids| !ids.is_empty()) else { return Ok(None) };
        // SAFETY: the store is live.
        let all = unsafe { s.calendarsForEntityType(EKEntityType::Event) };
        // SAFETY: plain getter.
        let picked: Vec<Retained<EKCalendar>> = all.iter().filter(|c| ids.contains(&unsafe { c.calendarIdentifier() }.to_string())).collect();
        if picked.is_empty() {
            return Err(Error::Failed("no such calendar".into()));
        }
        Ok(Some(NSArray::from_retained_slice(&picked)))
    }

    fn matching(s: &EKEventStore, from: i64, to: i64, cals: Option<&NSArray<EKCalendar>>) -> Vec<Retained<EKEvent>> {
        // SAFETY: the predicate comes from this store, as EventKit requires; the dates are ours.
        unsafe {
            let pred = s.predicateForEventsWithStartDate_endDate_calendars(&date(from), &date(to), cals);
            s.eventsMatchingPredicate(&pred).iter().collect()
        }
    }

    pub fn events(from: i64, to: i64, calendars: Option<&[String]>) -> Result<Vec<Event>> {
        need_access()?;
        if to <= from {
            return Ok(vec![]);
        }
        let s = store();
        let cals = chosen(&s, calendars)?;
        let mut out: Vec<Event> = matching(&s, from, to, cals.as_deref()).iter().map(|e| event(e)).collect();
        out.sort_by(|a, b| (a.start, a.end, &a.title).cmp(&(b.start, b.end, &b.title)));
        Ok(out)
    }

    pub fn create(n: &NewEvent) -> Result<String> {
        need_access()?;
        if n.title.trim().is_empty() {
            return Err(Error::Failed("an event needs a title".into()));
        }
        if n.end <= n.start {
            return Err(Error::Failed("the end is not after the start".into()));
        }
        let s = store();
        // SAFETY: the event belongs to this store; every setter takes an owned or borrowed value that outlives the call.
        unsafe {
            let cal = match &n.calendar {
                Some(id) => s.calendarWithIdentifier(&NSString::from_str(id)).ok_or_else(|| Error::Failed(format!("no calendar {id}")))?,
                None => s.defaultCalendarForNewEvents().ok_or_else(|| Error::Failed("no default calendar for new events".into()))?,
            };
            if !cal.allowsContentModifications() {
                return Err(Error::Failed(format!("{} does not take new events", cal.title())));
            }
            let e = EKEvent::eventWithEventStore(&s);
            e.setCalendar(Some(&cal));
            e.setTitle(Some(&NSString::from_str(n.title.trim())));
            e.setStartDate(Some(&date(n.start)));
            e.setEndDate(Some(&date(n.end)));
            e.setAllDay(n.all_day);
            if let Some(l) = n.location.as_deref().filter(|l| !l.trim().is_empty()) {
                e.setLocation(Some(&NSString::from_str(l.trim())));
            }
            if let Some(t) = n.notes.as_deref().filter(|t| !t.trim().is_empty()) {
                e.setNotes(Some(&NSString::from_str(t.trim())));
            }
            s.saveEvent_span_error(&e, EKSpan::ThisEvent).map_err(|err| Error::Failed(err.localizedDescription().to_string()))?;
            Ok(e.eventIdentifier().map(|s| s.to_string()).unwrap_or_default())
        }
    }

    /// The event by id, or the occurrence of it that starts at `occurrence`.
    fn find(s: &EKEventStore, id: &str, occurrence: Option<i64>) -> Result<Retained<EKEvent>> {
        let missing = || Error::Failed(format!("no event {id}"));
        let Some(at) = occurrence else {
            // SAFETY: the store is live.
            return unsafe { s.eventWithIdentifier(&NSString::from_str(id)) }.ok_or_else(missing);
        };
        let slack = (OCCURRENCE_SLACK * 1000.0) as i64;
        matching(s, at - slack, at + slack, None)
            .into_iter()
            // SAFETY: plain getters.
            .find(|e| unsafe { e.eventIdentifier() }.is_some_and(|i| i.to_string() == id) && (ms(unsafe { &e.startDate() }) - at).abs() <= slack)
            .ok_or_else(missing)
    }

    pub fn delete(id: &str, occurrence: Option<i64>) -> Result<()> {
        need_access()?;
        let s = store();
        let e = find(&s, id, occurrence)?;
        // SAFETY: the event came from this store.
        unsafe { s.removeEvent_span_error(&e, EKSpan::ThisEvent) }.map_err(|err| Error::Failed(err.localizedDescription().to_string()))
    }

    pub fn open(id: &str, occurrence: Option<i64>) -> Result<()> {
        let url = match occurrence {
            Some(at) => format!("ical://ekevent/{}/{id}?method=show&options=more", super::ical_stamp(at)),
            None => format!("ical://ekevent/{id}?method=show&options=more"),
        };
        let mut child = std::process::Command::new("open").arg(url).spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::time::Duration;

    use super::{khal, Calendar, Error, Event, NewEvent, Result, Status};

    pub fn permission() -> Status {
        if crate::fs::on_path("khal") {
            Status::Granted
        } else {
            Status::Unavailable
        }
    }

    pub fn request(_wait: Duration) -> Result<Status> {
        Ok(permission())
    }

    pub fn open_settings() -> std::io::Result<()> {
        Ok(())
    }

    fn need() -> Result<()> {
        match permission() {
            Status::Granted => Ok(()),
            _ => Err(Error::Unavailable("khal is not installed".into())),
        }
    }

    pub fn calendars() -> Result<Vec<Calendar>> {
        need()?;
        Ok(khal::calendars(&crate::tool::run("khal", &["printcalendars"])?))
    }

    pub fn events(from: i64, to: i64, calendars: Option<&[String]>) -> Result<Vec<Event>> {
        need()?;
        if to <= from {
            return Ok(vec![]);
        }
        let f = khal::formats()?;
        let (a, b) = (khal::local(from.div_euclid(1000)), khal::local((to - 1).div_euclid(1000)));
        let mut args: Vec<String> = ["list", "-o"].iter().map(|s| s.to_string()).collect();
        for c in calendars.unwrap_or_default() {
            args.push("-a".into());
            args.push(c.clone());
        }
        for field in khal::FIELDS {
            args.push("--json".into());
            args.push((*field).into());
        }
        args.push(f.date.format(&a));
        args.push(f.date.format(&b));
        let out = crate::tool::run("khal", &args.iter().map(String::as_str).collect::<Vec<_>>())?;
        let mut out = khal::events(&out, &f, khal::to_unix);
        out.retain(|e| e.end > from && e.start < to);
        out.sort_by(|a, b| (a.start, a.end, &a.title).cmp(&(b.start, b.end, &b.title)));
        Ok(out)
    }

    /// khal 0.14 prints nothing after `new` (even with `--json uid`), so
    /// the id comes back empty; the caller lists again to see the event.
    pub fn create(n: &NewEvent) -> Result<String> {
        need()?;
        if n.title.trim().is_empty() {
            return Err(Error::Failed("an event needs a title".into()));
        }
        if n.end <= n.start {
            return Err(Error::Failed("the end is not after the start".into()));
        }
        let f = khal::formats()?;
        let args = khal::new_args(n, &f, khal::local)?;
        let out = crate::tool::run("khal", &args.iter().map(String::as_str).collect::<Vec<_>>())?;
        Ok(khal::first_uid(&out).unwrap_or_default())
    }

    pub fn delete(_id: &str, _occurrence: Option<i64>) -> Result<()> {
        Err(Error::Unavailable("khal has no delete command; remove the event in ikhal".into()))
    }

    pub fn open(_id: &str, _occurrence: Option<i64>) -> Result<()> {
        Err(Error::Unavailable("khal has no way to show one event".into()))
    }
}

/// The khal side, kept pure so it is tested on every platform: the
/// date/time patterns read off `khal printformats` (khal prints dates the
/// way the user's config says, so the pattern is derived from its sample
/// rather than assumed), the `list --json` rows, the `new` arguments.
pub mod khal {
    use super::{Attendee, Calendar, Event, NewEvent};

    /// The json fields asked of `khal list`, in this order.
    pub const FIELDS: &[&str] = &["uid", "title", "start-date-long", "start-time", "end-date-long", "end-time", "location", "description", "url", "calendar", "calendar-color", "repeat-symbol"];

    /// A wall-clock moment, no zone.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct Civil {
        pub y: i32,
        pub m: u32,
        pub d: u32,
        pub hh: u32,
        pub mm: u32,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Tok {
        Y4,
        Y2,
        Mon,
        MonAbbr,
        MonName,
        Weekday,
        Day,
        H24,
        H12,
        Min,
        Sec,
        AmPm,
        Lit(char),
    }

    /// A strftime-like pattern learnt from khal's sample for 2013-12-21
    /// 21:45: `21.12.2013` reads as day, month, year.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Pattern(Vec<Tok>);

    const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

    impl Pattern {
        /// From the sample `printformats` prints for the moment 2013-12-21 21:45 (Saturday).
        pub fn learn(sample: &str) -> Pattern {
            let mut toks = vec![];
            let mut seen_day = false;
            let lower = sample.to_lowercase();
            let has_month = lower.contains("dec") || lower.split(|c: char| !c.is_ascii_digit()).any(|run| run == "12");
            let chars: Vec<char> = sample.chars().collect();
            let mut i = 0;
            while i < chars.len() {
                let c = chars[i];
                if c.is_ascii_digit() {
                    let j = (i..chars.len()).find(|&j| !chars[j].is_ascii_digit()).unwrap_or(chars.len());
                    let run: String = chars[i..j].iter().collect();
                    toks.push(match run.as_str() {
                        "2013" => Tok::Y4,
                        "13" => Tok::Y2,
                        "12" => Tok::Mon,
                        // The day in a date, the hour in a time; a datetime sample has both, day first.
                        "21" if has_month && !seen_day => {
                            seen_day = true;
                            Tok::Day
                        }
                        "21" => Tok::H24,
                        "09" | "9" => Tok::H12,
                        "45" => Tok::Min,
                        "00" => Tok::Sec,
                        _ => Tok::Lit('?'),
                    });
                    i = j;
                } else if c.is_alphabetic() {
                    let j = (i..chars.len()).find(|&j| !chars[j].is_alphabetic()).unwrap_or(chars.len());
                    let run: String = chars[i..j].iter().collect::<String>().to_lowercase();
                    toks.push(match run.as_str() {
                        "dec" => Tok::MonAbbr,
                        "december" => Tok::MonName,
                        "sat" | "saturday" => Tok::Weekday,
                        "pm" | "am" => Tok::AmPm,
                        _ => Tok::Lit('?'),
                    });
                    i = j;
                } else {
                    toks.push(Tok::Lit(c));
                    i += 1;
                }
            }
            Pattern(toks)
        }

        /// Read a date and/or time; fields the pattern lacks stay 0 (a date
        /// pattern gives midnight, a time pattern day 0).
        pub fn parse(&self, s: &str) -> Option<Civil> {
            let mut c = Civil::default();
            let mut pm: Option<bool> = None;
            let mut h12: Option<u32> = None;
            let mut rest = s.trim();
            for t in &self.0 {
                rest = rest.trim_start();
                match t {
                    Tok::Lit(l) => {
                        if l.is_whitespace() {
                            continue;
                        }
                        rest = rest.strip_prefix(*l)?;
                    }
                    Tok::Weekday | Tok::MonAbbr | Tok::MonName | Tok::AmPm => {
                        let n = rest.find(|ch: char| !ch.is_alphabetic()).unwrap_or(rest.len());
                        let word = rest[..n].to_lowercase();
                        rest = &rest[n..];
                        match t {
                            Tok::MonAbbr | Tok::MonName => c.m = MONTHS.iter().position(|m| m.starts_with(&word) && word.len() >= 3)? as u32 + 1,
                            Tok::AmPm => pm = Some(word == "pm"),
                            _ => {}
                        }
                    }
                    _ => {
                        let n = rest.find(|ch: char| !ch.is_ascii_digit()).unwrap_or(rest.len());
                        let v: u32 = rest[..n].parse().ok()?;
                        rest = &rest[n..];
                        match t {
                            Tok::Y4 => c.y = v as i32,
                            Tok::Y2 => c.y = 2000 + v as i32,
                            Tok::Mon => c.m = v,
                            Tok::Day => c.d = v,
                            Tok::H24 => c.hh = v,
                            Tok::H12 => h12 = Some(v),
                            Tok::Min => c.mm = v,
                            _ => {}
                        }
                    }
                }
            }
            if let Some(h) = h12 {
                c.hh = (h % 12) + if pm == Some(true) { 12 } else { 0 };
            }
            Some(c)
        }

        /// Write a moment the way the pattern reads it.
        pub fn format(&self, c: &Civil) -> String {
            let mut out = String::new();
            for t in &self.0 {
                match t {
                    Tok::Y4 => out.push_str(&format!("{:04}", c.y)),
                    Tok::Y2 => out.push_str(&format!("{:02}", c.y.rem_euclid(100))),
                    Tok::Mon => out.push_str(&format!("{:02}", c.m)),
                    Tok::MonAbbr => out.push_str(&MONTHS.get(c.m.saturating_sub(1) as usize).map_or("???".into(), |m| capital(&m[..3]))),
                    Tok::MonName => out.push_str(&MONTHS.get(c.m.saturating_sub(1) as usize).map_or("???".into(), |m| capital(m))),
                    Tok::Weekday => out.push_str(&weekday(c)),
                    Tok::Day => out.push_str(&format!("{:02}", c.d)),
                    Tok::H24 => out.push_str(&format!("{:02}", c.hh)),
                    Tok::H12 => out.push_str(&format!("{:02}", if c.hh.is_multiple_of(12) { 12 } else { c.hh % 12 })),
                    Tok::Min => out.push_str(&format!("{:02}", c.mm)),
                    Tok::Sec => out.push_str("00"),
                    Tok::AmPm => out.push_str(if c.hh >= 12 { "PM" } else { "AM" }),
                    Tok::Lit(l) => out.push(*l),
                }
            }
            out
        }
    }

    fn capital(s: &str) -> String {
        let mut cs = s.chars();
        cs.next().map(|f| f.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default()
    }

    /// Zeller-free weekday from the civil date (Sakamoto), abbreviated.
    fn weekday(c: &Civil) -> String {
        const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
        let y = if c.m < 3 { c.y - 1 } else { c.y };
        let w = (y + y / 4 - y / 100 + y / 400 + T[(c.m.clamp(1, 12) - 1) as usize] + c.d as i32).rem_euclid(7);
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w as usize].into()
    }

    /// The user's formats, as `khal printformats` prints them.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Formats {
        pub date: Pattern,
        pub time: Pattern,
        pub datetime: Pattern,
    }

    /// `longdateformat: 2013-12-21` lines to patterns; a missing line
    /// falls back to the ISO shapes.
    pub fn parse_formats(out: &str) -> Formats {
        let line = |key: &str, fallback: &str| {
            let sample = out.lines().find_map(|l| l.strip_prefix(key).and_then(|r| r.strip_prefix(':'))).map(str::trim).filter(|s| !s.is_empty()).unwrap_or(fallback);
            Pattern::learn(sample)
        };
        Formats { date: line("longdateformat", "2013-12-21"), time: line("timeformat", "21:45"), datetime: line("longdatetimeformat", "2013-12-21 21:45") }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn formats() -> super::Result<Formats> {
        use std::sync::OnceLock;
        static CACHE: OnceLock<Formats> = OnceLock::new();
        if let Some(f) = CACHE.get() {
            return Ok(f.clone());
        }
        let f = parse_formats(&crate::tool::run("khal", &["printformats"])?);
        let _ = CACHE.set(f.clone());
        Ok(f)
    }

    /// khal's colour words to hex; a `#rrggbb` passes through.
    pub fn color(name: &str) -> Option<String> {
        let n = name.trim().to_lowercase();
        if n.starts_with('#') && n.len() == 7 {
            return Some(n);
        }
        let hex = match n.as_str() {
            "black" => "#000000",
            "white" => "#ffffff",
            "brown" => "#8b4513",
            "yellow" => "#ffd700",
            "dark gray" | "dark grey" => "#555555",
            "light gray" | "light grey" => "#aaaaaa",
            "dark green" => "#1e7d34",
            "light green" | "green" => "#3cb371",
            "dark blue" => "#1e4d8c",
            "light blue" | "blue" => "#4a90d9",
            "dark magenta" => "#8b008b",
            "magenta" | "light magenta" => "#ff00ff",
            "dark red" => "#8b0000",
            "light red" | "red" => "#e0443e",
            "dark cyan" => "#008b8b",
            "light cyan" | "cyan" => "#00cccc",
            _ => return None,
        };
        Some(hex.into())
    }

    /// `printcalendars` output: one name per line.
    pub fn calendars(out: &str) -> Vec<Calendar> {
        out.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("warning")).map(|l| Calendar { id: l.into(), title: l.into(), color: None, source: None, writable: true }).collect()
    }

    /// `list --json` prints one JSON array per day; `to_unix` turns the
    /// wall-clock moments into ms (the caller's zone). A row whose dates do
    /// not read is skipped.
    pub fn events(out: &str, f: &Formats, to_unix: impl Fn(&Civil) -> i64) -> Vec<Event> {
        let mut seen = std::collections::HashSet::new();
        let mut events = vec![];
        for line in out.lines().map(str::trim).filter(|l| l.starts_with('[')) {
            let Ok(rows) = serde_json::from_str::<Vec<serde_json::Map<String, serde_json::Value>>>(line) else { continue };
            for r in rows {
                let get = |k: &str| r.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
                let (Some(sd), Some(ed)) = (get("start-date-long").and_then(|s| f.date.parse(&s)), get("end-date-long").and_then(|s| f.date.parse(&s))) else { continue };
                let (st, et) = (get("start-time").and_then(|s| f.time.parse(&s)), get("end-time").and_then(|s| f.time.parse(&s)));
                let all_day = st.is_none();
                let start = to_unix(&Civil { hh: st.map_or(0, |t| t.hh), mm: st.map_or(0, |t| t.mm), ..sd });
                let end = match et {
                    Some(t) => to_unix(&Civil { hh: t.hh, mm: t.mm, ..ed }),
                    // khal prints an all-day event's last day; the wire's end is the midnight after.
                    None => to_unix(&ed) + 86_400_000,
                };
                let recurring = get("repeat-symbol").is_some();
                let uid = get("uid").unwrap_or_default();
                if !seen.insert((uid.clone(), start)) {
                    continue;
                }
                let (location, notes, url) = (get("location"), get("description"), get("url"));
                events.push(Event {
                    id: uid,
                    occurrence: recurring.then_some(start),
                    title: get("title").unwrap_or_default(),
                    start,
                    end,
                    all_day,
                    conference_url: super::conference_url(url.as_deref(), location.as_deref(), notes.as_deref()),
                    location,
                    notes,
                    url,
                    calendar: {
                        let name = get("calendar").unwrap_or_default();
                        Calendar { id: name.clone(), title: name, color: get("calendar-color").and_then(|c| color(&c)), source: None, writable: true }
                    },
                    attendees: Vec::<Attendee>::new(),
                    organizer: None,
                    recurring,
                    my_status: None,
                });
            }
        }
        events
    }

    /// The `khal new` argv for an event: `-a CAL -l LOC --json uid START
    /// [END] SUMMARY [:: DESCRIPTION]`, dates and times in the user's
    /// formats; `to_civil` is the zone. A timed event needs a
    /// `datetimeformat` khal can read back: with the C locale's default
    /// (`%c`, `Sat Dec 21 21:45:00 2013`) khal's own parser takes the
    /// weekday for a date and makes an all-day event of the rest, so that
    /// is refused here rather than saved wrong.
    pub fn new_args(n: &NewEvent, f: &Formats, to_civil: impl Fn(i64) -> Civil) -> super::Result<Vec<String>> {
        if !n.all_day && f.datetime.0.contains(&Tok::Weekday) {
            return Err(super::Error::Failed("khal cannot read its own datetimeformat (%c); set datetimeformat = %Y-%m-%d %H:%M under [locale] in khal's config".into()));
        }
        let mut args: Vec<String> = vec!["new".into(), "--json".into(), "uid".into()];
        if let Some(c) = n.calendar.as_deref().filter(|c| !c.is_empty()) {
            args.push("-a".into());
            args.push(c.into());
        }
        if let Some(l) = n.location.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
            args.push("-l".into());
            args.push(l.into());
        }
        let (a, b) = (to_civil(n.start.div_euclid(1000)), to_civil((n.end - 1).div_euclid(1000)));
        if n.all_day {
            args.push(f.date.format(&a));
            args.push(f.date.format(&b));
        } else {
            args.push(f.datetime.format(&a));
            args.push(f.datetime.format(&to_civil(n.end.div_euclid(1000))));
        }
        let mut summary = n.title.trim().to_string();
        if let Some(d) = n.notes.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            summary.push_str(" :: ");
            summary.push_str(d);
        }
        args.push(summary);
        Ok(args)
    }

    /// The `uid` of the first row `khal new --json uid` printed.
    pub fn first_uid(out: &str) -> Option<String> {
        out.lines().map(str::trim).filter(|l| l.starts_with('[')).find_map(|l| serde_json::from_str::<Vec<serde_json::Value>>(l).ok()).and_then(|rows| rows.first().and_then(|r| r.get("uid")).and_then(|v| v.as_str()).map(String::from))
    }

    /// Unix seconds to the local wall clock (libc `localtime_r`).
    #[cfg(not(target_os = "macos"))]
    pub fn local(secs: i64) -> Civil {
        let t: libc::time_t = secs as libc::time_t;
        // SAFETY: a zeroed tm is a valid out-param; localtime_r fills it.
        let tm = unsafe {
            let mut tm: libc::tm = std::mem::zeroed();
            libc::localtime_r(&t, &mut tm);
            tm
        };
        Civil { y: tm.tm_year + 1900, m: (tm.tm_mon + 1) as u32, d: tm.tm_mday as u32, hh: tm.tm_hour as u32, mm: tm.tm_min as u32 }
    }

    /// The local wall clock to unix ms (libc `mktime`).
    #[cfg(not(target_os = "macos"))]
    pub fn to_unix(c: &Civil) -> i64 {
        // SAFETY: a zeroed tm with the fields set is what mktime reads; tm_isdst -1 lets it decide.
        let secs = unsafe {
            let mut tm: libc::tm = std::mem::zeroed();
            tm.tm_year = c.y - 1900;
            tm.tm_mon = c.m as i32 - 1;
            tm.tm_mday = c.d as i32;
            tm.tm_hour = c.hh as i32;
            tm.tm_min = c.mm as i32;
            tm.tm_isdst = -1;
            libc::mktime(&mut tm)
        };
        secs as i64 * 1000
    }
}

#[cfg(test)]
mod tests {
    use super::khal::{Civil, Formats, Pattern};
    use super::*;

    #[test]
    fn conference_links_by_provider() {
        let z = "https://us02web.zoom.us/j/81234567890?pwd=abc";
        assert_eq!(conference_url(None, None, Some(&format!("Join: {z}."))).as_deref(), Some(z));
        assert_eq!(conference_url(None, Some("https://meet.google.com/abc-defg-hij"), None).as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        let t = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d";
        assert_eq!(conference_url(None, None, Some(&format!("<{t}>"))).as_deref(), Some(t));
        assert_eq!(conference_url(None, None, Some("https://acme.webex.com/acme/j.php?MTID=m1")).as_deref(), Some("https://acme.webex.com/acme/j.php?MTID=m1"));
        assert_eq!(conference_url(None, None, Some("https://meet.jit.si/PalRoom")).as_deref(), Some("https://meet.jit.si/PalRoom"));
        assert_eq!(conference_url(None, None, Some("https://acme.whereby.com/room")).as_deref(), Some("https://acme.whereby.com/room"));
    }

    #[test]
    fn conference_link_order_and_noise() {
        // The url field beats the location, the location beats the notes.
        assert_eq!(conference_url(Some("https://zoom.us/j/1"), Some("https://meet.google.com/a-b-c"), Some("https://zoom.us/j/3")).as_deref(), Some("https://zoom.us/j/1"));
        assert_eq!(conference_url(Some("https://example.com/agenda"), Some("Room 4"), Some("dial in https://zoom.us/j/3")).as_deref(), Some("https://zoom.us/j/3"));
        // A marketing page, a docs link, no link at all.
        assert_eq!(conference_url(Some("https://zoom.us/pricing"), None, Some("https://docs.google.com/x https://meet.google.com/new")), None);
        assert_eq!(conference_url(None, Some("Room 4"), Some("bring slides")), None);
        // Trailing punctuation and HTML entities.
        assert_eq!(conference_url(None, None, Some("(https://meet.google.com/abc-defg-hij), then https://zoom.us/j/9?pwd=a&amp;b=c")).as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert_eq!(conference_url(None, None, Some("https://zoom.us/j/9?pwd=a&amp;b=c")).as_deref(), Some("https://zoom.us/j/9?pwd=a&b=c"));
        // Case in the scheme, and a zoomgov host.
        assert_eq!(conference_url(None, None, Some("HTTPS://ZOOMGOV.com/j/5")).as_deref(), Some("HTTPS://ZOOMGOV.com/j/5"));
    }

    #[test]
    fn outlook_safelinks_are_unwrapped() {
        let wrapped = "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253Ax%2F0%3Fcontext%3D1&data=05%7C02";
        assert_eq!(conference_url(None, None, Some(wrapped)).as_deref(), Some("https://teams.microsoft.com/l/meetup-join/19%3Ax/0?context=1"));
        assert_eq!(percent_decode("a%20b%zz"), "a b%zz");
    }

    #[test]
    fn utc_stamps() {
        assert_eq!(civil_utc(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil_utc(1_789_540_200), (2026, 9, 16, 6, 30, 0));
        assert_eq!(ical_stamp(1_789_540_200_000), "20260916T063000Z");
        assert_eq!(ical_stamp(-1000), "19691231T235959Z");
        assert_eq!(civil_utc(951_782_400), (2000, 2, 29, 0, 0, 0));
    }

    #[test]
    fn khal_patterns_learn_parse_format() {
        let iso = Pattern::learn("2013-12-21");
        assert_eq!(iso.parse("2026-09-16"), Some(Civil { y: 2026, m: 9, d: 16, hh: 0, mm: 0 }));
        assert_eq!(iso.format(&Civil { y: 2026, m: 9, d: 16, hh: 0, mm: 0 }), "2026-09-16");
        let de = Pattern::learn("21.12.2013");
        assert_eq!(de.parse("5.3.2026"), Some(Civil { y: 2026, m: 3, d: 5, hh: 0, mm: 0 }));
        assert_eq!(de.format(&Civil { y: 2026, m: 3, d: 5, hh: 0, mm: 0 }), "05.03.2026");
        let us = Pattern::learn("12/21/13");
        assert_eq!(us.parse("9/16/26"), Some(Civil { y: 2026, m: 9, d: 16, hh: 0, mm: 0 }));
        let words = Pattern::learn("Sat, Dec 21 2013");
        assert_eq!(words.parse("Wed, Sep 16 2026"), Some(Civil { y: 2026, m: 9, d: 16, hh: 0, mm: 0 }));
        assert_eq!(words.format(&Civil { y: 2026, m: 9, d: 16, hh: 0, mm: 0 }), "Wed, Sep 16 2026");
        let t24 = Pattern::learn("21:45");
        assert_eq!(t24.parse("09:05"), Some(Civil { hh: 9, mm: 5, ..Civil::default() }));
        assert_eq!(t24.format(&Civil { hh: 9, mm: 5, ..Civil::default() }), "09:05");
        let t12 = Pattern::learn("09:45 PM");
        assert_eq!(t12.parse("12:30 AM"), Some(Civil { hh: 0, mm: 30, ..Civil::default() }));
        assert_eq!(t12.parse("1:15 pm"), Some(Civil { hh: 13, mm: 15, ..Civil::default() }));
        assert_eq!(t12.format(&Civil { hh: 13, mm: 15, ..Civil::default() }), "01:15 PM");
        let dt = Pattern::learn("2013-12-21 21:45");
        assert_eq!(dt.parse("2026-09-16 10:00"), Some(Civil { y: 2026, m: 9, d: 16, hh: 10, mm: 0 }));
        assert_eq!(dt.format(&Civil { y: 2026, m: 9, d: 16, hh: 10, mm: 0 }), "2026-09-16 10:00");
        let dt_de = Pattern::learn("21.12.2013 21:45");
        assert_eq!(dt_de.parse("16.09.2026 10:00"), Some(Civil { y: 2026, m: 9, d: 16, hh: 10, mm: 0 }));
        assert_eq!(iso.parse("not a date"), None);
        // khal without [locale] formats prints the C locale's %c / %x / %X (seen on marko).
        let c = Pattern::learn("Sat Dec 21 21:45:00 2013");
        assert_eq!(c.parse("Sun Sep 20 14:05:00 2026"), Some(Civil { y: 2026, m: 9, d: 20, hh: 14, mm: 5 }));
        assert_eq!(c.format(&Civil { y: 2026, m: 9, d: 20, hh: 14, mm: 5 }), "Sun Sep 20 14:05:00 2026");
        let x = Pattern::learn("12/21/13");
        assert_eq!(x.parse("09/21/26"), Some(Civil { y: 2026, m: 9, d: 21, hh: 0, mm: 0 }));
        assert_eq!(x.format(&Civil { y: 2026, m: 9, d: 21, hh: 0, mm: 0 }), "09/21/26");
        assert_eq!(Pattern::learn("21:45:00").parse("14:05:59"), Some(Civil { hh: 14, mm: 5, ..Civil::default() }));
    }

    const PRINTFORMATS: &str = "longdatetimeformat: 2013-12-21 21:45\ndatetimeformat: 2013-12-21 21:45\nlongdateformat: 2013-12-21\ndateformat: 2013-12-21\ntimeformat: 21:45\n";
    // `khal list -o --json …` on marko (khal 0.14), one array per day.
    const LIST: &str = r##"[{"uid": "evt-1@test", "title": "Standup", "start-date-long": "2026-09-16", "start-time": "10:00", "end-date-long": "2026-09-16", "end-time": "10:30", "location": "https://meet.google.com/abc-defg-hij", "description": "Daily sync\nsecond line", "url": "https://example.com/standup", "calendar": "work", "calendar-color": "dark blue", "repeat-symbol": "⟳"}]
[{"uid": "evt-2@test", "title": "Holiday | day off", "start-date-long": "2026-09-17", "start-time": "", "end-date-long": "2026-09-17", "end-time": "", "location": "", "description": "", "url": "", "calendar": "home", "calendar-color": "#ff8800", "repeat-symbol": ""}, {"uid": "evt-1@test", "title": "Standup", "start-date-long": "2026-09-17", "start-time": "10:00", "end-date-long": "2026-09-17", "end-time": "10:30", "location": "https://meet.google.com/abc-defg-hij", "description": "Daily sync\nsecond line", "url": "https://example.com/standup", "calendar": "work", "calendar-color": "dark blue", "repeat-symbol": "⟳"}]
"##;

    /// A fake zone: UTC, so the fixtures read the same everywhere.
    fn utc(c: &Civil) -> i64 {
        let days = {
            let (y, m) = if c.m <= 2 { (c.y as i64 - 1, c.m as i64 + 9) } else { (c.y as i64, c.m as i64 - 3) };
            let era = y.div_euclid(400);
            let yoe = y - era * 400;
            let doy = (153 * m + 2) / 5 + c.d as i64 - 1;
            let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
            era * 146_097 + doe - 719_468
        };
        (days * 86_400 + c.hh as i64 * 3600 + c.mm as i64 * 60) * 1000
    }

    #[test]
    fn khal_list_rows() {
        let f: Formats = khal::parse_formats(PRINTFORMATS);
        let evs = khal::events(LIST, &f, utc);
        assert_eq!(evs.len(), 3);
        let s = &evs[0];
        assert_eq!((s.id.as_str(), s.title.as_str(), s.all_day, s.recurring), ("evt-1@test", "Standup", false, true));
        assert_eq!((s.start, s.end), (utc(&Civil { y: 2026, m: 9, d: 16, hh: 10, mm: 0 }), utc(&Civil { y: 2026, m: 9, d: 16, hh: 10, mm: 30 })));
        assert_eq!(s.occurrence, Some(s.start));
        assert_eq!(s.conference_url.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert_eq!(s.calendar, Calendar { id: "work".into(), title: "work".into(), color: Some("#1e4d8c".into()), source: None, writable: true });
        assert_eq!(s.notes.as_deref(), Some("Daily sync\nsecond line"));
        let h = &evs[1];
        assert_eq!((h.title.as_str(), h.all_day, h.recurring, h.occurrence), ("Holiday | day off", true, false, None));
        assert_eq!((h.start, h.end), (utc(&Civil { y: 2026, m: 9, d: 17, hh: 0, mm: 0 }), utc(&Civil { y: 2026, m: 9, d: 18, hh: 0, mm: 0 })));
        assert_eq!(h.calendar.color.as_deref(), Some("#ff8800"));
        assert_eq!((&h.location, &h.notes, &h.url, &h.conference_url), (&None, &None, &None, &None));
        assert_eq!(evs[2].occurrence, Some(utc(&Civil { y: 2026, m: 9, d: 17, hh: 10, mm: 0 })));
        assert!(khal::events("warning: nothing\n", &f, utc).is_empty());
    }

    #[test]
    fn khal_calendars_and_new() {
        assert_eq!(khal::calendars("warning: The .ics file is odd\nwork\nhome\n").iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["work", "home"]);
        let f = khal::parse_formats("longdateformat: 21.12.2013\ntimeformat: 21:45\nlongdatetimeformat: 21.12.2013 21:45\n");
        let civil = |secs: i64| {
            let (y, m, d, hh, mm, _) = civil_utc(secs);
            Civil { y: y as i32, m, d, hh, mm }
        };
        let timed = NewEvent { title: " Dentist ".into(), start: utc(&Civil { y: 2026, m: 9, d: 20, hh: 14, mm: 0 }), end: utc(&Civil { y: 2026, m: 9, d: 20, hh: 15, mm: 0 }), all_day: false, calendar: Some("home".into()), location: Some("Room 1".into()), notes: Some("bring card".into()) };
        assert_eq!(khal::new_args(&timed, &f, civil).unwrap(), vec!["new", "--json", "uid", "-a", "home", "-l", "Room 1", "20.09.2026 14:00", "20.09.2026 15:00", "Dentist :: bring card"]);
        let day = NewEvent { title: "Trip".into(), start: utc(&Civil { y: 2026, m: 9, d: 20, hh: 0, mm: 0 }), end: utc(&Civil { y: 2026, m: 9, d: 22, hh: 0, mm: 0 }), all_day: true, ..Default::default() };
        assert_eq!(khal::new_args(&day, &f, civil).unwrap(), vec!["new", "--json", "uid", "20.09.2026", "21.09.2026", "Trip"]);
        // The C locale's %c: a timed event is refused, an all-day one goes through %x.
        let c = khal::parse_formats("longdatetimeformat: Sat Dec 21 21:45:00 2013\ndatetimeformat: Sat Dec 21 21:45:00 2013\nlongdateformat: 12/21/13\ndateformat: 12/21/13\ntimeformat: 21:45:00\n");
        assert!(matches!(khal::new_args(&timed, &c, civil), Err(Error::Failed(m)) if m.contains("datetimeformat")));
        assert_eq!(khal::new_args(&day, &c, civil).unwrap(), vec!["new", "--json", "uid", "09/20/26", "09/21/26", "Trip"]);
        assert_eq!(khal::first_uid("[{\"uid\": \"ABC\"}]\n").as_deref(), Some("ABC"));
        assert_eq!(khal::first_uid("nothing"), None);
        assert_eq!(khal::color("Dark Blue").as_deref(), Some("#1e4d8c"));
        assert_eq!(khal::color("#ABCDEF").as_deref(), Some("#abcdef"));
        assert_eq!(khal::color("plaid"), None);
    }

    #[test]
    fn status_wire_names() {
        assert_eq!(serde_json::to_string(&Status::NotDetermined).unwrap(), "\"not_determined\"");
        assert_eq!(serde_json::from_str::<Status>("\"granted\"").unwrap(), Status::Granted);
    }
}
