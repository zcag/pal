# Privacy

What is using the camera, the microphone or the screen right now, over
the core's privacy capability: the macOS menu bar's orange and green dots,
with the app named.

One palette, **Camera & Microphone** (`privacy`), live: every use, cameras
first. Enter brings the app forward; a camera row has no app (macOS says
that a camera runs, not for whom), so its Enter opens the camera's privacy
settings. `⌘,` opens the sensor's privacy settings from any row.

One bar item, **Camera & Microphone** (`privacy/in-use`). It is off the
strip until the camera, the microphone or a Screen Sharing session is in
use, then shows a glyph per sensor on an amber band with the apps in the
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

- **macOS**: CoreAudio's process objects for the microphone (macOS 14.2+),
  CoreMediaIO for the cameras, `screensharingd` for Screen Sharing.
- **Linux**: `pactl -f json list source-outputs` for the microphone,
  `/proc/*/fd` links into `/dev/video*` for the camera.
