# Polishing the palettes

A per-palette working list: what each one is *for*, what its rows look like
today, and the specific edits that would make them right. Written 2026-08-30
against the 37 palettes in `~/.config/pal/config.toml`, inspected on **hornet**
(macOS) — the platform matters, see [Dead on macOS](#dead-on-macos).

Sibling to [`future.md`](future.md), which lists palettes that don't exist yet.
This one is about the ones that do. ⚠️ `future.md` is stale: `calc`, `colors`,
`ip` and `clipboard` are listed as "planned" and all four shipped.

**Where a palette lives** decides where the edit goes:

| Base | Where | Palettes |
|---|---|---|
| `builtin/palettes/*` | `src/builtin/*.rs` — Rust, needs a release | combine, pals, apps, ffbookmarks, psg, ssh |
| `github:zcag/pal/...` | `plugins/palettes/*` in this repo — **push to main before the cache sees it** | 21 of them |
| `~/proj/pal/plugins/palettes/*` | same files, read locally | ha-states, ha-services, teams-chats |
| `~/.config/pal/plugins/*` | `dotty/common/.config/pal/plugins/` | mk, otp, pwatch, ss, tabs, today |
| `data = ...json` | a data file, no code | bookmarks, chars, colors, emoji, iconkde, iconnerd, power, mk |

---

## The house style

What separates a row you can read at a glance from a row you have to parse.
Every palette below is judged against these; `otp` is the worked example.

1. **`name` is the thing's identity and nothing else.** No packed strings. If
   you find yourself concatenating with `" - "` or `": "`, the parts after the
   first belong in `subtitle` or `accessories`. (`today` is the offender.)
2. **`subtitle` says what it is**, in a phrase — the category, the host, the
   path, the sender's kind. Not a repeat of the title.
3. **`accessories` carry state and time.** A coloured `tag` for the value you'd
   copy, `text` for a time or size. ⚠️ Use `text` with a pre-formatted value,
   not `date`: Raycast renders a `date` relatively but `src/builtin/fzf.rs`
   prints it raw, so an ISO string leaks into the terminal.
4. **Icons: `icon_rc` + `color` for Raycast, `icon`/`icon_utf` for the
   terminal.** A `url` field gets a favicon for free. A freedesktop name in
   `icon_xdg` is translated for both.
5. **`section` for buckets you'd actually think in** — time (Today/Yesterday),
   domain, host, project. Sections carry their item count now, so they earn
   their place.
6. **`keywords` for anything you'd type that isn't in the title** — the raw id,
   the shouty original, the digits, an alias.
7. **`live = true` when order comes from arrival**, or frecency will float a
   stale row to the top.
8. **`[[filter]]` when a list is long and has one natural axis.** > ~30 rows
   with an obvious split is the trigger.
9. **`[display] detail = true` for palettes you read** rather than scan.
10. **`detail` / `preview` for anything with a body** — a PR description, an
    entity's attributes, a command's `--help`.
11. **More than one verb per item.** `actions[]` with `shortcut` — open vs
    copy vs kill vs reveal. Most palettes offer exactly one and shouldn't.
12. **`id` stable and unique**, or frecency and the baked scripts both drift.

---

## Status

| | Palette | State on hornet |
|---|---|---|
| ✅ | apps, bookmarks, calc, chars, cmds, colors, combine, emoji, ha-services, ha-states, iconkde, iconnerd, ip, mk, otp, pals, psg, ssh, tabs, today | works, polish below |
| 🙈 | audio, ble, clipboard, docker, gl-reviews, kittysessions, media, power, pwatch, systemd, wifi, windows | **hidden** since 2026-08-30 — backend not on this machine |
| 🔑 | gh-reviews, op, repos | the binary is here, the account isn't |
| 🚫 | ffbookmarks | works, but cut by choice 2026-08-30 — commented out in `config.toml` |
| ⚰️ | ~~teams-chats~~ | deleted 2026-08-30 — dead since the NGSS offboarding |

That was 11 of 37 unable to work here and 6 more that didn't answer — **fewer
than half the palettes doing anything on the laptop they are used from**.
✅ Resolved 2026-08-30: each palette now declares `requires` (binaries, `|`
between alternatives) or `os` in its own `plugin.toml`, and drops out of `meta`,
`pals`, `combine` and the Raycast command list where that isn't met. 25 visible,
12 hidden, and `ffbookmarks` commented out by choice. They stay addressable by
name, so `pal list wifi` on a mac still explains itself; `pal meta --all` lists
everything with its reason.

📌 Gating and choosing are different things and shouldn't share a mechanism.
`requires`/`os` says *this can't run here*; not wanting a palette is a
`config.toml` edit. `ffbookmarks` is the second kind — it works fine now.

---

## Palettes that silently do nothing when you pick them

⛔ Found 2026-08-30, and it outranks every styling note below: **four of the
visible palettes accept a pick and then do nothing at all on this machine.**
They list fine, so nothing looks wrong.

| Palette | Pick does | Why it fails here |
|---|---|---|
| `calc` | copies the result | `wl-copy` → `xclip`, no `pbcopy` branch |
| `ip` | copies the address | same |
| `op` | copies the password | same |
| `gh-reviews` | opens the PR | bare `xdg-open` |

Verified: `pal pick calc` with `2+2*8` leaves the clipboard untouched.

📌 The cause is the same in all four: **they hand-roll what pal's own action
plugins already do.** `plugins/actions/copy` walks wl-copy → pbcopy → xclip and
returns `{"hud": "Copied …"}`; `plugins/actions/open` walks xdg-open → open and
returns `{"hud": …, "close": true}`. The palettes reimplement half of that and
get the Linux half.

⭐ It matters twice over in Raycast. A palette that shells out to `notify-send`
produces **nothing** in a Raycast window — six do. A palette that returns an
envelope gets a HUD, a toast, a closed window, a pushed detail view, for free.
So the rule is: **a pick returns an envelope; it does not perform desktop side
effects itself.**

Fix is one line each: `printf '%s' "$value" | pal action copy`, and let the
envelope through.

---

## Dead on macOS

These were written on Arch and never ported. They are hidden here now rather
than answering with an error row, and they still work untouched on marko and
archer off the same config. Hiding is not the end state though: the choice per
palette is still *port*, *replace* or *cut*. **A port needs no gate change** —
add the macOS binary to the same `requires` list and the palette comes back on
its own.

| Palette | Breaks on | macOS answer |
|---|---|---|
| `audio` | no pactl/wpctl | `SwitchAudioSource` (brew) — same list/switch shape |
| `ble` | `bluetoothctl` | `blueutil` — `blueutil --paired`, `--connect` |
| `clipboard` | cliphist/clipman | **Raycast owns the clipboard history on this box.** Cut it here rather than build a second one |
| `kittysessions` | `hyprctl`, `grep -P` | kitty's own `@ ls` over its socket; the WM half is yabai (`yabai -m query --windows`) |
| `media` | `playerctl` | `nowplaying-cli`, or MediaRemote via `osascript` |
| `power` | `loginctl`/`systemctl` | `pmset sleepnow`, `osascript` lock, `shutdown` — a data-file swap, no code |
| `pwatch` | `ps -o cmd`, `pts/` ttys | BSD `ps -o command`, ttys are `ttys00N` |
| `systemd` | `systemctl` | `launchctl list` + `bootout`/`kickstart` — worth having, it's how his agents are managed |
| `wifi` | `nmcli` | `networksetup -listpreferredwirelessnetworks` / `airport` |
| `windows` | no supported WM | **yabai is right there** and drives everything else on this desktop |

📌 The pattern worth building once rather than eleven times: a palette declares
which backends it can use and pal picks the first one present, instead of every
`run.sh` re-deriving "which OS am I" in bash. `audio`, `media`, `windows` and
`power` already each hand-roll a different version of that check.

⭐ `windows` and `power` are the two that would be used daily on this machine
and are pure loss right now.

---

## Needs credentials, not code

- **`gh-reviews`, `repos`** — `gh` is installed but not authenticated
  (`gh auth login`). Both palettes are fine; the row they print instead is
  raw stderr, which is the actual bug: they should return a proper error item
  with `icon_xdg: "dialog-error"` and a "Run gh auth login" action.
- **`gl-reviews`** — `glab` not installed. GitLab left with NGSS; probably a cut.
- **`op`** — 1Password CLI installed, no account configured. He uses the
  1Password *app* daily, so `op account add` is worth doing: a searchable
  vault in root search is a real win.
- **`docker`** — no docker on hornet. The containers he cares about are on
  archer and marko, so the honest version of this palette is remote:
  `docker -H ssh://marko ps`, with a `[[filter]]` per host.
- **`teams-chats`** — delete. The token path died with the NGSS offboarding.

📌 Every one of these prints raw stderr into the list when it fails. **A palette
should never let a tool's stderr become its rows.** Worth a shared
`plugins/actions/` helper or a convention: catch, and emit one error item.

---

## Per-palette polish

### otp ✅ done 2026-08-30
Sender table → name/kind/icon/colour/emoji, code as a green tag, compact time,
Today/Yesterday/Earlier sections, scope dropdown (All/Banking/Shopping/Official),
`live`. Reference implementation for everything below.

### today ⭐ worst offender, best payoff
`{"id":"Mon 08:00 - 09:00: Onboarding Cagdas","name":<same>,"url":""}`.
Everything is packed into one string, and the empty `url` means the palette's
`default_action = "open"` **does nothing on pick**.
- `name` = the event title alone. `subtitle` = organiser or calendar.
- `accessories` = `[{tag: "08:00–09:00"}]`, tinted red when it's running now.
- `section` = `Now` / `Next up` / `Later today` / `Tomorrow`.
- `id` = the event's own id, not the display string — it changes as the clock does.
- Fix `url`: HA's `all_events` doesn't carry one, so either drop the open
  action or map to the Google Calendar day link.
- `detail` = description + location + attendees; `[display] detail = true`,
  since this is a palette you read.
- `live = true` — it's ordered by time.

### tabs ⭐ one line, huge
`run.sh` builds `{id, title, url}` and then **throws the title away**:
`jq -cn '{id: $ENV.id, name: $ENV.url}'` — with the good version sitting right
above it, commented out.
- `name` = title, `subtitle` = url → favicon icon for free.
- `keywords` = the url, so host search still works.
- `accessories`: 🔊 for `bt query +audible`, a muted marker, and the tab index.
- `section` by window, once `bt` reports it.
- `actions[]`: focus (default), close (`bt close`), copy url, mute.
- `live = true` — tab order is arrival order.

### ha-states / ha-services ⛔ drill-down is broken outside a terminal
Both stage two by re-invoking `pal run` (`pick_entity() { _HA_ENTITY=$PAL_ID pal run; }`),
which spawns a *frontend*. In Raycast the pick returns empty and **nothing
happens** — verified: `pal pick ha-states` with an entity on stdin exits 0 with
no output.
- The envelope already has the right primitive: return `{"palette": …}` so the
  frontend pushes a view. Needs pal to allow a parameterised palette, or a
  second registered palette per stage.
- Rows: 800+ entities as `name` + `desc: "<state> — <domain>"`. Should be
  `subtitle` = the state, `accessories` = `[{tag: state, color: on?green:grey}, {text: last-changed}]`,
  `icon_rc` per domain (light → LightBulb, switch → Switch, sensor → Gauge,
  climate → Temperature, media_player → Music, person → Person).
- **`[[filter]]` by domain is the textbook case** — 800 rows, one obvious axis.
- `section` by area (HA knows areas; the palette doesn't ask).

### psg
`name` is a truncated absolute cmdline (`/opt/homebrew/Cellar/python@3.14/…`);
`comm` is right there in the item and ignored.
- `name` = `comm`, `subtitle` = the cmdline, `keywords` = both.
- `accessories` = `[{tag: cpu%}, {text: rss}]`, tag red over ~50%.
- `section` = `Mine` / `Root` / `Other` from `uid`.
- `actions[]`: kill (⌘⌫, `confirm`, destructive), SIGKILL, copy pid, reveal binary.
- Builtin — `src/builtin/psg.rs`.

### pals
Rows are `{icon, name}` and nothing else, in a palette whose entire job is
*choosing* a palette.
- `subtitle` = the palette's `desc` (it's in meta already).
- `accessories` = item count, and a tag for `input` / `live` / `grid`.
- `section` = a `group` field on the palette, so 37 entries stop being one wall.
- Same for `combine`, which inherits these rows.

### emoji · chars · iconnerd · iconkde · colors ⭐ these want to be grids
`view = "grid"` exists and **no palette sets it**. These five are exactly what
it was built for — `colors` items already carry `hex`, which the grid renders as
a real swatch. One line each in `config.toml`, plus the new `[display]` knobs:
- `colors`: `columns = 6`, `aspect = "3/2"` — swatches want to be wide.
- `emoji` / `chars` / `iconnerd`: `columns = 10`, `inset = "small"`.
- `iconkde`: stays a list — the *name* is the payload, not the glyph.
- All five: a Paste action now exists (⌘⇧V), which is what you actually want
  from a glyph picker.
- `chars` and `emoji` deserve `section` by group (faces / hands / symbols);
  the data files have the categories.

### cmds
`{"cmd": "...", "icon": "", "id": "px8", "name": "px8"}` — the name is a slug
and there's no telling what it does without reading the command.
- `subtitle` = a human sentence; `accessories` = `[{text: the command}]`.
- `section` by kind (audio / text / network / desktop).
- `detail` with the command in a code block, for the long ones.
- `keywords` = words from the command itself.
- Data file, so this is pure editing: `data/commands.bash.toml`.

### bookmarks
Good bones (url → favicon), but it uses the legacy `description` field where
the schema says `subtitle`, so nothing renders it.
- Rename to `subtitle`; keep `description` working if other palettes use it.
- `section` by kind (infra / personal / work).
- `actions[]`: open, copy url, open in a specific browser profile.

### ffbookmarks 🚫 fixed, then cut
The builtin always had a Chrome branch; it only knew the two *Linux* profile
paths, so it claimed "firefox profile not found" on a mac holding 312 Chrome
bookmarks. Fixed: macOS locations added, the browser auto-detected when
unconfigured, and the 19 icon-only bookmarks-bar entries that carry no name now
fall back to their host instead of rendering as blank rows.
**Cut 2026-08-30**: 312 flat rows next to the twenty curated `bookmarks` entries
was noise, and those twenty are the ones actually reached for. Commented out in
`config.toml` rather than gated — it works, it just isn't wanted. The builtin
fix stands for whoever uncomments it.

If it ever comes back: `subtitle`/`section` = the containing folder, which the
extractor discards, and **rename it** — nothing about it is Firefox any more.

### op ⭐ the one with the most upside
Blocked on `op account add`, but the design is clear from `run.sh`: rows are
`name` = title, `desc` = the username, an icon per category.
- `subtitle` = username; `accessories` = `[{tag: category}, {text: vault}]`.
- **`[[filter]]` per vault** — the obvious axis, and it's already a config option
  (`vault = …`) that currently hard-limits the palette instead of scoping it.
- `section` by category (Logins / Cards / Notes / SSH keys).
- `keywords` = the item's website hosts, so "github" finds the GitHub login.
- **`actions[]` is where this palette lives**: copy password (default), copy
  username, **copy TOTP** (⌘T — the reason to have this at all), open in the
  1Password app, reveal in browser. Right now it offers one verb.
- ⛔ Its pick is one of the four no-ops above.

### repos
`name` = `owner/repo`, `desc` = description, folder icon by visibility.
- `name` = the repo name alone, `subtitle` = description, `section` = owner
  (the `orgs` config already knows them), so `zcag/` stops being a prefix
  repeated 100 times.
- `accessories` = `[{tag: "private", color: orange}, {text: language}, {text: pushed}]`
  — `gh repo list` returns all three, the plugin asks for none of them.
- `[[filter]]` per org, once there's more than one.
- `actions[]`: open on GitHub, **open the local clone if `~/proj/<name>` exists**,
  clone it if it doesn't, copy the URL, open in the editor.
- `keywords` = `owner/repo`, so the old search still works.

### combine
The default palette, so it's the first thing seen — and it's `pals` + `bookmarks`
+ `cmds` glued together with a section per source.
- Section order follows `include`; put the palettes he opens most first rather
  than alphabetically.
- `[[filter]]` by source once it includes more than three.
- Everything it shows is inherited, so it improves for free as the sources do —
  which is the argument for fixing `pals` early.

### apps
Already right — `fileIcon` from the .app path is the correct icon and it works.
- Add `subtitle` = the folder (`/Applications` vs `/System/Applications`), so
  Apple's built-ins are visually separable.
- `keywords` from the bundle id, for `com.apple.…` searches.

### ssh
`{icon: "network-server", id/name: host}` and nothing else.
- `subtitle` = `user@hostname` from the ssh config (the builtin parses it already).
- `accessories` = a green/grey dot for reachability — but only if it can be
  done without a per-row probe (a cached ping table, refreshed on `reload`).
- `section` = `Host` blocks by their config file.
- `actions[]`: connect, copy `ssh <host>`, open sftp, `code --remote`.

### mk
`{cmd, id, name}` — no context about which project a target belongs to.
- `subtitle` = the project directory; `section` = the project.
- `detail`/`preview` = the recipe body.

### ip
Fine and small. `detail` with the full picture (interface, gateway, DNS, MAC,
public IP + geo) would make it a genuinely useful one-stop, and it's a palette
you read → `[display] detail = true`.

### calc
Input palette, `live`, works. `detail` showing unit conversions and the
alternate bases of the result is the obvious next step — qalc already prints
them.

### gh-reviews (once authenticated)
Worth designing properly rather than fixing minimally: `name` = PR title,
`subtitle` = `repo#123 · author`, `accessories` = review state tag + age,
`section` by repo, `detail` = the PR body, `[[filter]]` = needs-review /
mine / all, `actions[]` = open, copy url, checkout.

---

## What each palette needs

One row per visible palette: what the target row is, and which Raycast
capability it takes to get there. ✅ done · ● planned above · — not applicable.

| Palette | The row it should be | sub | accs | sect | filter | detail | grid | actions |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| otp | `Akbank · Bank · [8885] · 12.42` | ✅ | ✅ | ✅ | ✅ | — | — | ● |
| today | title · time tag · Now/Next/Later | ● | ● | ● | — | ● | — | ● |
| tabs | page title · host · 🔊 | ● | ● | ● | — | — | — | ● |
| ha-states | friendly name · state tag · area | ● | ● | ● | ● | ● | — | ● |
| ha-services | service · its description | ● | ● | ● | ● | ● | — | ● |
| psg | `comm` · cmdline · cpu/rss | ● | ● | ● | — | — | — | ● |
| pals | name · desc · item count | ● | ● | ● | — | — | — | — |
| op | title · username · vault | ● | ● | ● | ● | — | — | ● |
| repos | repo · description · lang/pushed | ● | ● | ● | ● | ● | — | ● |
| gh-reviews | PR title · repo#n · author | ● | ● | ● | ● | ● | — | ● |
| cmds | human sentence · the command | ● | ● | ● | — | ● | — | ● |
| bookmarks | name · folder | ● | — | ● | — | — | — | ● |
| apps | app · which folder | ● | — | — | — | — | — | ● |
| ssh | host · `user@hostname` | ● | ● | ● | — | — | — | ● |
| mk | target · project | ● | — | ● | — | ● | — | — |
| ip | label · value | — | ● | — | — | ● | — | ● |
| calc | result · the expression | ● | — | — | — | ● | — | ● |
| colors | swatch tiles | — | ● | — | — | — | ● | ● |
| emoji | glyph tiles | — | — | ● | — | — | ● | ● |
| chars | glyph tiles | — | — | ● | — | — | ● | ● |
| iconnerd | glyph tiles | — | — | ● | — | — | ● | ● |
| iconkde | name · the icon | — | — | ● | — | — | — | ● |
| combine | inherits its sources | — | — | ● | ● | — | — | — |

**Every palette wants `actions[]`**, and exactly one has more than one verb
today. **Six want `[[filter]]`.** **Four want the grid.** Nothing needs `mask`;
`tooltip` is a per-item detail, not a palette decision.

---

## Order of work

1. **The four silent picks** — `calc`, `ip`, `op`, `gh-reviews`. Broken, not
   unpolished, and it's one line each.
2. **`tabs`** — uncomment the line that keeps the title. Minutes, used daily.
3. **`today`** — unpack the string, fix the dead `url`. Used daily.
4. **`pals`** — subtitle + count, which `combine` inherits, so the default
   palette improves without touching it.
5. **`actions[]` across the board** — the capability nothing uses. Start where
   a second verb is obvious: `psg` kill, `repos` open-local, `op` copy-TOTP,
   `tabs` close.
6. **The grid five** — one config line each, then tune `[display]`.
7. **`ha-states`** — the drill-down needs a real mechanism first; biggest job.
8. **Ports** — `windows` on yabai, `power` on pmset, `pwatch` on BSD ps.

---

## Cross-cutting, do these first

1. **A palette must never print raw stderr as rows.** Six do. One shared
   convention — catch, emit one item with `icon_xdg: "dialog-error"` and an
   action that fixes it (`gh auth login`, `brew install blueutil`).
   ✅ `dialog-error` now maps to a red `XMarkCircle`; it used to fall through
   to a grey dot, so every failure row looked like a normal one.
2. **Backend selection belongs in pal, not in eleven `run.sh` files.** Declare
   candidate backends, pal picks the first present.
3. **Two-stage palettes need a real mechanism.** `pal run` from inside a pick
   only works in a terminal. `{"palette": …}` is most of the answer.
4. **Audit `desc` vs `subtitle`.** Several palettes set `desc`; fzf falls back
   to it but the schema and Raycast want `subtitle`.
5. **`view = "grid"` is dormant.** Five palettes want it.
6. **Nothing uses `actions[]`.** Every palette offers exactly one verb. This is
   the single biggest unused capability across the whole set — bigger than any
   rendering gap, because it changes what the palettes can *do*.
