# Displays

Every display with its mode and brightness; Enter drills into one for its
controls (brightness, contrast, volume as sliders, the input source), its
modes (resolution, refresh rate, HiDPI scaling), rotation, mirroring and
Make main; arrangement presets; a bar item with a slider per display. The
palette's full description, keys and settings are in `docs/palettes.md`
("Displays").

## What runs where

Nothing is built in: every fact comes from a tool, each optional, and a
Setup row says what to install for the displays that are connected (Enter
copies the command). The listing itself needs no tool on macOS.

| | macOS | Linux |
| --- | --- | --- |
| the displays, names, current mode, main, mirror | `system_profiler SPDisplaysDataType -json` (~150 ms) | `hyprctl monitors -j`, else `wlr-randr --json`, else `xrandr --query` |
| modes, rotation, mirroring, main, presets | `displayplacer` (`brew install displayplacer`, ~300 ms a listing) | the same compositor tool |
| built-in brightness | `brightness` CLI, the HEAD build (`brew install --HEAD brightness`) | `brightnessctl` |
| external brightness, contrast, volume, input | `m1ddc` on Apple Silicon, `ddcctl` on Intel, over DDC/CI | `ddcutil` |
| Night Shift | `nightlight` (`brew install smudge/smudge/nightlight`) | not offered |

The displays are joined on the CoreGraphics display id on macOS, which is
what `windows.displays()` in the SDK reports, displayplacer calls the
"contextual" id and m1ddc the "Display ID"; on Linux on the output name
(`DP-1`). Routes take that id, or `main` / `external` / `builtin` / a name.

Notes per tool:

- The `brightness` on PATH is validated (`-l` must list displays) and
  Homebrew's prefixes are tried when it is something else by that name.
  The bottled 1.2 cannot read or set an Apple Silicon panel (it answers
  `kIOReturnUnsupported`); the HEAD build goes through DisplayServices and
  can. It also reads Apple displays (Studio Display) the same way.
- `m1ddc` sets the input source but cannot read which is active, so the
  Input row carries no `current` tag with it; `ddcctl` and `ddcutil` read
  it. Volume is offered only when the monitor answers a volume read.
- `displayplacer`'s reproduce line (the last line of `list`) is what a
  preset stores and what Undo restores; every change is that line with
  one field moved, so a mode change never touches the other displays.
  Rotating the built-in screen asks first, with displayplacer's own
  warning.
- The built-in panel never goes below 5 % from pal (`BUILTIN_FLOOR` in
  `tools.ts`): a screen you cannot see is one you cannot fix from.
- On Linux, Make main exists only under xrandr (`--primary`); Wayland
  compositors have no primary output.

## Caching

`displayplacer list` plus `system_profiler` cost a few hundred ms, so one
snapshot of the displays stands for 20 s (`SNAPSHOT_TTL_MS`), and a level
reading for 3 s (brightness moves under the keyboard's keys too). `⌘R`,
a write and the bar item's `wake` refresh drop both. Tools are re-detected
every minute, so a `brew install` lands without a restart.

## Files

`model.ts` is pure: the parsers of every tool's output and the placement
maths (a mode, the main display, a mirror set, a rotation as the next
displayplacer command), fixture-tested in
`host/test/extensions/displays.test.ts`. `tools.ts` runs the tools and
keeps the caches. `view.ts` draws the slider level and the bar popover.
`index.ts` is the palette, the picks, the bar item and the routes.
