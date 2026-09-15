# Linux go/no-go (marko, 2026-09-16)

Box: marko, Arch, Hyprland 0.56.0 on Wayland, WebKitGTK 2.52.5, Ryzen 5 2600X,
amdgpu, one 1920x1080@60 monitor. Clone at `marko:~/proj/pali` (pushed `pali`
branch, the probe shell: old `App.tsx`, not the Launcher). Corpus from
`scripts/fixtures.sh` with marko's v1 `pal`: 14767 rows (hornet: 14719).

## Numbers

Marks from stderr; release is `cargo build --release --features
tauri/custom-protocol` run directly. macOS column is hornet, release.

| mark                    | marko release      | marko dev            | hornet release |
| ----------------------- | ------------------ | -------------------- | -------------- |
| hotkey->paint, first    | 83 ms              | 90 to 152 ms         | 1.7 ms         |
| hotkey->paint, later x6 | 0.3 to 4.0 ms      | 0.7 to 18 ms         | 1.5 to 3 ms    |
| key->paint, "chrome"    | 24 to 76 ms        | 25 to 107 ms         | 9 to 26 ms     |
| feed, 14767 rows        | 57 ms              | 142 to 188 ms        | 25 ms          |

- Later shows are as fast as macOS: the page stays alive while the GTK window
  is unmapped (no rendering suspension seen; re-map is paint-ready).
- First show is the one visible gap: the window has never been mapped, so the
  first show pays surface creation plus first frame. Same class of fix as
  macOS (pre-map once, invisible), see below.
- key->paint is 2 to 3x hornet. Same JS (fzf over 14.7k, 200 rows); the
  difference is WebKitGTK layout/paint on this box. Not measured further.

## Global hotkey on Wayland: no

`global-hotkey` 0.8 is X11-only on Linux (`src/platform_impl/mod.rs` maps
every Linux target to `x11/mod.rs`; line 231 spells it out). On marko it
registers fine because Xwayland is up, but the grab lives on Xwayland: Ctrl+Space
fires only while an X11 client is focused (tested: nothing with Chromium
focused, fires with `xmessage` focused). In scripted runs about 1 in 7 presses
through that path was also missed. Every measurement above was triggered that
way.

Needed: a Wayland path of our own. Cheapest: `tauri-plugin-single-instance`
(second launch hands its argv to the running app), so `bind = CTRL, space,
exec, pal toggle` in hyprland.conf toggles it. A signal (SIGUSR1) works too but
does not compose with a CLI. The plugin can stay for X11 sessions.

## Window on Hyprland

`hyprctl clients`: class and initialClass `pal-app` (from the binary name, so
it will be `pal` once the crate is renamed), title `pal`, `xwayland: false`.

- Floating: yes without any rule. `resizable: false` makes min size == max
  size and Hyprland floats fixed-size toplevels. Placed at Hyprland's own
  centre (580,300), not at 20% down: `set_position` is a no-op on Wayland,
  `cursor_position` fails, so `place()` does nothing here.
- Not pinned: stayed on workspace 3 when the workspace changed.
- Transparent with rounded corners: yes. Alpha 0.92 page background shows the
  window behind; corners clipped (Hyprland rounding 7 plus the CSS radius).
  Not an opaque rectangle.
- Blur: CSS `backdrop-filter` blurs nothing (WebKitGTK cannot see behind the
  surface; the page behind is sharp). With `decoration:blur:enabled = true`
  Hyprland blurs behind the translucent surface itself (verified with a
  temporary keyword; marko keeps blur off). So on Hyprland the blur is the
  compositor's, opt-in per user config.
- Hide on focus loss: no in the fallback module. `WindowEvent::Focused(false)`
  handler calling `hide` works (tested in the clone; fires once per hide, no
  spurious fire right after show).
- Typing reaches it: yes, once the bug below is avoided.
- Animation: marko has animations off, so untested; default configs animate
  window map, hence `no_anim on`.
- Monitor under cursor: one monitor here, untested. Each show is a fresh map,
  and Hyprland maps new windows on the focused monitor, so it should follow.

Rule set that gave pinned, no border, no shadow, centred at 20% down, verified
live with `hyprctl keyword` (Hyprland 0.56 syntax):

```
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:class ^(pal)$
```

`center on` also works but centres vertically. `move` with `monitor_w`/`window_w`
expressions is what puts it where `place()` wants it, since the app cannot.

## Broken: first key after a re-show is lost (WebKitGTK)

Every show after the first lost the first keystroke: typed `chrome`, query was
`hrome`; Escape sometimes did nothing. Traced with probes: GTK receives the key
on the toplevel with `WebKitWebView` as the focus widget, focused and mapped,
and the DOM never gets `keydown`. Independent of `GTK_IM_MODULE` and of
`GDK_BACKEND=x11`. It does not happen when the hide is not triggered from a
key event (hide by focus loss: no key lost across 3 rounds).

Cause, consistent with WebKitGTK's two-pass key handling: an unhandled keydown
(Escape without `preventDefault`) is re-dispatched by the UI process with a
"forward next key event" flag; we hid the window inside that keydown, the
re-dispatch went nowhere, the flag stuck, and the next key after re-show was
forwarded past the page. Fix: `preventDefault()` on the keydown that hides
(verified: no loss across Escape-driven hides). The current `useKeys`
(`ui/keys.ts:110`) already does this for any handled key; the probe `App.tsx`
did not. Rule to keep: never hide from inside an unhandled key event.

## Missing in the Linux panel module

- `install`: `Focused(false)` -> `hide`. Pre-map once at startup (show then
  hide, or map with opacity 0) to move first show from 83 ms toward the
  1 to 4 ms of later shows. GTK 3 toplevel opacity on Wayland is untested.
- `show`: also `webview.set_focus()` as on macOS (harmless, did not affect the
  key loss).
- Hotkey: Wayland toggle path (above). Report hotkey registration failure
  instead of unwrapping it: on a Wayland box without Xwayland `register`
  errors and setup aborts.
- Placement: nothing to do in-app on Wayland; ship the windowrule.

## Installed

Nothing. Tauri v2 Linux prerequisites were all present on marko
(webkit2gtk-4.1 2.52.5, gtk3, librsvg, openssl, base-devel, curl, file).
`wget` and `libxdo` are absent and not needed for the build. `ydotool` (with
`ydotoold`), `grim`, `xmessage` were used for driving and screenshots;
`wtype` is not installed.
