//! The calendar capability from a terminal, for checking a machine:
//! `cargo run -q -p pal-core --example calendar -- permission`                   the state, no prompt
//! `cargo run -q -p pal-core --example calendar -- request`                      the system prompt (once), then the state
//! `cargo run -q -p pal-core --example calendar -- calendars`
//! `cargo run -q -p pal-core --example calendar -- events 2026-09-16 2026-09-18` events between two UTC dates (end exclusive)
//! `cargo run -q -p pal-core --example calendar -- create "Title" 2026-09-20T14:00Z 2026-09-20T15:00Z [calendar id]`
//! `cargo run -q -p pal-core --example calendar -- delete <id> [occurrence ms]`
//! `cargo run -q -p pal-core --example calendar -- open <id> [occurrence ms]`
use std::time::{Duration, Instant};

use pal_core::calendar::{self, NewEvent};

/// `YYYY-MM-DD` or `YYYY-MM-DDTHH:MMZ`, read as UTC, to unix ms.
fn ms(s: &str) -> i64 {
    let (date, time) = s.split_once('T').map_or((s, "00:00"), |(d, t)| (d, t.trim_end_matches('Z')));
    let mut d = date.split('-').map(|p| p.parse::<i64>().expect("date"));
    let (y, m, day) = (d.next().unwrap(), d.next().unwrap(), d.next().unwrap());
    let mut t = time.split(':').map(|p| p.parse::<i64>().expect("time"));
    let (hh, mm) = (t.next().unwrap(), t.next().unwrap_or(0));
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    (days * 86_400 + hh * 3600 + mm * 60) * 1000
}

fn stamp(ms: i64) -> String {
    let (y, m, d, hh, mm, _) = calendar::civil_utc(ms.div_euclid(1000));
    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}Z")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let a = |i: usize| args.get(i).map(String::as_str);
    let t0 = Instant::now();
    let r: Result<(), String> = match a(0) {
        Some("permission") => {
            println!("{:?}", calendar::permission());
            Ok(())
        }
        Some("request") => calendar::request(Duration::from_secs(120)).map(|s| println!("{s:?}")).map_err(|e| e.to_string()),
        Some("calendars") => calendar::calendars()
            .map(|cs| {
                for c in cs {
                    println!("{:<10} {:<8} {} {:<32} {}", c.source.unwrap_or_default(), c.color.unwrap_or_default(), if c.writable { "w" } else { "r" }, c.title, c.id);
                }
            })
            .map_err(|e| e.to_string()),
        Some("events") => calendar::events(ms(a(1).expect("from")), ms(a(2).expect("to")), None)
            .map(|es| {
                for e in es {
                    println!(
                        "{} {} {:<3} {:<40} cal={} att={} org={:?} join={:?} rec={} me={:?} occ={:?} id={}",
                        stamp(e.start),
                        stamp(e.end),
                        if e.all_day { "day" } else { "" },
                        e.title.chars().take(40).collect::<String>(),
                        e.calendar.title,
                        e.attendees.len(),
                        e.organizer,
                        e.conference_url,
                        e.recurring,
                        e.my_status,
                        e.occurrence,
                        e.id
                    );
                }
            })
            .map_err(|e| e.to_string()),
        Some("create") => calendar::create(&NewEvent { title: a(1).expect("title").into(), start: ms(a(2).expect("start")), end: ms(a(3).expect("end")), calendar: a(4).map(String::from), ..Default::default() })
            .map(|id| println!("created {id}"))
            .map_err(|e| e.to_string()),
        Some("delete") => calendar::delete(a(1).expect("id"), a(2).map(|s| s.parse().expect("occurrence ms"))).map_err(|e| e.to_string()),
        Some("open") => calendar::open(a(1).expect("id"), a(2).map(|s| s.parse().expect("occurrence ms"))).map_err(|e| e.to_string()),
        _ => Err("usage: calendar permission|request|calendars|events FROM TO|create TITLE START END [CAL]|delete ID [OCC]|open ID [OCC]".into()),
    };
    eprintln!("({} ms)", t0.elapsed().as_millis());
    if let Err(e) = r {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
