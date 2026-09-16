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

```text
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:title ^(pal)$
bind = CTRL, space, exec, pal toggle
```

(First measured with `match:class ^(pal)$`; the class is the binary name,
`pal-app` then, `pal` since the bundling pass. Keyed on the title since the
full check below: the HUD and the settings window carry the same class, and
the class rule floated and pinned both.) The same set is quoted in
`app/src-tauri/src/panel/linux.rs` as what the app cannot do itself.

The HUD window (`hud.rs`) has the same class and the title `pal HUD`; its
rule keys on that (verified on marko in the full check below, mapped at
`monitor_h - window_h - 8`):

```text
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, no_focus on, move (monitor_w*0.5-window_w*0.5) (monitor_h-window_h-8), match:title ^(pal HUD)$
```

The settings window (`pal Settings`) gets no rule: it is a normal window and
tiles like any other.

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

## Full check (marko, 2026-09-16 14:00, Mac working tree at 1922261 plus uncommitted work)

Driven from the Mac over ssh: `hyprctl keyword` bind and rules, `ydotool`
for keys, `grim` crops of the panel; `PAL_CONFIG=/tmp/pal-check.toml`
(`hotkey = ""`, `menu_bar_icon = false`), log `/tmp/pal-check.log`, a kitty
with `map ctrl+v paste_from_clipboard` and `cat` as the paste target.
Everything below was removed afterwards (config, profile `7c16813b`, bind,
rules via `hyprctl reload`, the test kitty, my storage and clipboard rows);
the clone is back at a clean 1922261 with `target/release/pal` built from
the tree described next.

### Build: the pushed commit does not build

- HEAD 1922261 as pushed fails both builds. `npm run build`:
  `src/ui/index.ts(34,60): Cannot find module './SettingsAbout'`, same for
  `./SettingsList`, `Gallery.tsx(571)` `onOpenLink` unknown prop,
  `Gallery.tsx(572)` page `"about"` not in `SettingsPage`. `cargo build`:
  `lib.rs:215` `settings::__cmd__settings_about` and `settings_open_link`
  missing, `lib.rs:204` `tauri_plugin_window_state` and `settings::STATE`
  missing. The Mac working tree has the rest: 68 modified files and 16
  untracked ones (`sdk/` package, root `package.json` workspace,
  `app/src/ui/SettingsAbout.tsx`, `SettingsList.tsx`, `host/src/sdk.ts`,
  `LICENSE`, ...), all uncommitted. The check ran against that tree,
  rsync'd onto marko (`.git`, `target`, `node_modules`, `dist`, the darwin
  sidecar and `resources/` excluded). Fix: commit it.
- Fresh clone, even with that tree: `npx tsc --noEmit` in `app/` fails with
  `../sdk/src/api.ts(6,25): error TS2591: Cannot find name 'node:os'`. The
  app reaches `@zcag/pal` through `extensions/blackjack/render.ts` (Gallery
  imports it); the package's `exports` gives `types: ./dist/index.d.ts`, so
  on the Mac, where `sdk/dist` exists, tsc reads the declarations and never
  sees `api.ts`. Without `dist` it falls to `src/index.ts`, and the app's
  tsconfig has no bun or node types. `cd sdk && bun run build` first, then
  it passes (3m57s release build, 17.0 MB binary). ci.yml runs the app
  typecheck (line 94) before `sdk build and pack` (line 110), so CI fails
  the same way. Fix: build the sdk before the app typecheck (CI order, a
  Makefile target, or a `prebuild` in app/package.json), or point
  `types` at `src` with a `/// <reference types="node" />` in `api.ts`.
- `bun install` (1.3.14) rewrites `host/bun.lock`,
  `extensions/calc/bun.lock`, `extensions/scripts/bun.lock` every time;
  `git checkout -- .` before a pull, as before.

### Runtime, per item

1. Panel: working. Bind fired 100% through ydotool; `hotkey->paint 22.4`
   first show, later shows under 1 ms; `key->paint` 4 to 30 ms per letter.
   Mapped at (580,216) 760x480, floating, pinned, per the class rule. Hide
   unmaps (no client listed). Chromium pick: `pick apps/apps
   /usr/share/applications/chromium.desktop 8.4ms`, a window came up 3 s
   later (a second Chromium instance under Xwayland, class `Chromium`: the
   daily one runs a custom profile at `~/.local/share/chrome-main`, so the
   .desktop launch starts the default profile), closed with `closewindow`.
   Cosmetic: the Welcome row says "Show tips again" in `⌘K` on Linux while
   the footer says `Ctrl K` (screenshot 01-root).
2. Blackjack: working. `pick blackjack/blackjack 24.0`, `view 33.0`; cards
   are the SVG images, keycaps and footer render; `pick view (deal)`,
   `(hit)`, `(stand)`, `(next)` logged for Enter/H/S/Enter, each 4 to 7
   ms; a bust ignores S. Escape pops the level, then clears the query, then
   hides, as keyboard.md says (screenshots 04 to 11).
3. Quicklinks: working. Form renders, Tab moves between fields, Enter
   submits (`pick create (save) 4.0`, toast "Created"), the row drills in
   on Enter, typing a query shows `Open Example check
   https://example.com/?q=hello%20world`, Enter opens it (`pick ... (open)
   9.0`, a Chromium window titled "Example Domain", closed).
   Snippets: working. Ctrl+C: `pick ... (copy) 12.0`, `wl-paste` gives
   `hello from pal on 2026-09-16`, the HUD says Copied. Enter: `pick ...
   (paste) 184.0`, the text landed in the kitty's `cat`. `wtype` is not
   installed on marko, so this went through `ydotool key 29:1 47:1 ...`
   (`clipboard.rs:798`). Plain kitty does not paste on Ctrl+V (that is
   Ctrl+Shift+V), so a real kitty target needs the map; GTK apps and
   Chromium take Ctrl+V. Cosmetic: the textarea submits on Ctrl+Enter
   (`Form.tsx:28`) but the Create button and the footer both say `Enter`.
4. Window management: working on Hyprland. Kitty tiled 0,0 1920x1080
   before; `left_half` gave 0,0 960x1080 floating, `maximize` 0,0
   1920x1080, `restore` 0,0 1920x1080 but still floating (the frame comes
   back, the tiled state does not), `right_half` 960,0 960x1080; `pick
   left_half (apply) 131.0`, maximize 149, restore 124. The HUD names the
   layout (screenshot 26-wm-hud-full).
   BROKEN, rules: with the two rules in the order this file gives (HUD rule
   first), the HUD mapped at (720,216), the panel's spot. Both rules match
   the HUD (class `pal` and the title), and Hyprland applies the last
   `move` that matches. Appending the HUD rule after the panel rule put it
   at (720,872) = `monitor_h - window_h - 8`. Fix: swap the order in this
   file, docs/getting-started.md and `panel/linux.rs:56`, or better, key
   the panel rule on `match:title ^(pal)$` so it stops matching the HUD
   and Settings. The HUD toplevel is 480x200 on Hyprland, not the 480x72 in
   tauri.conf.json; the capsule sits at the window's bottom edge (CSS
   `flex-end`), so it still reads 32 px above the screen edge, but the
   invisible surface is 200 px tall.
5. Files: working. Empty state row says `fd in ~` (the only place the
   backend is named; nothing in the log). `aishot` listed three rows with
   size and age, Enter: `pick files/files
   /home/cagdas/cloud/other/wp/aishot-575.jpg (open) 1.0`, xdg default
   for image/jpeg here is Chromium, a window came up, closed. Slow tail:
   `host list 1195.77ms` for `aishot` (fd walks all of `~` when fewer than
   50 names match; two-letter queries took 14 to 45 ms).
6. System: working. `pick system/system volume-mute 15.2ms`, `wpctl
   get-volume` went `1.00 [MUTED]` then `1.00`. The rows are not in the
   root index (`index system/system 0 items`): typing `toggle mute` at the
   root found nothing from System and Enter ran a `scripts/tabs` row
   instead (which focused a tab in the daily Chromium; put back with `bt
   activate`). Drill into System first.
   Clipboard history: working. Two `wl-copy` texts and a `wl-copy --type
   image/png` all recorded (`clipboard.db` rows 4 to 6), the palette shows
   them with the image row "Image 800 x 340", its thumbnail, and the
   preview pane with kind, 9.7 KB, 800 x 340 px and the time (screenshot
   35-cliphist). Ranking at the root: `clipboard` lists the emoji and 73
   iconnerd rows first, `history` five iconnerd rows first; `clipboard
   history` puts the palette row on top.
7. Settings: working. `pal settings` 54 ms, `settings open after 720x520`,
   General renders (Hotkey with presets, Theme, Window position, Startup).
   Clicking Light then Dark wrote `theme = "light"`/`"dark"` to the file,
   `config reloaded ... 0 diagnostics`, and both the Settings page and the
   panel flipped (screenshots 39, 40). The GTK header bar stays dark: it is
   GTK's CSD and follows the GTK theme, not `general.theme`. About renders;
   Ctrl+W closes. Two rule problems: the window has class `pal`, so the
   panel rule floated and pinned it at (600,216) with no border, and
   `settings after 300ms ... maximized=Ok(true)` while Hyprland shows it
   at 720x567 floating (567 = 520 + the 47 px header bar). Same fix as the
   HUD: key the panel rule on the title. Copy: "No hotkey: bind `pal
   toggle` in your compositor or desktop. From anywhere. Press the new
   combination ..." reads as a fragment. Driving note: `ydotool mousemove
   -a` did not land on this Hyprland; `hyprctl dispatch movecursor X Y`
   then `ydotool click 0xC0` did.
8. Tray: skipped (no bar on marko). `pal quit`: `quit requested`, `[host]
   stdin closed, exiting`, `host exit exit status: 0`, `host stopped
   21.1ms`, `quit flushed`; no `pal` or `pal-bun` left.

### Also seen

- First start with the temp profile logged `profile moved
  ~/.local/share/pal/frecency.json -> ~/.local/share/pal/default/frecency.json`:
  a non-default profile moved the default profile's file (a v2 file from
  an earlier run today, `{"version":1,"items":[{"extension":...`). Harmless
  here; check whether that move is meant to run for every profile.
- `~/.local/share/pal/storage/` (`quicklinks.json`, `snippets.json`,
  `blackjack.json`) and `clipboard.db` sit one level above the profile
  dir, so a test profile's quicklinks and snippets show up in every
  profile on the box. Deleted by hand this time.
- `permissions accessibility true` is logged on Linux.
- One iconnerd `clipboard` row rendered as tofu (a glyph outside the bundled
  PUA range, guess); the rest of the Nerd Font rows were fine.
- Scripts extension noise from marko's v1 plugins, not pal's: `[scripts]
  cannot run ~/.config/pal/plugins/ss/ss: ENOENT`, `ble/run.sh list killed
  after 30000 ms`.
- Screenshots of every step are in the Mac session's scratchpad
  (`01-root` to `42-settings-about`), not in the repo.

### Fix pass (marko, 2026-09-16, release build of the Mac tree with the fixes)

Same driving setup, `PAL_CONFIG=/tmp/pal-fix.toml`, profile `159cb53c`,
everything removed afterwards.

- Rules keyed on the title: panel `pal` at (580,216) 760x480 floating,
  pinned; HUD `pal HUD` at (720,1000) 480x72 (= `monitor_h-window_h-8`),
  the "Copied" capsule at the bottom; `pal Settings` tiled, floating and
  pinned false, no rule.
- HUD 480x200: GTK's floor for a non-resizable toplevel whose child
  requests nothing (bare GTK probe: a 480x72 `resize` with a WebKitWebView
  of minimum 0x0 in a GtkBox gives 480x200; with `set_size_request(480,
  72)` on the webview, or `resizable` plus min = max hints, 480x72).
  `panel/linux.rs::hud_size_request` does the former.
- `[files] backend: fd` logged once at load. `aishot` through the palette:
  1171 ms the first time, 133 and 147 ms right after; direct `fd` runs
  show the same shape (1267 ms then 110 to 190 ms), so the slow tail is
  the cold walk of about 130k entries under `~` (qmk_firmware 58k, proj
  38k, go 37k, work 25k), not the flags. `--max-depth 8` plus the excludes
  take a warm walk from about 160 to 115 ms.
- System indexed (13 items, relisted on show): `sleep` lists the System
  section first, `toggle mute` finds Toggle Mute first; a bare `mute` is
  led by the iconnerd rows named exactly `mute` (the exact bonus), with
  Toggle Mute further down.
- `clip` and `history`: the Clipboard History palette row first.
- Welcome row: "Show tips again" in Ctrl+K.
