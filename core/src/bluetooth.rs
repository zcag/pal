//! Bluetooth: the paired devices with their connected state, kind and
//! battery when the OS knows it; connect and disconnect.
//!
//! macOS: the list is `system_profiler SPBluetoothDataType -json` (~80 ms
//! on hornet; the only unprivileged source that carries the device type
//! and the battery levels, AirPods' left/right/case included), connect
//! and disconnect are IOBluetooth's `openConnection`/`closeConnection` on
//! `IOBluetoothDevice deviceWithAddressString:` (what `blueutil` calls),
//! so nothing has to be installed. Linux: BlueZ over `bluetoothctl`
//! (`devices Paired`, `info`, `connect`, `disconnect`), each call under a
//! timeout because `bluetoothctl` blocks for good on a wedged adapter, and
//! only when `/sys/class/bluetooth` has one: with no adapter it blocks
//! rather than answering empty. Both parsers are pure and fixture-tested
//! on every platform.

use serde::{Deserialize, Serialize};

pub use crate::tool::{Error, Result};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    /// `AA:BB:CC:DD:EE:FF`, upper-case.
    pub address: String,
    pub name: String,
    pub connected: bool,
    /// `headphones`, `speaker`, `keyboard`, `mouse`, `gamepad`, `phone`, `watch`, `computer`, `other`.
    pub kind: String,
    /// Percent, the main level (AirPods: the lower of the two buds) when the OS reports one.
    pub battery: Option<u8>,
    /// The per-part levels when there are several: `L 80% · R 75% · Case 90%`.
    pub battery_detail: Option<String>,
}

/// Connected first, then by name.
pub fn devices() -> Result<Vec<Device>> {
    let mut d = platform::devices()?;
    sort(&mut d);
    Ok(d)
}

fn sort(d: &mut [Device]) {
    d.sort_by(|a, b| b.connected.cmp(&a.connected).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

pub fn connect(address: &str) -> Result<()> {
    platform::connect(&normalize(address))
}

pub fn disconnect(address: &str) -> Result<()> {
    platform::disconnect(&normalize(address))
}

/// `aa-bb-cc-dd-ee-ff` (blueutil's spelling) or lower-case to the colon form.
fn normalize(address: &str) -> String {
    address.replace('-', ":").to_uppercase()
}

fn percent(s: &str) -> Option<u8> {
    s.trim().trim_end_matches('%').parse::<u32>().ok().map(|p| p.min(100) as u8)
}

/// Main level and detail from named part levels (`L`, `R`, `Case`, or
/// just `Main`): the main is the lowest bud, so a dying left one shows.
fn battery_of(parts: &[(&str, u8)]) -> (Option<u8>, Option<String>) {
    if parts.is_empty() {
        return (None, None);
    }
    let buds: Vec<u8> = parts.iter().filter(|(n, _)| *n != "Case").map(|(_, p)| *p).collect();
    let main = buds.iter().min().or_else(|| parts.iter().map(|(_, p)| p).min()).copied();
    let detail = (parts.len() > 1).then(|| parts.iter().map(|(n, p)| format!("{n} {p}%")).collect::<Vec<_>>().join(" · "));
    (main, detail)
}

// ---- parsers, compiled everywhere for the tests --------------------------

/// `system_profiler SPBluetoothDataType -json`: `device_connected` and
/// `device_not_connected` are lists of one-key objects, name to properties.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_system_profiler(json: &str) -> Vec<Device> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return vec![] };
    let mut out = vec![];
    for controller in v["SPBluetoothDataType"].as_array().into_iter().flatten() {
        for (key, connected) in [("device_connected", true), ("device_not_connected", false)] {
            for entry in controller[key].as_array().into_iter().flatten() {
                let Some(obj) = entry.as_object() else { continue };
                for (name, props) in obj {
                    let Some(address) = props["device_address"].as_str() else { continue };
                    let mut parts = vec![];
                    for (key, label) in [("device_batteryLevelMain", "Main"), ("device_batteryLevelLeft", "L"), ("device_batteryLevelRight", "R"), ("device_batteryLevelCase", "Case")] {
                        if let Some(p) = props[key].as_str().and_then(percent) {
                            parts.push((label, p));
                        }
                    }
                    let (battery, battery_detail) = battery_of(&parts);
                    let kind = match props["device_minorType"].as_str().unwrap_or("").to_lowercase().as_str() {
                        "headphones" | "headset" => "headphones",
                        "speaker" => "speaker",
                        "keyboard" => "keyboard",
                        "mouse" => "mouse",
                        "gamepad" | "joystick" => "gamepad",
                        "phone" | "smartphone" => "phone",
                        "watch" => "watch",
                        "computer" | "laptop" | "desktop" => "computer",
                        _ => "other",
                    };
                    out.push(Device { address: normalize(address), name: name.clone(), connected, kind: kind.into(), battery, battery_detail });
                }
            }
        }
    }
    out
}

/// `bluetoothctl devices Paired`: `Device AA:BB:CC:DD:EE:FF Name with spaces`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_bluetoothctl_devices(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let rest = l.trim().strip_prefix("Device ")?;
            let (addr, name) = rest.split_once(' ').unwrap_or((rest, ""));
            (addr.len() == 17).then(|| (normalize(addr), if name.trim().is_empty() { addr.to_string() } else { name.trim().to_string() }))
        })
        .collect()
}

/// `bluetoothctl info <addr>` into a device: `Connected: yes`, `Icon:`
/// (the freedesktop name BlueZ derives from the class), `Battery Percentage: 0x64 (100)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_bluetoothctl_info(address: &str, name: &str, text: &str) -> Device {
    let field = |key: &str| text.lines().map(str::trim).find_map(|l| l.strip_prefix(key).map(|v| v.trim().to_string()));
    let kind = match field("Icon:").unwrap_or_default().as_str() {
        "audio-headset" | "audio-headphones" => "headphones",
        "audio-card" | "audio-speakers" => "speaker",
        "input-keyboard" => "keyboard",
        "input-mouse" => "mouse",
        "input-gaming" => "gamepad",
        "phone" => "phone",
        "computer" => "computer",
        _ => "other",
    };
    let battery = field("Battery Percentage:").and_then(|v| v.rsplit_once('(').and_then(|(_, p)| p.trim_end_matches(')').parse::<u8>().ok()));
    Device {
        address: address.to_string(),
        name: field("Alias:").or_else(|| field("Name:")).unwrap_or_else(|| name.to_string()),
        connected: field("Connected:").as_deref() == Some("yes"),
        kind: kind.into(),
        battery: battery.map(|b| b.min(100)),
        battery_detail: None,
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::tool::run;
    use objc2_foundation::NSString;
    use objc2_io_bluetooth::IOBluetoothDevice;

    pub fn devices() -> Result<Vec<Device>> {
        Ok(parse_system_profiler(&run("system_profiler", &["SPBluetoothDataType", "-json"])?))
    }

    fn device(address: &str) -> Result<objc2::rc::Retained<IOBluetoothDevice>> {
        // SAFETY: a colon-form address string; IOBluetooth answers nil for one it does not know.
        unsafe { IOBluetoothDevice::deviceWithAddressString(Some(&NSString::from_str(address))) }.ok_or_else(|| Error::Failed(format!("no device {address}")))
    }

    pub fn connect(address: &str) -> Result<()> {
        let d = device(address)?;
        // SAFETY: synchronous; returns once connected or the attempt timed out.
        let rc = unsafe { d.openConnection() };
        if rc != 0 {
            return Err(Error::Failed(format!("could not connect to {address} (IOReturn {rc:#x})")));
        }
        Ok(())
    }

    pub fn disconnect(address: &str) -> Result<()> {
        let d = device(address)?;
        // SAFETY: as above.
        let rc = unsafe { d.closeConnection() };
        if rc != 0 {
            return Err(Error::Failed(format!("could not disconnect {address} (IOReturn {rc:#x})")));
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::tool::run_timeout;

    /// A BlueZ adapter: `bluetoothctl` never answers without one.
    fn adapter() -> Result<()> {
        if !crate::fs::on_path("bluetoothctl") {
            return Err(Error::Unavailable("bluetoothctl is not installed".into()));
        }
        match std::fs::read_dir("/sys/class/bluetooth").ok().and_then(|mut d| d.next()) {
            Some(_) => Ok(()),
            None => Err(Error::Unavailable("no Bluetooth adapter".into())),
        }
    }

    pub fn devices() -> Result<Vec<Device>> {
        adapter()?;
        // `devices Paired` is BlueZ 5.65+; older ones spell it `paired-devices`.
        let listed = run_timeout(5, "bluetoothctl", &["devices", "Paired"]).or_else(|_| run_timeout(5, "bluetoothctl", &["paired-devices"]))?;
        Ok(parse_bluetoothctl_devices(&listed)
            .into_iter()
            .map(|(addr, name)| match run_timeout(5, "bluetoothctl", &["info", &addr]) {
                Ok(info) => parse_bluetoothctl_info(&addr, &name, &info),
                Err(_) => Device { address: addr, name, connected: false, kind: "other".into(), battery: None, battery_detail: None },
            })
            .collect())
    }

    fn act(verb: &str, address: &str) -> Result<()> {
        adapter()?;
        let out = run_timeout(20, "bluetoothctl", &[verb, address])?;
        // bluetoothctl exits 0 and says "Failed to connect: org.bluez.Error..." on stdout.
        match out.lines().rev().find(|l| l.starts_with("Failed")) {
            Some(l) => Err(Error::Failed(l.to_string())),
            None => Ok(()),
        }
    }

    pub fn connect(address: &str) -> Result<()> {
        act("connect", address)
    }

    pub fn disconnect(address: &str) -> Result<()> {
        act("disconnect", address)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn devices() -> Result<Vec<Device>> {
        Err(Error::Unavailable("Bluetooth is not available on this platform".into()))
    }
    pub fn connect(_: &str) -> Result<()> {
        devices().map(drop)
    }
    pub fn disconnect(_: &str) -> Result<()> {
        devices().map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SP: &str = r#"{
  "SPBluetoothDataType" : [
    {
      "controller_properties" : { "controller_state" : "attrib_on" },
      "device_connected" : [
        { "HK Aura Studio 4" : { "device_address" : "20:18:5B:09:EE:4D", "device_minorType" : "Speaker", "device_rssi" : "-49" } },
        { "cagdas’s AirPods Pro #2" : { "device_address" : "14:28:76:8B:AE:C8", "device_minorType" : "Headphones", "device_batteryLevelLeft" : "80%", "device_batteryLevelRight" : "75%", "device_batteryLevelCase" : "90%" } },
        { "Pebble M350s" : { "device_address" : "D4:83:5A:8E:D0:B9", "device_minorType" : "Mouse", "device_batteryLevelMain" : "55%" } }
      ],
      "device_not_connected" : [
        { "Corne" : { "device_address" : "E6:E6:EA:DB:E7:18", "device_minorType" : "Keyboard" } },
        { "link" : { "device_address" : "50:ED:3C:E5:7F:02" } }
      ]
    }
  ]
}"#;

    #[test]
    fn system_profiler_devices_with_kind_and_battery() {
        let d = parse_system_profiler(SP);
        assert_eq!(d.len(), 5);
        assert_eq!(d[0], Device { address: "20:18:5B:09:EE:4D".into(), name: "HK Aura Studio 4".into(), connected: true, kind: "speaker".into(), battery: None, battery_detail: None });
        assert_eq!((d[1].kind.as_str(), d[1].battery, d[1].battery_detail.as_deref()), ("headphones", Some(75), Some("L 80% · R 75% · Case 90%")));
        assert_eq!((d[2].kind.as_str(), d[2].battery, d[2].battery_detail.as_deref()), ("mouse", Some(55), None));
        assert_eq!((d[3].kind.as_str(), d[3].connected), ("keyboard", false));
        assert_eq!((d[4].kind.as_str(), d[4].name.as_str()), ("other", "link"));
        assert!(parse_system_profiler("{").is_empty());
    }

    #[test]
    fn bluetoothctl_list_and_info() {
        let list = parse_bluetoothctl_devices("Device AA:BB:CC:DD:EE:FF WH-1000XM4\nDevice 11:22:33:44:55:66 Logitech M720 Triathlon\nDevice 77:88:99:AA:BB:CC\ngarbage line\n");
        assert_eq!(list, vec![("AA:BB:CC:DD:EE:FF".to_string(), "WH-1000XM4".to_string()), ("11:22:33:44:55:66".into(), "Logitech M720 Triathlon".into()), ("77:88:99:AA:BB:CC".into(), "77:88:99:AA:BB:CC".into())]);
        let info = "Device AA:BB:CC:DD:EE:FF (public)\n\tName: WH-1000XM4\n\tAlias: Sony XM4\n\tClass: 0x00240404\n\tIcon: audio-headset\n\tPaired: yes\n\tTrusted: yes\n\tConnected: yes\n\tUUID: Audio Sink (0000110b-0000-1000-8000-00805f9b34fb)\n\tBattery Percentage: 0x64 (100)\n";
        let d = parse_bluetoothctl_info("AA:BB:CC:DD:EE:FF", "WH-1000XM4", info);
        assert_eq!(d, Device { address: "AA:BB:CC:DD:EE:FF".into(), name: "Sony XM4".into(), connected: true, kind: "headphones".into(), battery: Some(100), battery_detail: None });
        let d = parse_bluetoothctl_info("11:22:33:44:55:66", "M720", "Device 11:22:33:44:55:66 (public)\n\tIcon: input-mouse\n\tConnected: no\n");
        assert_eq!((d.name.as_str(), d.kind.as_str(), d.connected, d.battery), ("M720", "mouse", false, None));
    }

    #[test]
    fn addresses_normalise_and_the_list_puts_connected_first() {
        assert_eq!(normalize("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF");
        let mut d = parse_system_profiler(SP);
        sort(&mut d);
        assert_eq!(d.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["cagdas’s AirPods Pro #2", "HK Aura Studio 4", "Pebble M350s", "Corne", "link"]);
    }
}
