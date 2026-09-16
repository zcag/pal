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
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:class ^(pal)$
bind = CTRL, space, exec, pal toggle
```

(The binary was `pal-app` when this was measured; it is `pal` since the
bundling pass, and the class follows.) The same set is quoted in
`app/src-tauri/src/panel/linux.rs` as what the app cannot do itself.

The HUD window (`hud.rs`) has the same class, so the rule above would put it
at 20% down too; its own rule keys on the title and goes first (untested on
marko, written from the panel's):

```
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, no_focus on, move (monitor_w*0.5-window_w*0.5) (monitor_h-window_h-8), match:title ^(pal HUD)$
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
- Nerd Font glyph icons rendered as tofu (WebKitGTK does no PUA fallback).
  Fixed: the app bundles Symbols Nerd Font Mono (woff2, 1.2 MB) scoped to the
  private-use range, used only for glyph icons; verified on marko with a
  fontconfig that rejects every Nerd Font.
- Seen once after a `tauri dev` restart: two rows showed the letter fallback
  although Rust answered 200 with the PNG. Not reproduced in 6 fresh starts.

## Bundle (marko, 2026-09-16)

`NO_STRIP=true npm run tauri build` in `app/` gives `target/release/bundle/`:
`appimage/pal_0.1.0_amd64.AppImage` 137 MB, `deb/pal_0.1.0_amd64.deb` 44 MB,
`rpm/pal-0.1.0-1.x86_64.rpm` 44 MB; the bare `pal` binary is 13.6 MB, the
bun sidecar 79.5 MB. Tauri fetched `linuxdeploy-x86_64.AppImage`, its gtk
and gstreamer plugin scripts, `linuxdeploy-plugin-appimage` and `AppRun` into
`~/.cache/tauri/` (five downloads, once). Nothing else was installed.

- `NO_STRIP=true` is load-bearing on Arch: linuxdeploy carries its own old
  `strip`, which rejects every library here (`unknown type [0x13] section
  .relr.dyn`, what current binutils emit) and the bundle fails with only
  `failed to run linuxdeploy` unless run with `-v`.
- The AppImage bundles the whole webkit2gtk stack (174 libraries, 274 MB
  before squashfs; libwebkit2gtk 94 MB, libjavascriptcoregtk 38 MB, ICU data
  33 MB), which is what the size is. The deb depends on the system's
  `libwebkit2gtk-4.1-0` and `libgtk-3-0` instead.
- Inside the AppImage `bun` is `usr/bin/bun` next to `usr/bin/pal` and the
  host plus extensions are `usr/lib/pal/{host,extensions}`; the deb installs
  the same at `/usr/bin/bun` (which shadows nothing on PATH before it, but
  is a system-wide `bun` all the same) and `/usr/lib/pal/`.
- linuxdeploy's gtk hook exports `GDK_BACKEND=x11` (tauri#8541), so the
  AppImage as built ran under Xwayland: class `Pal`, `xwayland: 1`, mapped
  at 0,0, the windowrule for `^(pal)$` never matching. Native Wayland works
  fine with the bundled GTK on marko, so `main.rs` sets
  `GDK_BACKEND=wayland,x11` when `APPDIR` and `WAYLAND_DISPLAY` are both set
  (`PAL_GDK_BACKEND` overrides). Verified: class `pal`, `xwayland: 0`,
  floating, at Hyprland's centre (580,300).
- From the AppImage: host ready 510 ms on a cold squashfs mount (calc's
  1.5 MB bundle is the slow import at 326 ms), 113 apps, first paint 19 to
  23 ms, later 0.7 ms. calc (`15% of 240` = 36) and the emoji grid verified
  by typing into it with ydotool.
- `pal toggle` through the AppImage costs 226 to 234 ms end to end: each
  invocation mounts the squashfs before the 50 ms bare-binary path from the
  section above runs. A Hyprland bind wants the deb's `/usr/bin/pal toggle`
  or the extracted AppDir's `usr/bin/pal`, not the AppImage file.

## Tray icon and autostart

- The tray is tauri's `tray-icon` feature (`app/src-tauri/src/tray.rs`),
  which on Linux is the `libappindicator` crate: it `dlopen`s
  `libayatana-appindicator3.so.1`, falling back to `libappindicator3.so.1`,
  at the first tray creation, so nothing links at build time and the
  binary starts without either. With neither library the icon is simply
  missing (a `tray  create failed` line in the log) and the hotkey, `pal
  toggle` and `pal settings` still work. Arch: `libayatana-appindicator`;
  Debian/Ubuntu: `libayatana-appindicator3-1`, which the deb does list
  under `bundle.linux.deb.depends` (tauri.conf.json). tauri-cli adds the
  same package by itself when the `tray-icon` feature is on and pkg-config
  finds ayatana on the build machine (`crates/tauri-cli/src/interface/rust.rs`,
  the `TrayKind::Ayatana` arm; the release runner installs
  `libayatana-appindicator3-dev`), so the explicit entry makes the deb say
  it regardless of the builder. Hyprland and Sway need a bar with an SNI
  tray (waybar `tray` module) to show it.
- The image is `icons/tray/22x22.png`, white on transparent (the same mark
  as macOS's template image, `app/design/tray.svg` with the fill swapped),
  for the dark panels the bars above default to. `icon_as_template` is a
  macOS-only property; it is set unconditionally and ignored here.
- `general.launch_at_login` writes `~/.config/autostart/pal.desktop`
  (`Exec=` the binary, or the AppImage when `APPIMAGE` is set) through
  tauri-plugin-autostart / auto-launch; a debug build skips it. Hyprland
  does not read XDG autostart on its own: users there add `exec-once = pal`
  to hyprland.conf, which the settings description should say once the
  Linux copy is written.

### Run on marko (2026-09-16, release build of 63a73f8, `PAL_CONFIG=/tmp/pal-test.toml`)

- Log: `profile d720efea /tmp/pal-test.toml ~/.local/share/pal/d720efea`,
  `hotkey registered control+Space Root`, `tray created ...` 200 ms after
  start, then libayatana's "deprecated, use libayatana-appindicator-glib"
  warning (harmless). `pal quit` from the session env: `quit requested`,
  `host exit 0`, `host stopped 18.3ms`, `quit flushed`; no `pal`/`pal-bun`
  left.
- marko has no tray host: no waybar/dms process, and no
  `org.kde.StatusNotifierWatcher` on the session bus (`busctl --user call
  org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus
  NameHasOwner s org.kde.StatusNotifierWatcher` says `b false`). The app
  does not care: the item is exported on pal's own bus connection at
  `/org/ayatana/NotificationItem/tray_icon_tray_app_pal` (+ `/Menu`) with
  `Status Active`, `IconName /run/user/1000/tray-icon/tray-icon-pal-0.png`
  (libappindicator writes the 22 px PNG there), and libayatana registers
  with a watcher whenever one appears.
- Visible check: a throwaway tray-only waybar (`/usr/bin/waybar` is
  installed, just not running) showed the white rounded-square mark next
  to warp-taskbar's cloud icon, 22 px, on a `#1e1e2e` bar. Screenshot
  taken with `grim -g "1520,0 400x30" -s 3`.
- `launch_at_login = true` in the test config: `config reloaded`,
  `autostart registered`, and `~/.config/autostart/pal.desktop` appeared:
  `Type=Application`, `Name=pal`, `Comment=palstartup script` (auto-launch's
  wording, note the missing space), `Exec=/home/cagdas/proj/pali/target/release/pal `
  (trailing space, from auto-launch's args join), `StartupNotify=false`,
  `Terminal=false`. `= false`: `autostart removed`, file gone.
- `menu_bar_icon = false`: `tray removed`, the PNG under
  `/run/user/1000/tray-icon/` deleted. BROKEN on the way back: `= true`
  logs `tray created` but libayatana says `Unable to register object on
  path '/org/ayatana/NotificationItem/tray_icon_tray_app_pal': An object
  is already exported`, the stale object stays exported with
  `Status Passive`, and the bar shows nothing (screenshot with the
  throwaway waybar: only warp-taskbar). Cause: tray-icon 0.24.2
  `platform_impl/gtk/mod.rs` names the indicator
  `"tray-icon tray app {id}"` (line 25) and its `Drop` only sets
  `Passive` (line 116), never disposes it, so the same id `"pal"` collides
  on the second build. Sidestep from our side: a fresh id per creation
  (`pal-<n>`, and look the tray up by the current one), or keep the tray
  and toggle its visibility instead of removing it. macOS not re-checked
  here (guess: unaffected, NSStatusItem is released on drop).
- `gtk_widget_get_scale_factor: assertion 'GTK_IS_WIDGET (widget)' failed`
  (Gtk-CRITICAL) once per tray create/remove and once when the bar picked
  the item up; guess: libappindicator's fallback GtkStatusIcon path, no
  visible effect.
- Hyprland aside: `hyprctl` needs `HYPRLAND_INSTANCE_SIGNATURE` too, not
  just `WAYLAND_DISPLAY`; all of them come from
  `systemctl --user show-environment`.
