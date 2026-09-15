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

**Done (2026-09-16):** `pal-app toggle|show|hide` (`app/src-tauri/src/cli.rs`).
The plugin listens; the second process does not wait for the plugin to
answer from inside a built tauri app (GTK up, display connected: ~95 ms on
marko) but hands its argv over itself before building anything, on the
plugin's own channel (D-Bus `io.cagdas.pal.SingleInstance` here, the
`/tmp/io_cagdas_pal_si.sock` socket on macOS). Measured from a shell on
marko, release: `pal-app toggle` 52 to 54 ms end to end, of which 45 ms is
the binary loading its 144 shared libraries (`pal-app --version` costs the
same) and about 2 ms is clap, `generate_context!` and the D-Bus call. The
rest of that floor only goes away with a CLI binary that does not link
webkit; not done. Hyprland bind verified with ydotool from a Chromium
(Wayland) focus, 7 of 7 presses, where the X11 grab fired 0 of 7.

The X11 grab stays registered on Wayland sessions with Xwayland: a bind that
matches consumes the key, so the two never double-fire. Without any X display
(`DISPLAY` unset, tested) startup still completes and `toggle` works.

## Window on Hyprland

`hyprctl clients`: class and initialClass `pal-app` (from the binary name, so
it will be `pal` once the crate is renamed), title `pal`, `xwayland: false`.
Re-checked 2026-09-16 with the Launcher UI: same, and `floating: true`,
`pinned: false`, mapped at (580,300) without any rule.

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
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:class ^(pal-app)$
bind = CTRL, space, exec, pal-app toggle
```

(`^(pal)$` once the binary is renamed.) The same set is quoted in
`app/src-tauri/src/panel/linux.rs` as what the app cannot do itself.

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

## Linux panel module (done 2026-09-16)

`app/src-tauri/src/panel/linux.rs`:

- `Focused(false)` -> `hide`. Verified: pal shown, `hyprctl dispatch
  focuswindow class:chromium`, pal unmapped, 3 of 3.
- Pre-map at startup: `show()` then `hide()` back to back in `install`. The
  window never reaches the screen (no client listed, no focus change) but
  GTK realizes it and WebKit sets up its surface. First show, release, same
  build, three runs each: without 111 to 124 ms (the 83 ms above was the
  probe UI), with 12 to 20 ms; later shows 0.1 to 1 ms either way. The
  remaining 12 to 20 ms is the first real frame after a map; a pre-map that
  stays mapped long enough to render (hide after a delay) would bring it
  under 2 ms, measured as the first CLI toggle after a `pal-app toggle`
  start, but flashes a focused window at startup. Under one frame at 60 Hz
  was judged the better deal. GTK toplevel opacity on Wayland still
  untested.
- `show`: `set_focus` on the window and on the webview, as on macOS.
- Hotkey registration failure is reported (`hotkey\t...` on stderr), not
  unwrapped; the hotkey itself now comes from `general.hotkey` in the config
  file and is re-registered when the file changes (`hotkey.rs`).
- Placement: `place()` runs and does nothing here; the windowrule above
  places.

Typing after re-shows is intact with the Launcher UI (`chrome` arrived in
full, three Escape-driven hides, three focus-loss hides).

## Installed

Nothing. Tauri v2 Linux prerequisites were all present on marko
(webkit2gtk-4.1 2.52.5, gtk3, librsvg, openssl, base-devel, curl, file).
`wget` and `libxdo` are absent and not needed for the build. `ydotool` (with
`ydotoold`), `grim`, `xmessage` were used for driving and screenshots;
`wtype` is not installed.

## Integrated app on marko (2026-09-16, dev build, commit 92dc234 + Linux apps)

- `apps` scans `.desktop` files (112 entries on marko, 43 ms), launches via
  `gio launch` / `gtk-launch` / parsed Exec; `Terminal=true` entries run in
  `$TERMINAL` or kitty/foot/xterm. Real icons through `icon://` on WebKitGTK
  with no changes; theme misses fall back to the letter.
- hotkey to paint 11-53 ms on a fresh start, 1.4 ms after; key to paint
  10-40 ms per letter. Frecency file lands under `~/.local/share/pal/`.
- bun is on PATH inside the Hyprland session (`~/.bun/bin` first).
  `WAYLAND_DISPLAY`/`DISPLAY` are not in Hyprland's own environ; take them
  from `systemctl --user show-environment` when launching by hand.
- Nerd Font glyph icons render as tofu: `.pal-icon[data-kind="glyph"]` uses
  `--pal-font-mono`, which resolves to Noto Sans Mono there and WebKitGTK does
  no PUA fallback. Needs a Nerd Font in the stack on Linux, or glyphs mapped
  to something the webview can draw.
- Seen once after a `tauri dev` restart: two rows showed the letter fallback
  although Rust answered 200 with the PNG. Not reproduced in 6 fresh starts.
