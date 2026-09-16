//! Wi-Fi: the current network (name, signal, channel, IP), the known
//! networks, a scan of what is in the air; join, forget, the saved
//! password, the radio on or off.
//!
//! macOS: CoreWLAN in-process (`CWWiFiClient`'s interface: its name, the
//! radio, the link's SSID, RSSI, channel and security; `scanForNetworks`
//! for a scan, which blocks ~9 s on hornet, the same as `system_profiler`
//! did: the radio walks the channels either way), `ipconfig getsummary`
//! for the IP (and the name too, for a process whose grant reaches its
//! children, e.g. a terminal: pal's own does not, checked on hornet),
//! `networksetup` for the preferred list, join, forget and the radio
//! (`-listpreferredwirelessnetworks`, `-setairportnetwork`,
//! `-removepreferredwirelessnetwork`, `-setairportpower`), `security
//! find-generic-password -wa <ssid>` for a password (the keychain prompts,
//! which is the user's call). A scan blocks for its duration, so [`scan`]
//! keeps the last result for [`SCAN_TTL`] and [`ScanMode::Cached`] never
//! runs one; a palette shows Available from the cache and offers a Scan
//! action. macOS 15+ hands network names only to a process with Location
//! Services (CoreWLAN answers `nil`, the CLIs `<redacted>`), so the
//! current name may be `None` and a scan's nameless networks are counted
//! in [`Scan::hidden`] rather than listed; the app asks for the permission
//! (`permissions.rs`), the core only reads what it is given.
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
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

// ---- macOS: the pure parts of the CoreWLAN reading, and `ipconfig` ------

/// A `CWSecurity` raw value as the palette spells it; `None` for an open
/// network, `Unknown` (NSIntegerMax) and anything else unnamed.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn cw_security(code: isize) -> Option<&'static str> {
    Some(match code {
        1 => "WEP",
        2 => "WPA Personal",
        3 => "WPA/WPA2 Personal",
        4 => "WPA2 Personal",
        5 => "WPA/WPA2 Personal",
        6 => "Dynamic WEP",
        7 => "WPA Enterprise",
        8 => "WPA/WPA2 Enterprise",
        9 => "WPA2 Enterprise",
        10 => "WPA2 Enterprise",
        11 => "WPA3 Personal",
        12 => "WPA3 Enterprise",
        13 => "WPA2/WPA3 Personal",
        14 | 15 => "OWE",
        _ => return None,
    })
}

/// `CWSecurity` values strongest first: a scanned network says which it
/// supports, and the strongest is the label.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const CW_SECURITY_ORDER: [isize; 16] = [12, 11, 13, 9, 10, 4, 5, 8, 7, 3, 2, 14, 15, 6, 1, 0];

/// A `CWChannel` as `system_profiler` spelled it: `44 (5GHz, 80MHz)`; the
/// band and width raw values, 0 for unknown.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn cw_channel(number: isize, band: isize, width: isize) -> String {
    let band = match band {
        1 => "2GHz",
        2 => "5GHz",
        3 => "6GHz",
        _ => "",
    };
    let width = match width {
        1 => "20MHz",
        2 => "40MHz",
        3 => "80MHz",
        4 => "160MHz",
        _ => "",
    };
    match (band, width) {
        ("", "") => number.to_string(),
        (b, "") => format!("{number} ({b})"),
        ("", w) => format!("{number} ({w})"),
        (b, w) => format!("{number} ({b}, {w})"),
    }
}

/// `ipconfig getsummary en0`: the `SSID`, `Security` and the first IPv4
/// address; the name is `<redacted>` for a process without Location
/// Services, which reads as none.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_ipconfig_summary(text: &str) -> (Option<String>, Option<String>, Option<String>) {
    let field = |key: &str| text.lines().find_map(|l| l.trim().strip_prefix(key)).map(|v| v.trim_start_matches(':').trim().to_string()).filter(|v| !v.is_empty() && v != "<redacted>");
    let ip = text.lines().skip_while(|l| !l.trim().starts_with("Addresses")).nth(1).map(|l| l.trim().trim_start_matches("0 :").trim().to_string()).filter(|s| s.chars().all(|c| c.is_ascii_digit() || c == '.'));
    (field("SSID "), field("Security "), ip)
}

/// `networksetup -listpreferredwirelessnetworks en0`: the indented names after the header.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_preferred(text: &str) -> Vec<Known> {
    text.lines().filter(|l| l.starts_with('\t') || l.starts_with("    ")).map(|l| Known { ssid: l.trim().to_string(), security: None }).filter(|k| !k.ssid.is_empty()).collect()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::tool::run;
    use objc2::rc::Retained;
    use objc2_core_wlan::{CWInterface, CWNetwork, CWSecurity, CWWiFiClient};
    use std::sync::OnceLock;

    /// The Wi-Fi interface CoreWLAN knows (`en0`); None on a machine without one.
    fn cw_interface() -> Option<Retained<CWInterface>> {
        // SAFETY: the shared client is a plain singleton; CoreWLAN reads are thread-safe (called from the bridge's blocking threads).
        unsafe { CWWiFiClient::sharedWiFiClient().interface() }
    }

    /// The interface's BSD name, read once (it does not change while pal runs).
    fn interface() -> Option<&'static str> {
        static IF: OnceLock<Option<String>> = OnceLock::new();
        // SAFETY: a property read on a retained object.
        IF.get_or_init(|| cw_interface().and_then(|i| unsafe { i.interfaceName() }).map(|s| s.to_string())).as_deref()
    }

    fn need_interface() -> Result<&'static str> {
        interface().ok_or_else(|| Error::Unavailable("no Wi-Fi interface".into()))
    }

    /// A `CWChannel` spelled out ([`cw_channel`]).
    fn channel_of(c: Option<Retained<objc2_core_wlan::CWChannel>>) -> Option<String> {
        // SAFETY: property reads on a retained object.
        c.map(|c| unsafe { cw_channel(c.channelNumber(), c.channelBand().0, c.channelWidth().0) })
    }

    /// The strongest security a scanned network supports, as a label.
    fn security_of(n: &CWNetwork) -> Option<String> {
        // SAFETY: a query on a retained object with a plain enum argument.
        let code = CW_SECURITY_ORDER.into_iter().find(|&c| unsafe { n.supportsSecurity(CWSecurity(c)) })?;
        cw_security(code).map(str::to_string)
    }

    /// RSSI in dBm to percent; 0 is CoreWLAN's "not associated".
    fn signal_of(rssi: isize) -> Option<u8> {
        (rssi < 0).then(|| signal_from_dbm(rssi as i32))
    }

    pub fn status() -> Result<Status> {
        let Some(iface) = cw_interface() else { return Ok(Status::default()) };
        let Some(dev) = interface() else { return Ok(Status::default()) };
        // SAFETY: property reads on a retained object; `ssid` is nil without Location Services, `rssiValue` 0 while not associated.
        let (powered, ssid, rssi, channel, security) = unsafe { (iface.powerOn(), iface.ssid().map(|s| s.to_string()), iface.rssiValue(), channel_of(iface.wlanChannel()), cw_security(iface.security().0)) };
        // The IP; the name too when the process's Location grant reaches its children (a terminal's does, pal's own does not).
        let summary = run("ipconfig", &["getsummary", dev]).unwrap_or_default();
        let (cli_ssid, cli_security, ip) = parse_ipconfig_summary(&summary);
        // Associated: the link has an RSSI, or the summary names a network (even redacted).
        let connected = rssi < 0 || summary.lines().any(|l| l.trim().starts_with("SSID :"));
        let current = (powered && connected).then(|| Current { ssid: ssid.or(cli_ssid), signal: signal_of(rssi), channel, security: security.map(str::to_string).or(cli_security), ip });
        Ok(Status { interface: Some(dev.to_string()), powered, current })
    }

    pub fn known() -> Result<Vec<Known>> {
        Ok(parse_preferred(&run("networksetup", &["-listpreferredwirelessnetworks", need_interface()?])?))
    }

    /// A CoreWLAN scan: blocks for its duration (~9 s on hornet). A network
    /// without a name (Location Services withheld it, or a hidden network)
    /// is counted.
    pub fn scan() -> Result<(Vec<Network>, usize)> {
        let iface = cw_interface().ok_or_else(|| Error::Unavailable("no Wi-Fi interface".into()))?;
        // SAFETY: a blocking call on a retained object; the set and its networks are read on this thread and dropped with it.
        let found = unsafe { iface.scanForNetworksWithSSID_error(None) }.map_err(|e| Error::Failed(e.localizedDescription().to_string()))?;
        let current = unsafe { iface.ssid() }.map(|s| s.to_string());
        let mut hidden = 0;
        let mut out = vec![];
        for n in found.iter() {
            // SAFETY: property reads on a retained object.
            let Some(ssid) = (unsafe { n.ssid() }).map(|s| s.to_string()).filter(|s| !s.is_empty()) else {
                hidden += 1;
                continue;
            };
            let (rssi, channel) = unsafe { (n.rssiValue(), channel_of(n.wlanChannel())) };
            out.push(Network { current: current.as_deref() == Some(&ssid), security: security_of(&n), signal: signal_of(rssi).unwrap_or(0), ssid, channel, known: false });
        }
        Ok((dedupe(out), hidden))
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

    #[test]
    fn corewlan_labels() {
        // Channel as system_profiler spelled it, so the two sources read alike.
        assert_eq!(cw_channel(44, 2, 3), "44 (5GHz, 80MHz)");
        assert_eq!(cw_channel(6, 1, 1), "6 (2GHz, 20MHz)");
        assert_eq!(cw_channel(37, 3, 0), "37 (6GHz)");
        assert_eq!(cw_channel(1, 0, 0), "1");
        // The security codes CoreWLAN hands out (CWSecurity).
        assert_eq!(cw_security(0), None);
        assert_eq!(cw_security(4), Some("WPA2 Personal"));
        assert_eq!(cw_security(13), Some("WPA2/WPA3 Personal"));
        assert_eq!(cw_security(isize::MAX), None);
        // The strongest supported wins: a WPA2/WPA3 transition network supports 4 and 13, and 13 comes first.
        let supports = |c: isize| c == 4 || c == 13;
        assert_eq!(CW_SECURITY_ORDER.into_iter().find(|&c| supports(c)), Some(13));
        assert_eq!(signal_from_dbm(-100), 0);
        assert_eq!(signal_from_dbm(-30), 100);
        assert_eq!(signal_from_dbm(-54), 92);
    }

    #[test]
    fn ipconfig_summary_and_preferred_list() {
        let summary = "<dictionary> {\n  BSSID : <redacted>\n  IPv4 : <array> {\n    0 : <dictionary> {\n      Addresses : <array> {\n        0 : 192.168.1.131\n      }\n      Router : 192.168.1.1\n    }\n  }\n  SSID : <redacted>\n  Security : WPA2_PSK\n}\n";
        assert_eq!(parse_ipconfig_summary(summary), (None, Some("WPA2_PSK".into()), Some("192.168.1.131".into())));
        let named = summary.replace("SSID : <redacted>", "SSID : eldiven");
        assert_eq!(parse_ipconfig_summary(&named).0.as_deref(), Some("eldiven"));
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
