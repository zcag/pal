# Privacy

What is using the camera, the microphone or the screen right now, over
the core's privacy capability: the macOS menu bar's orange, green and purple
dots, with the app named.

One palette, **Camera, Mic & Screen** (`privacy`), live: every use, cameras
first. Enter brings the app forward; a row with no app (a camera seen
before Control Center named it) opens the privacy settings instead. `⌘,` opens the sensor's privacy settings from any row.

One bar item, **Camera, Mic & Screen** (`privacy/in-use`). It is off the
strip until the camera, the microphone or the screen is in use (a call,
a screen share, a recording), then shows a glyph per sensor on an amber band with the apps in the
tooltip. The popover lists every use; Enter brings the focused app
forward, `s` opens Privacy & Security. The core watches once the item has
rendered and re-renders it on a change, so it appears within a second or
two with no poll in the extension.

## Rows

| part | what |
| --- | --- |
| name | the app responsible (a helper or a command counts against the app that started it), else the camera |
| subtitle | the sensor, then the process when it is not the app (`Microphone · ffmpeg`), or the camera's name |
| icon | the app's icon, else the sensor's glyph |

## Where it comes from

- **macOS**: the camera and the screen from Control Center's own record of
  the menu bar's dots (its `sensor-indicators` log: read once, then
  followed), which names the app; the microphone from CoreAudio's process
  objects (macOS 14.2+). A camera CoreMediaIO sees running before the log
  names it shows as the device, and an attached Screen Sharing session
  (`screensharingd`) as Screen Sharing.
- **Linux**: `pactl -f json list source-outputs` for the microphone,
  `/proc/*/fd` links into `/dev/video*` for the camera.
