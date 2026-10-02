//! A main-thread watchdog: every [`EVERY`] a ping is posted to the main
//! thread; one that is not answered within [`STALL`] means pal has hung
//! (a deadlock between the main thread and a worker, or a main-thread wait
//! that never returns). Then the process samples itself once per stall
//! (`/usr/bin/sample`, every thread's stack for a few seconds) into
//! `hang-<unix>.txt` beside `pal.log`, and the log says where it is, so a
//! hang that cannot be reproduced on demand still leaves its stacks behind.
//! macOS only (`sample`); a build that keeps its symbols names the frames.

use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

/// How often the main thread is pinged.
const EVERY: Duration = Duration::from_secs(2);
/// How long an unanswered ping takes to count as a hang.
const STALL: Duration = Duration::from_secs(5);

pub fn install(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("watchdog".into()).spawn(move || {
        // One report per stall: re-armed once the main thread answers again.
        let mut reported = false;
        loop {
            std::thread::sleep(EVERY);
            let (tx, rx) = mpsc::channel();
            if app.run_on_main_thread(move || { let _ = tx.send(()); }).is_err() {
                return; // the app is going away
            }
            match rx.recv_timeout(STALL) {
                Ok(()) => reported = false,
                Err(_) if !reported => {
                    reported = true;
                    report();
                }
                Err(_) => {}
            }
        }
    });
}

fn report() {
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let file = pal_core::log::path().with_file_name(format!("hang-{at}.txt"));
    eprintln!("watchdog\tmain thread stalled {}s\tsampling into {}", STALL.as_secs(), file.display());
    let pid = std::process::id().to_string();
    match std::process::Command::new("/usr/bin/sample").args([pid.as_str(), "3", "-file"]).arg(&file).output() {
        Ok(o) if o.status.success() => eprintln!("watchdog\tsampled\t{}", file.display()),
        Ok(o) => eprintln!("watchdog\tsample failed\t{}", String::from_utf8_lossy(&o.stderr).trim()),
        Err(e) => eprintln!("watchdog\tsample failed\t{e}"),
    }
}
