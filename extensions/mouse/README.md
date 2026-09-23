# Mouse & Trackpad

A three-finger tap or click on the trackpad as a middle click, and
scrolling reversed for the trackpad, the mouse or both, each axis apart:
what MiddleClick and Scroll Reverser do, as switches in pal's settings
(Settings > Extensions > Mouse & Trackpad) and as rows in this palette.
macOS only.

## The switches

| setting | default | what |
| --- | --- | --- |
| `middle_click` | `false` | Three fingers resting on the trackpad as it is pressed: the click is a middle one, and so are its drag and its release. |
| `middle_click_tap` | `true` | With `middle_click` on, three fingers tapped and lifted together, without moving, click the middle button at the cursor. |
| `reverse_trackpad` | `false` | The trackpad scrolls against System Settings' direction. |
| `reverse_mouse` | `false` | The mouse wheel (or a Magic Mouse) scrolls against System Settings' direction. |
| `reverse_vertical` | `true` | The reversed devices flip up and down. |
| `reverse_horizontal` | `true` | The reversed devices flip left and right. |

macOS has one natural scrolling switch for the mouse and the trackpad
together. To have natural scrolling on the trackpad and a wheel that
scrolls the old way, leave natural scrolling on and turn
`reverse_mouse` on.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Flip the row's switch |
| `cmd+,` | Open the settings |

`pal://mouse/toggle?setting=<id>` flips one switch from a keybind, and
the HUD says where it landed (`Reverse mouse scrolling on`).

## How it works

The app does the work (`app/src-tauri/src/mouse.rs`). An active event tap
on its own thread rewrites left clicks into middle ones and negates the
scroll deltas. The fingers come from MultitouchSupport, the private
framework every finger-counting tool reads.

- A three-finger tap is three fingers down and up within 0.3 s, their
  centre moving less than 5% of the trackpad, a fourth finger never
  landing and the trackpad never pressed. A swipe with three fingers is
  not a tap.
- A scroll comes from the mouse when it moves in a wheel's notches, or
  when fewer than two fingers are down as it begins (a Magic Mouse
  scrolls under one). Otherwise it comes from the trackpad. Momentum
  keeps the source of the scroll it follows.
- The devices are listed again every 3 s, so a Magic Trackpad paired
  later and the Mac waking from sleep are picked up without a restart.

## Setup

It needs Accessibility. Turning a switch on asks for it when it is
missing, and the row at the top of the palette asks on Enter; it starts
the moment the grant lands. Turn off System Settings > Trackpad > Point &
Click > Look up & data detectors if it is set to a three-finger tap, so
the tap is the middle click's alone.

## Platforms

macOS. On Linux the palette is one row saying it is not available
(there is no portable input tap: Wayland hands input to the focused app
only).
