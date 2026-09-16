//! Wi-Fi: the current network (name, signal, channel, IP), the known
//! networks, a scan of what is in the air; join, forget, the saved
//! password, the radio on or off.
//!
//! macOS: `networksetup` (`-listallhardwareports` for the interface,
//! `-getairportpower`, `-listpreferredwirelessnetworks`,
//! `-setairportnetwork`, `-removepreferredwirelessnetwork`,
//! `-setairportpower`), `scutil` and `ipconfig getsummary` for the current
//! network, `security find-generic-password -wa <ssid>` for a password (the
//! keychain prompts, which is the user's call), and `system_profiler
//! SPAirPortDataType -json` for a scan. That scan takes ~9 s on hornet, so
//! [`scan`] keeps the last result for [`SCAN_TTL`] and [`ScanMode::Cached`]
//! never runs it; a palette shows Available from the cache and offers a
//! Scan action. macOS 15+ hands `<redacted>` for every network name to a
//! process without Location Services (`ipconfig`, `scutil`'s `SSID_STR`
//! and `system_profiler` alike on hornet), so the current name may be
//! `None` and a scan's hidden names are counted in [`Scan::hidden`] rather
//! than listed. `wdutil info` would give the name but needs sudo.
//!
//! Linux: NetworkManager over `nmcli -t` (`device`, `radio wifi`, `device
//! wifi list [--rescan yes]`, `connection show`, `device wifi connect`,
//! `connection delete`, `-s -g 802-11-wireless-security.psk connection
//! show`). The parsers are pure and fixture-tested on every platform.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub use crate::tool::{Error, Result};

/// How long a scan stays good for.
pub const SCAN_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Current {
    /// None when the OS hides it (macOS without Location Services).
    pub ssid: Option<String>,
    /// Percent, 0..100.
    pub signal: Option<u8>,
    /// `44` or `44 (5GHz, 80MHz)`, as the tool spells it.
    pub channel: Option<String>,
    pub security: Option<String>,
    pub ip: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Status {
    /// `en0`, `wlan0`; None when the machine has no Wi-Fi interface.
    pub interface: Option<String>,
    pub powered: bool,
    pub current: Option<Current>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Known {
    pub ssid: String,
    pub security: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Network {
    pub ssid: String,
    /// Percent, 0..100.
    pub signal: u8,
    pub channel: Option<String>,
    /// None for an open network.
    pub security: Option<String>,
    /// A saved network: joining needs no password.
    pub known: bool,
    pub current: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Scan {
    /// Strongest first, one entry per name.
    pub networks: Vec<Network>,
    /// Networks seen whose name the OS withheld.
    pub hidden: usize,
    /// How old the result is; None when it was just taken.
    pub age_secs: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    /// Only what a previous scan found (empty when none): never runs the tool.
    Cached,
    /// The cache while younger than [`SCAN_TTL`], else a scan.
    Auto,
    /// A scan now.
    Fresh,
}

pub fn status() -> Result<Status> {
    platform::status()
}

/// The saved networks, in the OS's preference order.
pub fn known() -> Result<Vec<Known>> {
    platform::known()
}

static SCAN: Mutex<Option<(Instant, Vec<Network>, usize)>> = Mutex::new(None);

pub fn scan(mode: ScanMode) -> Result<Scan> {
    let cached = SCAN.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let fresh = match (mode, &cached) {
        (ScanMode::Fresh, _) => true,
        (ScanMode::Cached, _) => false,
        (ScanMode::Auto, Some((at, ..))) => at.elapsed() > SCAN_TTL,
        (ScanMode::Auto, None) => true,
    };
    if !fresh {
        return Ok(match cached {
            Some((at, networks, hidden)) => Scan { networks, hidden, age_secs: Some(at.elapsed().as_secs()) },
            None => Scan::default(),
        });
    }
    let (mut networks, hidden) = platform::scan()?;
    let saved: Vec<String> = known().map(|k| k.into_iter().map(|k| k.ssid).collect()).unwrap_or_default();
    for n in &mut networks {
        n.known = n.known || saved.contains(&n.ssid);
    }
    *SCAN.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), networks.clone(), hidden));
    Ok(Scan { networks, hidden, age_secs: None })
}

/// Join by name; `password` for a network that is not saved (a saved one
/// uses its stored secret, an open one needs none).
pub fn join(ssid: &str, password: Option<&str>) -> Result<()> {
    platform::join(ssid, password.filter(|p| !p.is_empty()))
}

/// Remove a saved network.
pub fn forget(ssid: &str) -> Result<()> {
    platform::forget(ssid)
}

/// The saved password of a known network (macOS asks through the keychain prompt).
pub fn password(ssid: &str) -> Result<String> {
    platform::password(ssid).map(|p| p.trim_end_matches(['\r', '\n']).to_string())
}

pub fn set_power(on: bool) -> Result<()> {
    platform::set_power(on)
}

// ---- shared, pure ---------------------------------------------------------

/// dBm to percent the way NetworkManager does: -100 is 0, -50 is 100.
#[allow(dead_code)]
fn signal_from_dbm(dbm: i32) -> u8 {
    ((dbm + 100) * 2).clamp(0, 100) as u8
}

/// Strongest first, one entry per name (the current band of it, else the
/// strongest), the current one first of all.
fn dedupe(mut networks: Vec<Network>) -> Vec<Network> {
    networks.sort_by(|a, b| b.current.cmp(&a.current).then(b.signal.cmp(&a.signal)));
    let mut out: Vec<Network> = vec![];
    for n in networks {
        match out.iter_mut().find(|o| o.ssid == n.ssid) {
            Some(o) => {
                o.known |= n.known;
                o.current |= n.current;
            }
            None => out.push(n),
        }
    }
    out
}

// ---- Linux parsers, compiled everywhere for the tests -------------------

/// One `nmcli -t` line into its fields: `\:` is a literal colon, `\\` a backslash.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn nmcli_fields(line: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    out.last_mut().unwrap().push(n);
                }
            }
            ':' => out.push(String::new()),
            c => out.last_mut().unwrap().push(c),
        }
    }
    out
}

/// `nmcli -t -f IN-USE,SSID,SIGNAL,CHAN,SECURITY device wifi list`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_nmcli_wifi_list(text: &str) -> (Vec<Network>, usize) {
    let mut hidden = 0;
    let networks = text
        .lines()
        .filter_map(|l| {
            let f = nmcli_fields(l);
            if f.len() < 5 {
                return None;
            }
            if f[1].is_empty() {
                hidden += 1;
                return None;
            }
            let security = f[4].trim().to_string();
            Some(Network {
                ssid: f[1].clone(),
                signal: f[2].parse::<u32>().unwrap_or(0).min(100) as u8,
                channel: (!f[3].is_empty()).then(|| f[3].clone()),
                security: (!security.is_empty() && security != "--").then_some(security),
                known: false,
                current: f[0].trim() == "*",
            })
        })
        .collect();
    (dedupe(networks), hidden)
}

/// `nmcli -t -f NAME,TYPE connection show`: the `802-11-wireless` ones.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_nmcli_connections(text: &str) -> Vec<Known> {
    text.lines()
        .filter_map(|l| {
            let f = nmcli_fields(l);
            (f.len() >= 2 && f[1] == "802-11-wireless").then(|| Known { ssid: f[0].clone(), security: None })
        })
        .collect()
}

/// `nmcli -t -f DEVICE,TYPE,STATE device`: the first Wi-Fi device and whether it is connected.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_nmcli_devices(text: &str) -> Option<(String, bool)> {
    text.lines().map(nmcli_fields).find(|f| f.len() >= 3 && f[1] == "wifi").map(|f| (f[0].clone(), f[2].starts_with("connected")))
}

// ---- macOS parsers ----------------------------------------------------------

/// `spairport_security_mode_wpa2_personal_mixed` to `WPA2 Personal`; `none` to None.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn airport_security(mode: &str) -> Option<String> {
    let m = mode.strip_prefix("spairport_security_mode_").unwrap_or(mode).trim_end_matches("_mixed");
    if m.is_empty() || m == "none" {
        return None;
    }
    Some(
        m.split('_')
            .map(|w| if w.starts_with("wpa") || w.starts_with("wep") { w.to_uppercase() } else { w[..1].to_uppercase() + &w[1..] })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// `-54 dBm / -96 dBm` to percent.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn airport_signal(s: &str) -> Option<u8> {
    s.split_whitespace().next().and_then(|d| d.parse::<i32>().ok()).map(signal_from_dbm)
}

/// `system_profiler SPAirPortDataType -json`: the other networks the
/// interface sees plus the current one; `<redacted>` names are counted.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_airport(json: &str) -> (Vec<Network>, usize) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return (vec![], 0) };
    let mut out = vec![];
    let mut hidden = 0;
    let mut push = |n: &serde_json::Value, current: bool| {
        let Some(name) = n["_name"].as_str() else { return };
        if name == "<redacted>" || name.is_empty() {
            hidden += 1;
            return;
        }
        out.push(Network {
            ssid: name.to_string(),
            signal: n["spairport_signal_noise"].as_str().and_then(airport_signal).unwrap_or(0),
            channel: n["spairport_network_channel"].as_str().map(str::to_string),
            security: n["spairport_security_mode"].as_str().and_then(airport_security),
            known: false,
            current,
        });
    };
    for iface in v["SPAirPortDataType"].as_array().into_iter().flatten().flat_map(|d| d["spairport_airport_interfaces"].as_array().into_iter().flatten()) {
        if iface["spairport_current_network_information"].is_object() {
            push(&iface["spairport_current_network_information"], true);
        }
        for n in iface["spairport_airport_other_local_wireless_networks"].as_array().into_iter().flatten() {
            push(n, false);
        }
    }
    (dedupe(out), hidden)
}

/// `ipconfig getsummary en0`: the `SSID`, `Security` and the first IPv4 address.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_ipconfig_summary(text: &str) -> (Option<String>, Option<String>, Option<String>) {
    let field = |key: &str| text.lines().find_map(|l| l.trim().strip_prefix(key)).map(|v| v.trim_start_matches(':').trim().to_string()).filter(|v| !v.is_empty() && v != "<redacted>");
    let ip = text.lines().skip_while(|l| !l.trim().starts_with("Addresses")).nth(1).map(|l| l.trim().trim_start_matches("0 :").trim().to_string()).filter(|s| s.chars().all(|c| c.is_ascii_digit() || c == '.'));
    (field("SSID "), field("Security "), ip)
}

/// `scutil show State:/Network/Interface/en0/AirPort`: `SSID_STR` and `CHANNEL`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_scutil_airport(text: &str) -> (Option<String>, Option<String>) {
    let field = |key: &str| text.lines().find_map(|l| l.trim().strip_prefix(key)).map(|v| v.trim_start_matches(':').trim().to_string()).filter(|v| !v.is_empty());
    (field("SSID_STR "), field("CHANNEL ").filter(|c| c != "0"))
}

/// `networksetup -listpreferredwirelessnetworks en0`: the indented names after the header.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_preferred(text: &str) -> Vec<Known> {
    text.lines().filter(|l| l.starts_with('\t') || l.starts_with("    ")).map(|l| Known { ssid: l.trim().to_string(), security: None }).filter(|k| !k.ssid.is_empty()).collect()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::tool::{run, run_in};
    use std::sync::OnceLock;

    /// The Wi-Fi device from the hardware ports: `Hardware Port: Wi-Fi` then `Device: en0`.
    fn interface() -> Option<&'static str> {
        static IF: OnceLock<Option<String>> = OnceLock::new();
        IF.get_or_init(|| {
            let ports = run("networksetup", &["-listallhardwareports"]).ok()?;
            let mut lines = ports.lines();
            while let Some(l) = lines.next() {
                if matches!(l.trim(), "Hardware Port: Wi-Fi" | "Hardware Port: AirPort") {
                    return lines.next()?.trim().strip_prefix("Device: ").map(str::to_string);
                }
            }
            None
        })
        .as_deref()
    }

    fn need_interface() -> Result<&'static str> {
        interface().ok_or_else(|| Error::Unavailable("no Wi-Fi interface".into()))
    }

    pub fn status() -> Result<Status> {
        let Some(dev) = interface() else { return Ok(Status::default()) };
        let powered = run("networksetup", &["-getairportpower", dev]).map(|s| s.contains(": On")).unwrap_or(false);
        let summary = run("ipconfig", &["getsummary", dev]).unwrap_or_default();
        let (ssid, security, ip) = parse_ipconfig_summary(&summary);
        let (scutil_ssid, channel) = parse_scutil_airport(&run_in("scutil", &[], Some(&format!("show State:/Network/Interface/{dev}/AirPort\n"))).unwrap_or_default());
        // Associated: the summary names a network (even redacted) or the link has a channel.
        let connected = summary.lines().any(|l| l.trim().starts_with("SSID :")) || channel.is_some();
        let ssid = ssid.or(scutil_ssid).or_else(|| {
            run("networksetup", &["-getairportnetwork", dev]).ok().and_then(|s| s.trim().strip_prefix("Current Wi-Fi Network: ").map(str::to_string))
        });
        let current = (powered && connected).then_some(Current { ssid, signal: None, channel, security, ip });
        Ok(Status { interface: Some(dev.to_string()), powered, current })
    }

    pub fn known() -> Result<Vec<Known>> {
        Ok(parse_preferred(&run("networksetup", &["-listpreferredwirelessnetworks", need_interface()?])?))
    }

    pub fn scan() -> Result<(Vec<Network>, usize)> {
        need_interface()?;
        Ok(parse_airport(&run("system_profiler", &["SPAirPortDataType", "-json"])?))
    }

    /// `networksetup` reports a refusal on stdout with exit 0.
    fn check(out: String) -> Result<()> {
        let t = out.trim();
        if t.starts_with("Failed") || t.starts_with("Could not") || t.starts_with("Error") || t.contains("Error:") {
            return Err(Error::Failed(t.to_string()));
        }
        Ok(())
    }

    pub fn join(ssid: &str, password: Option<&str>) -> Result<()> {
        let dev = need_interface()?;
        let mut args = vec!["-setairportnetwork", dev, ssid];
        args.extend(password);
        check(run("networksetup", &args)?)
    }

    pub fn forget(ssid: &str) -> Result<()> {
        check(run("networksetup", &["-removepreferredwirelessnetwork", need_interface()?, ssid])?)
    }

    pub fn password(ssid: &str) -> Result<String> {
        run("security", &["find-generic-password", "-wa", ssid]).map_err(|e| match e {
            Error::Failed(m) if m.contains("could not be found") => Error::Failed(format!("no saved password for {ssid}")),
            e => e,
        })
    }

    pub fn set_power(on: bool) -> Result<()> {
        check(run("networksetup", &["-setairportpower", need_interface()?, if on { "on" } else { "off" }])?)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::tool::run;

    const LIST: &[&str] = &["-t", "-f", "IN-USE,SSID,SIGNAL,CHAN,SECURITY", "device", "wifi", "list"];

    fn nm() -> Result<()> {
        if !crate::fs::on_path("nmcli") {
            return Err(Error::Unavailable("nmcli (NetworkManager) is not installed".into()));
        }
        Ok(())
    }

    fn device() -> Result<Option<(String, bool)>> {
        nm()?;
        Ok(parse_nmcli_devices(&run("nmcli", &["-t", "-f", "DEVICE,TYPE,STATE", "device"])?))
    }

    pub fn status() -> Result<Status> {
        let Some((dev, connected)) = device()? else { return Ok(Status::default()) };
        let powered = run("nmcli", &["radio", "wifi"]).map(|s| s.trim() == "enabled").unwrap_or(false);
        let mut current = None;
        if powered && connected {
            let mut args = LIST.to_vec();
            args.extend(["--rescan", "no"]);
            let (nets, _) = parse_nmcli_wifi_list(&run("nmcli", &args).unwrap_or_default());
            let ip = run("nmcli", &["-t", "-f", "IP4.ADDRESS", "device", "show", &dev]).ok().and_then(|s| s.lines().next().map(nmcli_fields)).and_then(|f| f.get(1).cloned()).map(|a| a.split('/').next().unwrap_or(&a).to_string());
            let n = nets.into_iter().find(|n| n.current);
            current = Some(Current { ssid: n.as_ref().map(|n| n.ssid.clone()), signal: n.as_ref().map(|n| n.signal), channel: n.as_ref().and_then(|n| n.channel.clone()), security: n.and_then(|n| n.security), ip });
        }
        Ok(Status { interface: Some(dev), powered, current })
    }

    pub fn known() -> Result<Vec<Known>> {
        nm()?;
        Ok(parse_nmcli_connections(&run("nmcli", &["-t", "-f", "NAME,TYPE", "connection", "show"])?))
    }

    pub fn scan() -> Result<(Vec<Network>, usize)> {
        nm()?;
        let mut args = LIST.to_vec();
        args.extend(["--rescan", "yes"]);
        Ok(parse_nmcli_wifi_list(&run("nmcli", &args)?))
    }

    pub fn join(ssid: &str, password: Option<&str>) -> Result<()> {
        nm()?;
        let mut args = vec!["device", "wifi", "connect", ssid];
        if let Some(p) = password {
            args.extend(["password", p]);
        }
        run("nmcli", &args).map(drop)
    }

    pub fn forget(ssid: &str) -> Result<()> {
        nm()?;
        run("nmcli", &["connection", "delete", "id", ssid]).map(drop)
    }

    pub fn password(ssid: &str) -> Result<String> {
        nm()?;
        let p = run("nmcli", &["-s", "-g", "802-11-wireless-security.psk", "connection", "show", ssid])?;
        if p.trim().is_empty() {
            return Err(Error::Failed(format!("no saved password for {ssid}")));
        }
        Ok(p)
    }

    pub fn set_power(on: bool) -> Result<()> {
        nm()?;
        run("nmcli", &["radio", "wifi", if on { "on" } else { "off" }]).map(drop)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    fn no<T>() -> Result<T> {
        Err(Error::Unavailable("Wi-Fi is not available on this platform".into()))
    }
    pub fn status() -> Result<Status> {
        no()
    }
    pub fn known() -> Result<Vec<Known>> {
        no()
    }
    pub fn scan() -> Result<(Vec<Network>, usize)> {
        no()
    }
    pub fn join(_: &str, _: Option<&str>) -> Result<()> {
        no()
    }
    pub fn forget(_: &str) -> Result<()> {
        no()
    }
    pub fn password(_: &str) -> Result<String> {
        no()
    }
    pub fn set_power(_: bool) -> Result<()> {
        no()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nmcli_fields_unescape_colons() {
        assert_eq!(nmcli_fields(r"*:Cafe\: Wifi:82:44:WPA2:AA\:BB\:CC"), ["*", "Cafe: Wifi", "82", "44", "WPA2", "AA:BB:CC"]);
        assert_eq!(nmcli_fields("::"), ["", "", ""]);
    }

    #[test]
    fn nmcli_wifi_list_dedupes_by_name_strongest_first_current_on_top() {
        let text = "*:eldiven:70:44:WPA2\n:eldiven:90:6:WPA2\n:Open Cafe:55:1:\n:Neighbour:30:11:WPA1 WPA2\n::20:3:WPA2\n";
        let (n, hidden) = parse_nmcli_wifi_list(text);
        assert_eq!(hidden, 1);
        // The current entry is the band the link is on, so it is the one kept for its name.
        assert_eq!(n.iter().map(|n| (n.ssid.as_str(), n.signal, n.current)).collect::<Vec<_>>(), [("eldiven", 70, true), ("Open Cafe", 55, false), ("Neighbour", 30, false)]);
        assert_eq!(n[1].security, None);
        assert_eq!(n[2].security.as_deref(), Some("WPA1 WPA2"));
        assert_eq!(n[0].channel.as_deref(), Some("44"));
    }

    #[test]
    fn nmcli_connections_and_devices() {
        let known = parse_nmcli_connections("Wired connection 1:802-3-ethernet\neldiven:802-11-wireless\ndocker0:bridge\nCafe\\: Wifi:802-11-wireless\n");
        assert_eq!(known.iter().map(|k| k.ssid.as_str()).collect::<Vec<_>>(), ["eldiven", "Cafe: Wifi"]);
        assert_eq!(parse_nmcli_devices("enp34s0:ethernet:connected\nwlan0:wifi:connected\nlo:loopback:connected (externally)\n"), Some(("wlan0".into(), true)));
        assert_eq!(parse_nmcli_devices("wlp3s0:wifi:disconnected\n"), Some(("wlp3s0".into(), false)));
        assert_eq!(parse_nmcli_devices("enp34s0:ethernet:connected\n"), None);
    }

    const AIRPORT: &str = r#"{"SPAirPortDataType":[{"spairport_airport_interfaces":[{"_name":"en0",
      "spairport_current_network_information":{"_name":"eldiven","spairport_network_channel":"44 (5GHz, 80MHz)","spairport_security_mode":"spairport_security_mode_wpa2_personal_mixed","spairport_signal_noise":"-54 dBm / -96 dBm"},
      "spairport_airport_other_local_wireless_networks":[
        {"_name":"<redacted>","spairport_network_channel":"6 (2GHz, 20MHz)","spairport_security_mode":"spairport_security_mode_wpa2_personal"},
        {"_name":"Cafe","spairport_network_channel":"1 (2GHz, 20MHz)","spairport_security_mode":"spairport_security_mode_none","spairport_signal_noise":"-80 dBm / -96 dBm"},
        {"_name":"eldiven","spairport_network_channel":"6 (2GHz, 20MHz)","spairport_security_mode":"spairport_security_mode_wpa3_personal","spairport_signal_noise":"-70 dBm / -96 dBm"}
      ],
      "spairport_status_information":"spairport_status_connected"}]}]}"#;

    #[test]
    fn airport_scan_with_the_current_network_signal_and_redacted_count() {
        let (n, hidden) = parse_airport(AIRPORT);
        assert_eq!(hidden, 1);
        assert_eq!(n.len(), 2);
        assert_eq!(n[0], Network { ssid: "eldiven".into(), signal: 92, channel: Some("44 (5GHz, 80MHz)".into()), security: Some("WPA2 Personal".into()), known: false, current: true });
        assert_eq!(n[1], Network { ssid: "Cafe".into(), signal: 40, channel: Some("1 (2GHz, 20MHz)".into()), security: None, known: false, current: false });
        assert_eq!(airport_security("spairport_security_mode_wpa3_personal").as_deref(), Some("WPA3 Personal"));
        assert_eq!(signal_from_dbm(-100), 0);
        assert_eq!(signal_from_dbm(-30), 100);
    }

    #[test]
    fn ipconfig_summary_scutil_and_preferred_list() {
        let summary = "<dictionary> {\n  BSSID : <redacted>\n  IPv4 : <array> {\n    0 : <dictionary> {\n      Addresses : <array> {\n        0 : 192.168.1.131\n      }\n      Router : 192.168.1.1\n    }\n  }\n  SSID : <redacted>\n  Security : WPA2_PSK\n}\n";
        assert_eq!(parse_ipconfig_summary(summary), (None, Some("WPA2_PSK".into()), Some("192.168.1.131".into())));
        let named = summary.replace("SSID : <redacted>", "SSID : eldiven");
        assert_eq!(parse_ipconfig_summary(&named).0.as_deref(), Some("eldiven"));
        assert_eq!(parse_scutil_airport("<dictionary> {\n  CHANNEL : 44\n  Power Status : TRUE\n  SSID_STR : \n}\n"), (None, Some("44".into())));
        assert_eq!(parse_scutil_airport("  CHANNEL : 6\n  SSID_STR : Cafe Wifi\n"), (Some("Cafe Wifi".into()), Some("6".into())));
        let k = parse_preferred("Preferred networks on en0:\n\teldiven\n\tmarvin\n\tCafe Wifi\n");
        assert_eq!(k.iter().map(|k| k.ssid.as_str()).collect::<Vec<_>>(), ["eldiven", "marvin", "Cafe Wifi"]);
    }

    #[test]
    fn cached_mode_never_scans_and_answers_empty_without_a_cache() {
        // The cache is process-wide; this test only relies on `Cached` not touching a tool.
        let s = scan(ScanMode::Cached).unwrap();
        assert!(s.age_secs.is_some() || s == Scan::default());
    }
}
