// What the display tools print, for the displays tests: a MacBook with a
// Dell on DisplayPort (the Dell main, the panel to its left), the same
// pair mirrored, and the Linux tools' shapes.

export const BUILTIN = "37D8832A-2D66-02CA-B9F7-8F30A301B230";
export const DELL = "5B7C3D1E-0000-4B2A-9F10-2C6D0A3E77F1";

const modes = (w: number, h: number, hidpi: boolean, from: number) => [120, 60].map((hz, i) => `  mode ${from + i}: res:${w}x${h} hz:${hz} color_depth:8${hidpi ? " scaling:on" : ""}${w === 1800 && hz === 120 ? " <-- current mode" : ""}`).join("\n");

export const DISPLAYPLACER = `Persistent screen id: ${BUILTIN}
Contextual screen id: 1
Serial screen id: s4251086178
Type: MacBook built in screen
Resolution: 1800x1169
Hertz: 120
Color Depth: 8
Scaling: on
Origin: (-1800,271)
Rotation: 0 - rotate internal screen example (may crash computer, but will be rotated after rebooting): \`displayplacer "id:${BUILTIN} degree:90"\`
Enabled: true
Resolutions for rotation 0:
${modes(1512, 945, true, 0)}
${modes(1800, 1169, true, 2)}
${modes(1920, 1200, false, 4)}
${modes(3024, 1964, false, 6)}

Persistent screen id: ${DELL}
Contextual screen id: 2
Serial screen id: s1234567
Type: 27 inch external screen
Resolution: 2560x1440
Hertz: 60
Color Depth: 8
Scaling: on
Origin: (0,0) - main display
Rotation: 0
Enabled: true
Resolutions for rotation 0:
  mode 0: res:1920x1080 hz:60 color_depth:8 scaling:on
  mode 1: res:2560x1440 hz:60 color_depth:8 scaling:on <-- current mode
  mode 2: res:3008x1692 hz:60 color_depth:8 scaling:on
  mode 3: res:3840x2160 hz:60 color_depth:8

Execute the command below to set your screens to the current arrangement. If screen ids are switching, please run \`displayplacer --help\` for info on using contextual or serial ids instead of persistent ids.

displayplacer "id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0" "id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0"
`;

/** The same two, the Dell mirroring the panel. */
export const DISPLAYPLACER_MIRRORED = DISPLAYPLACER.replace(/\ndisplayplacer .*\n$/, `\ndisplayplacer "id:${BUILTIN}+${DELL} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0"\n`);

export const PROFILER = JSON.stringify({
  SPDisplaysDataType: [{
    _name: "Apple M5 Max",
    spdisplays_ndrvs: [
      { _name: "Color LCD", _spdisplays_displayID: "1", _spdisplays_pixels: "3600 x 2338", _spdisplays_resolution: "1800 x 1169 @ 120.00Hz", spdisplays_connection_type: "spdisplays_internal", spdisplays_display_type: "spdisplays_built-in-liquid-retina-xdr", spdisplays_main: "spdisplays_no", spdisplays_mirror: "spdisplays_off", spdisplays_online: "spdisplays_yes" },
      { _name: "DELL U2720Q", _spdisplays_displayID: "2", _spdisplays_pixels: "5120 x 2880", _spdisplays_resolution: "2560 x 1440 @ 60.00Hz", spdisplays_connection_type: "spdisplays_displayport_dongletype_dp", spdisplays_main: "spdisplays_yes", spdisplays_mirror: "spdisplays_off", spdisplays_online: "spdisplays_yes" },
    ],
  }],
});

export const M1DDC_LIST = `[1] (null) (${BUILTIN})
 - Product name:  (null)
 - Manufacturer:  00-10-fa
 - Display ID:    1
 - System UUID:   ${BUILTIN}
[2] DELL U2720Q (${DELL})
 - Product name:  DELL U2720Q
 - Manufacturer:  DEL
 - AN Serial:     ABC1234
 - Display ID:    2
 - System UUID:   ${DELL}
 - EDID UUID:     10AC-D0A1-00000000-0000-0000-0000-1E0F0000
`;

export const BRIGHTNESS_L = (level: string) => `display 0: main, active, awake, online, built-in, ID 0x1
display 0: brightness ${level}
display 1: active, awake, online, external, ID 0x2
`;

export const DDCCTL = `D: NSScreen #2 (2560x1440 0°) HiDPI
I: found 1 external display
I: polling EDID for #1 (ID 2 => IOService:/...)
I: got edid.name: DELL U2720Q
I: VCP control #16 (0x10) = current: 70, max: 100
`;

export const HYPRCTL = JSON.stringify([
  { id: 0, name: "eDP-1", description: "BOE 0x0BCA", make: "BOE", model: "0x0BCA", width: 2880, height: 1800, refreshRate: 120.0, x: 0, y: 0, scale: 2.0, transform: 0, focused: false, disabled: false, mirrorOf: "none", availableModes: ["2880x1800@120.00Hz", "2880x1800@60.00Hz", "1920x1200@60.00Hz"] },
  { id: 1, name: "DP-1", description: "Dell Inc. DELL U2720Q ABC1234", make: "Dell Inc.", model: "DELL U2720Q", width: 3840, height: 2160, refreshRate: 59.997, x: 1440, y: 0, scale: 1.5, transform: 0, focused: true, disabled: false, mirrorOf: "none", availableModes: ["3840x2160@59.99Hz", "3840x2160@29.98Hz", "2560x1440@59.95Hz"] },
]);

export const WLR_RANDR = JSON.stringify([
  { name: "DP-1", make: "Dell Inc.", model: "DELL U2720Q", serial: "ABC1234", enabled: true, modes: [{ width: 3840, height: 2160, refresh: 59.997, preferred: true, current: true }, { width: 2560, height: 1440, refresh: 59.951, preferred: false, current: false }], position: { x: 0, y: 0 }, transform: "normal", scale: 1.5 },
]);

export const XRANDR = `Screen 0: minimum 320 x 200, current 6720 x 2160, maximum 16384 x 16384
eDP-1 connected 2880x1800+0+0 (normal left inverted right x axis y axis) 302mm x 189mm
   2880x1800    120.00*+  60.00
   1920x1200     60.00
DP-1 connected primary 3840x2160+2880+0 (normal left inverted right x axis y axis) 597mm x 336mm
   3840x2160     59.98*+  29.98
   2560x1440     59.95
HDMI-1 disconnected (normal left inverted right x axis y axis)
`;

export const DDCUTIL_DETECT = `Display 1
   I2C bus:  /dev/i2c-4
   DRM connector:  card1-DP-1
   Monitor:  DEL:DELL U2720Q:ABC1234
`;
