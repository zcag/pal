//! The device capabilities from a terminal, for checking a machine:
//! `cargo run -q -p pal-core --example devices -- audio`                     outputs and inputs
//! `cargo run -q -p pal-core --example devices -- audio mute <id> <output|input>`  toggle mute, print the state
//! `cargo run -q -p pal-core --example devices -- bluetooth`                 paired devices
//! `cargo run -q -p pal-core --example devices -- wifi [scan]`               status, known networks, a cached scan (`scan` forces one)
//! `cargo run -q -p pal-core --example devices -- media [play_pause|next|previous <player>]`
use pal_core::{audio, bluetooth, media, wifi};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let a = |i: usize| args.get(i).map(String::as_str);
    let r: Result<(), String> = match a(0) {
        Some("audio") => match a(1) {
            Some("mute") => {
                let kind = if a(3) == Some("input") { audio::Kind::Input } else { audio::Kind::Output };
                audio::set_mute(a(2).expect("device id"), kind, None).map(|m| println!("muted: {m}")).map_err(|e| e.to_string())
            }
            _ => audio::devices()
                .map(|ds| {
                    for d in ds {
                        println!("{:>6} {} {:<48} {:>4} {:<6} {:<10} {}", format!("{:?}", d.kind).to_lowercase(), if d.default { "*" } else { " " }, d.name, d.volume.map_or("-".into(), |v| v.to_string()), d.muted.map_or("", |m| if m { "muted" } else { "" }), d.transport.as_deref().unwrap_or(""), d.id);
                    }
                })
                .map_err(|e| e.to_string()),
        },
        Some("bluetooth") => bluetooth::devices()
            .map(|ds| {
                for d in ds {
                    println!("{} {:<28} {:<10} {:<18} {} {}", if d.connected { "*" } else { " " }, d.name, d.kind, d.address, d.battery.map_or("".into(), |b| format!("{b}%")), d.battery_detail.unwrap_or_default());
                }
            })
            .map_err(|e| e.to_string()),
        Some("wifi") => (|| {
            let s = wifi::status().map_err(|e| e.to_string())?;
            println!("interface {:?} powered {} current {:?}", s.interface, s.powered, s.current);
            let k = wifi::known().map_err(|e| e.to_string())?;
            println!("known: {}", k.iter().map(|k| k.ssid.as_str()).collect::<Vec<_>>().join(", "));
            let scan = wifi::scan(if a(1) == Some("scan") { wifi::ScanMode::Fresh } else { wifi::ScanMode::Cached }).map_err(|e| e.to_string())?;
            println!("scan: {} networks, {} hidden, age {:?}", scan.networks.len(), scan.hidden, scan.age_secs);
            for n in scan.networks {
                println!("  {:>3}% {:<32} {:<20} {:<14} {}{}", n.signal, n.ssid, n.channel.unwrap_or_default(), n.security.unwrap_or_else(|| "open".into()), if n.known { "known " } else { "" }, if n.current { "current" } else { "" });
            }
            Ok(())
        })(),
        Some("media") => match (a(1), a(2)) {
            (Some(cmd), Some(player)) => {
                let c = match cmd {
                    "play_pause" => media::Command::PlayPause,
                    "next" => media::Command::Next,
                    "previous" => media::Command::Previous,
                    "play" => media::Command::Play,
                    _ => media::Command::Pause,
                };
                media::control(player, c).map_err(|e| e.to_string())
            }
            _ => media::now_playing()
                .map(|np| {
                    println!("system-wide source: {}", np.system_wide);
                    for p in np.players {
                        println!("{:<8} {:?} {} / {} / {} art={:?} app={:?} {:?}/{:?}", p.id, p.state, p.title.unwrap_or_default(), p.artist.unwrap_or_default(), p.album.unwrap_or_default(), p.artwork, p.app, p.position, p.duration);
                    }
                })
                .map_err(|e| e.to_string()),
        },
        _ => Err("usage: devices audio [mute <id> <output|input>] | bluetooth | wifi [scan] | media [play_pause|next|previous <player>]".into()),
    };
    if let Err(e) = r {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
