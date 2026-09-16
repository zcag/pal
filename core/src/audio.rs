//! Audio devices: every output and input with the default marked, its
//! volume and mute state; set the default, the volume, mute.
//!
//! macOS: the CoreAudio HAL directly (`AudioObjectGetPropertyData`, no
//! tool to install): the system object lists the devices and holds the
//! defaults, a device is an output or an input by which scope has streams,
//! the UID is the id (stable across replugs; ids are renumbered), and the
//! volume is the virtual main volume (`vmvc`, what the menu bar slider
//! moves) with the per-channel scalar as the fallback for a device without
//! one. Linux: `wpctl status` (PipeWire; the `*` in the gutter marks the
//! default, `[vol: 0.40 MUTED]` carries the rest) with `wpctl
//! set-default|set-volume|set-mute`, else `pactl -f json list
//! sinks|sources` and `pactl get-default-sink|source` (PulseAudio 16+).
//! Both parsers are pure and fixture-tested on every platform.

use serde::{Deserialize, Serialize};

pub use crate::tool::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Output,
    Input,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    /// What the setters take: the CoreAudio UID, the PipeWire node id, or the PulseAudio sink/source name.
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub default: bool,
    /// Percent, 0..100; None when the device has no volume control (a digital output).
    pub volume: Option<u8>,
    pub muted: Option<bool>,
    /// `bluetooth`, `usb`, `builtin`, `hdmi`, `airplay`, ... when the backend says (macOS); None otherwise.
    pub transport: Option<String>,
}

/// Every device of both kinds, outputs first; a device that is both (a USB
/// headset) is two entries with the same id.
pub fn devices() -> Result<Vec<Device>> {
    platform::devices()
}

pub fn set_default(id: &str, kind: Kind) -> Result<()> {
    platform::set_default(id, kind)
}

/// Percent, clamped to 0..100.
pub fn set_volume(id: &str, kind: Kind, percent: u8) -> Result<()> {
    platform::set_volume(id, kind, percent.min(100))
}

/// `None` toggles; the state after.
pub fn set_mute(id: &str, kind: Kind, muted: Option<bool>) -> Result<bool> {
    platform::set_mute(id, kind, muted)
}

// ---- Linux parsers, compiled everywhere for the tests -------------------

/// `wpctl status`: the Sinks and Sources of the Audio block, each `[ *] N. name [vol: V( MUTED)?]`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_wpctl_status(text: &str) -> Vec<Device> {
    let mut out = vec![];
    let mut in_audio = false;
    let mut kind: Option<Kind> = None;
    for raw in text.lines() {
        let line = raw.trim_start_matches([' ', '│', '├', '└', '─']);
        if raw.starts_with("Audio") {
            in_audio = true;
            continue;
        }
        if raw.starts_with("Video") || raw.starts_with("Settings") {
            in_audio = false;
        }
        if !in_audio {
            continue;
        }
        match line.trim() {
            "Sinks:" => {
                kind = Some(Kind::Output);
                continue;
            }
            "Sources:" => {
                kind = Some(Kind::Input);
                continue;
            }
            l if l.ends_with(':') => {
                kind = None;
                continue;
            }
            _ => {}
        }
        let Some(kind) = kind else { continue };
        let default = line.starts_with('*');
        let rest = line.trim_start_matches('*').trim();
        let Some((id, rest)) = rest.split_once(". ") else { continue };
        if !id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let (name, volume, muted) = match rest.rsplit_once(" [vol: ") {
            Some((name, vol)) => {
                let vol = vol.trim_end_matches(']');
                let muted = vol.contains("MUTED");
                let v: f32 = vol.split_whitespace().next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
                (name, Some((v * 100.0).round().clamp(0.0, 100.0) as u8), Some(muted))
            }
            None => (rest, None, None),
        };
        out.push(Device { id: id.to_string(), name: name.trim().to_string(), kind, default, volume, muted, transport: None });
    }
    out
}

/// `pactl -f json list sinks|sources` with the default's name.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_pactl_json(json: &str, kind: Kind, default: &str) -> Vec<Device> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(json) else { return vec![] };
    items
        .iter()
        .filter_map(|v| {
            let name = v["name"].as_str()?;
            let volume = v["volume"].as_object().and_then(|chs| {
                let pcts: Vec<u8> = chs.values().filter_map(|c| c["value_percent"].as_str()?.trim_end_matches('%').parse().ok()).collect();
                (!pcts.is_empty()).then(|| (pcts.iter().map(|&p| p as u32).sum::<u32>() / pcts.len() as u32).min(100) as u8)
            });
            let bus = v["properties"]["device.bus"].as_str().map(str::to_string);
            Some(Device {
                id: name.to_string(),
                name: v["description"].as_str().unwrap_or(name).to_string(),
                kind,
                default: name == default.trim(),
                volume,
                muted: v["mute"].as_bool(),
                transport: bus,
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2_core_audio::{
        kAudioDevicePropertyDeviceUID, kAudioDevicePropertyMute, kAudioDevicePropertyStreams, kAudioDevicePropertyTransportType, kAudioDevicePropertyVolumeScalar, kAudioHardwarePropertyDefaultInputDevice,
        kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices, kAudioObjectPropertyElementMain, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeInput,
        kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectHasProperty, AudioObjectID, AudioObjectPropertyAddress,
        AudioObjectPropertyScope, AudioObjectPropertySelector, AudioObjectSetPropertyData,
    };
    use objc2_core_foundation::{CFRetained, CFString};
    use std::ptr::NonNull;

    /// `kAudioHardwareServiceDeviceProperty_VirtualMainVolume` ('vmvc'): the
    /// one slider for a device, from AudioHardwareService.h, answered by the
    /// HAL on the device object since 10.7; the crate does not carry it.
    const VIRTUAL_MAIN_VOLUME: AudioObjectPropertySelector = u32::from_be_bytes(*b"vmvc");
    const SYSTEM: AudioObjectID = kAudioObjectSystemObject as AudioObjectID;

    fn addr(selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope, element: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress { mSelector: selector, mScope: scope, mElement: element }
    }

    fn scope(kind: Kind) -> AudioObjectPropertyScope {
        match kind {
            Kind::Output => kAudioObjectPropertyScopeOutput,
            Kind::Input => kAudioObjectPropertyScopeInput,
        }
    }

    fn has(obj: AudioObjectID, a: &AudioObjectPropertyAddress) -> bool {
        // SAFETY: `a` is a valid address for the call's duration.
        unsafe { AudioObjectHasProperty(obj, NonNull::from(a)) }
    }

    /// One fixed-size property value.
    fn get<T: Copy>(obj: AudioObjectID, a: &AudioObjectPropertyAddress) -> Option<T> {
        let mut size = std::mem::size_of::<T>() as u32;
        let mut v = std::mem::MaybeUninit::<T>::uninit();
        // SAFETY: the out buffer is `size` bytes of a T; the HAL writes at most that.
        let rc = unsafe { AudioObjectGetPropertyData(obj, NonNull::from(a), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new(v.as_mut_ptr().cast()).unwrap()) };
        // SAFETY: on success the HAL filled the value.
        (rc == 0 && size as usize == std::mem::size_of::<T>()).then(|| unsafe { v.assume_init() })
    }

    /// A property that is an array of fixed-size values.
    fn get_vec<T: Copy>(obj: AudioObjectID, a: &AudioObjectPropertyAddress) -> Vec<T> {
        let mut size = 0u32;
        // SAFETY: valid pointers for the call's duration.
        if unsafe { AudioObjectGetPropertyDataSize(obj, NonNull::from(a), 0, std::ptr::null(), NonNull::from(&mut size)) } != 0 || size == 0 {
            return vec![];
        }
        let n = size as usize / std::mem::size_of::<T>();
        let mut v = Vec::<T>::with_capacity(n);
        // SAFETY: the buffer holds `size` bytes; on success the HAL wrote `size` of them.
        let rc = unsafe { AudioObjectGetPropertyData(obj, NonNull::from(a), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new(v.as_mut_ptr().cast()).unwrap()) };
        if rc != 0 {
            return vec![];
        }
        // SAFETY: `size` bytes were written, whole elements.
        unsafe { v.set_len(size as usize / std::mem::size_of::<T>()) };
        v
    }

    fn set<T: Copy>(obj: AudioObjectID, a: &AudioObjectPropertyAddress, value: T) -> Result<()> {
        // SAFETY: `value` lives for the call.
        let rc = unsafe { AudioObjectSetPropertyData(obj, NonNull::from(a), 0, std::ptr::null(), std::mem::size_of::<T>() as u32, NonNull::from(&value).cast()) };
        if rc != 0 {
            return Err(Error::Failed(format!("CoreAudio refused ({})", fourcc(rc as u32))));
        }
        Ok(())
    }

    /// An OSStatus as its four characters when it is one ('!dev', 'who?'), else the number.
    fn fourcc(code: u32) -> String {
        let b = code.to_be_bytes();
        if b.iter().all(|c| c.is_ascii_graphic() || *c == b' ') {
            format!("'{}'", String::from_utf8_lossy(&b))
        } else {
            code.to_string()
        }
    }

    /// A CFString property; the HAL hands over a retained reference.
    fn string(obj: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<String> {
        let a = addr(selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain);
        let p: *const CFString = get(obj, &a)?;
        // SAFETY: a +1 reference from the HAL, released with the CFRetained.
        Some(unsafe { CFRetained::from_raw(NonNull::new(p.cast_mut())?) }.to_string())
    }

    fn streams(dev: AudioObjectID, kind: Kind) -> usize {
        get_vec::<u32>(dev, &addr(kAudioDevicePropertyStreams, scope(kind), kAudioObjectPropertyElementMain)).len()
    }

    fn transport(dev: AudioObjectID) -> Option<String> {
        use objc2_core_audio as ca;
        let t: u32 = get(dev, &addr(kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain))?;
        // The transport constants are lower-camel `k...` names, not usable as match patterns without a lint.
        let names: &[(u32, &str)] = &[
            (ca::kAudioDeviceTransportTypeBuiltIn, "builtin"),
            (ca::kAudioDeviceTransportTypeBluetooth, "bluetooth"),
            (ca::kAudioDeviceTransportTypeBluetoothLE, "bluetooth"),
            (ca::kAudioDeviceTransportTypeUSB, "usb"),
            (ca::kAudioDeviceTransportTypeHDMI, "hdmi"),
            (ca::kAudioDeviceTransportTypeDisplayPort, "displayport"),
            (ca::kAudioDeviceTransportTypeAirPlay, "airplay"),
            (ca::kAudioDeviceTransportTypeThunderbolt, "thunderbolt"),
            (ca::kAudioDeviceTransportTypeAggregate, "aggregate"),
            (ca::kAudioDeviceTransportTypeVirtual, "virtual"),
            (ca::kAudioDeviceTransportTypePCI, "pci"),
            (ca::kAudioDeviceTransportTypeContinuityCaptureWired, "continuity"),
            (ca::kAudioDeviceTransportTypeContinuityCaptureWireless, "continuity"),
        ];
        names.iter().find(|(k, _)| *k == t).map(|(_, n)| n.to_string())
    }

    /// The volume address a device answers for `kind`: the virtual main
    /// volume on the main element, else the per-channel scalar on channel 1
    /// (2 follows in `set_volume`), else none.
    fn volume_addr(dev: AudioObjectID, kind: Kind) -> Option<AudioObjectPropertyAddress> {
        let main = addr(VIRTUAL_MAIN_VOLUME, scope(kind), kAudioObjectPropertyElementMain);
        if has(dev, &main) {
            return Some(main);
        }
        let ch1 = addr(kAudioDevicePropertyVolumeScalar, scope(kind), 1);
        has(dev, &ch1).then_some(ch1)
    }

    fn volume(dev: AudioObjectID, kind: Kind) -> Option<u8> {
        let v: f32 = get(dev, &volume_addr(dev, kind)?)?;
        Some((v * 100.0).round().clamp(0.0, 100.0) as u8)
    }

    fn muted(dev: AudioObjectID, kind: Kind) -> Option<bool> {
        let a = addr(kAudioDevicePropertyMute, scope(kind), kAudioObjectPropertyElementMain);
        has(dev, &a).then(|| get::<u32>(dev, &a)).flatten().map(|m| m != 0)
    }

    fn default_of(kind: Kind) -> Option<AudioObjectID> {
        let sel = match kind {
            Kind::Output => kAudioHardwarePropertyDefaultOutputDevice,
            Kind::Input => kAudioHardwarePropertyDefaultInputDevice,
        };
        get(SYSTEM, &addr(sel, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain))
    }

    fn all() -> Vec<AudioObjectID> {
        get_vec(SYSTEM, &addr(kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain))
    }

    pub fn devices() -> Result<Vec<Device>> {
        let ids = all();
        let mut out = vec![];
        for kind in [Kind::Output, Kind::Input] {
            let default = default_of(kind);
            for &dev in &ids {
                if streams(dev, kind) == 0 {
                    continue;
                }
                let Some(id) = string(dev, kAudioDevicePropertyDeviceUID) else { continue };
                let name = string(dev, kAudioObjectPropertyName).unwrap_or_else(|| id.clone());
                out.push(Device { id, name, kind, default: default == Some(dev), volume: volume(dev, kind), muted: muted(dev, kind), transport: transport(dev) });
            }
        }
        Ok(out)
    }

    fn find(id: &str, kind: Kind) -> Result<AudioObjectID> {
        all()
            .into_iter()
            .find(|&d| streams(d, kind) > 0 && string(d, kAudioDevicePropertyDeviceUID).as_deref() == Some(id))
            .ok_or_else(|| Error::Failed(format!("no {} device {id}", if kind == Kind::Output { "output" } else { "input" })))
    }

    pub fn set_default(id: &str, kind: Kind) -> Result<()> {
        let dev = find(id, kind)?;
        let sel = match kind {
            Kind::Output => kAudioHardwarePropertyDefaultOutputDevice,
            Kind::Input => kAudioHardwarePropertyDefaultInputDevice,
        };
        set(SYSTEM, &addr(sel, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain), dev)
    }

    pub fn set_volume(id: &str, kind: Kind, percent: u8) -> Result<()> {
        let dev = find(id, kind)?;
        let a = volume_addr(dev, kind).ok_or_else(|| Error::Failed(format!("{id} has no volume control")))?;
        let v = percent as f32 / 100.0;
        set(dev, &a, v)?;
        if a.mSelector == kAudioDevicePropertyVolumeScalar {
            // Channel 2 as well; a mono device simply has none.
            let ch2 = addr(kAudioDevicePropertyVolumeScalar, scope(kind), 2);
            if has(dev, &ch2) {
                set(dev, &ch2, v)?;
            }
        }
        Ok(())
    }

    pub fn set_mute(id: &str, kind: Kind, muted: Option<bool>) -> Result<bool> {
        let dev = find(id, kind)?;
        let a = addr(kAudioDevicePropertyMute, scope(kind), kAudioObjectPropertyElementMain);
        if !has(dev, &a) {
            return Err(Error::Failed(format!("{id} cannot be muted")));
        }
        let now = get::<u32>(dev, &a).unwrap_or(0) != 0;
        let next = muted.unwrap_or(!now);
        set(dev, &a, next as u32)?;
        Ok(next)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::fs::on_path as has;
    use crate::tool::run;

    fn pactl_default(kind: Kind) -> String {
        run("pactl", &[if kind == Kind::Output { "get-default-sink" } else { "get-default-source" }]).map(|s| s.trim().to_string()).unwrap_or_default()
    }

    pub fn devices() -> Result<Vec<Device>> {
        if has("wpctl") {
            return Ok(parse_wpctl_status(&run("wpctl", &["status"])?));
        }
        if !has("pactl") {
            return Err(Error::Unavailable("neither wpctl (PipeWire) nor pactl (PulseAudio) is installed".into()));
        }
        let mut out = parse_pactl_json(&run("pactl", &["-f", "json", "list", "sinks"])?, Kind::Output, &pactl_default(Kind::Output));
        out.extend(parse_pactl_json(&run("pactl", &["-f", "json", "list", "sources"])?, Kind::Input, &pactl_default(Kind::Input)));
        Ok(out)
    }

    fn pactl_verb(what: &str, kind: Kind) -> String {
        format!("set-{}-{what}", if kind == Kind::Output { "sink" } else { "source" })
    }

    pub fn set_default(id: &str, kind: Kind) -> Result<()> {
        if has("wpctl") {
            return run("wpctl", &["set-default", id]).map(drop);
        }
        run("pactl", &[if kind == Kind::Output { "set-default-sink" } else { "set-default-source" }, id]).map(drop)
    }

    pub fn set_volume(id: &str, kind: Kind, percent: u8) -> Result<()> {
        if has("wpctl") {
            return run("wpctl", &["set-volume", "-l", "1.0", id, &format!("{:.2}", percent as f32 / 100.0)]).map(drop);
        }
        run("pactl", &[&pactl_verb("volume", kind), id, &format!("{percent}%")]).map(drop)
    }

    pub fn set_mute(id: &str, kind: Kind, muted: Option<bool>) -> Result<bool> {
        let arg = match muted {
            Some(true) => "1",
            Some(false) => "0",
            None => "toggle",
        };
        if has("wpctl") {
            run("wpctl", &["set-mute", id, arg])?;
            let vol = run("wpctl", &["get-volume", id])?;
            return Ok(vol.contains("MUTED"));
        }
        run("pactl", &[&pactl_verb("mute", kind), id, arg])?;
        Ok(devices()?.into_iter().find(|d| d.id == id && d.kind == kind).and_then(|d| d.muted).unwrap_or(false))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn devices() -> Result<Vec<Device>> {
        Err(Error::Unavailable("audio devices are not available on this platform".into()))
    }
    pub fn set_default(_: &str, _: Kind) -> Result<()> {
        devices().map(drop)
    }
    pub fn set_volume(_: &str, _: Kind, _: u8) -> Result<()> {
        devices().map(drop)
    }
    pub fn set_mute(_: &str, _: Kind, _: Option<bool>) -> Result<bool> {
        devices().map(|_| false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WPCTL: &str = r#"PipeWire 'pipewire-0' [1.6.8, cagdas@marko, cookie:596155856]
 └─ Clients:
        32. pipewire                            [1.6.8, cagdas@marko, pid:1742]

Audio
 ├─ Devices:
 │      48. Navi 31 HDMI/DP Audio               [alsa]
 │
 ├─ Sinks:
 │      56. Navi 31 HDMI/DP Audio Digital Stereo (HDMI 2) [vol: 0.40]
 │  *   57. Family 17h (Models 00h-0fh) HD Audio Controller Digital Stereo (IEC958) [vol: 1.00 MUTED]
 │
 ├─ Sources:
 │  *   58. Family 17h (Models 00h-0fh) HD Audio Controller Analog Stereo [vol: 1.00]
 │
 ├─ Filters:
 │
 └─ Streams:
        70. Chromium
             71. output_FL       > alsa_output:playback_FL        [active]

Video
 ├─ Devices:
 │
 ├─ Sinks:
 │      99. Not an audio sink [vol: 1.00]

Settings
 └─ Default Configured Devices:
         0. Audio/Sink    alsa_output.pci-0000_2b_00.3.iec958-stereo
"#;

    #[test]
    fn wpctl_status_sinks_and_sources_with_the_default_and_mute() {
        let d = parse_wpctl_status(WPCTL);
        assert_eq!(d.len(), 3, "{d:?}");
        assert_eq!(d[0], Device { id: "56".into(), name: "Navi 31 HDMI/DP Audio Digital Stereo (HDMI 2)".into(), kind: Kind::Output, default: false, volume: Some(40), muted: Some(false), transport: None });
        assert_eq!(d[1].id, "57");
        assert!(d[1].default && d[1].muted == Some(true) && d[1].volume == Some(100));
        assert_eq!((d[2].id.as_str(), d[2].kind, d[2].default), ("58", Kind::Input, true));
    }

    #[test]
    fn pactl_json_averages_channels_and_marks_the_default() {
        let json = r#"[
          {"index": 0, "name": "alsa_output.hdmi", "description": "HDMI Out", "mute": false,
           "volume": {"front-left": {"value": 26214, "value_percent": "40%", "db": "-23.8 dB"}, "front-right": {"value": 39321, "value_percent": "60%", "db": "-13 dB"}},
           "properties": {"device.bus": "pci"}},
          {"index": 1, "name": "bluez_output.AA", "description": "WH-1000XM4", "mute": true, "volume": {}, "properties": {}}
        ]"#;
        let d = parse_pactl_json(json, Kind::Output, "bluez_output.AA\n");
        assert_eq!(d.len(), 2);
        assert_eq!(d[0], Device { id: "alsa_output.hdmi".into(), name: "HDMI Out".into(), kind: Kind::Output, default: false, volume: Some(50), muted: Some(false), transport: Some("pci".into()) });
        assert_eq!((d[1].default, d[1].muted, d[1].volume), (true, Some(true), None));
        assert!(parse_pactl_json("not json", Kind::Input, "").is_empty());
    }
}
