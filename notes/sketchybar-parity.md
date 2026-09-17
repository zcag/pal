# CAGDAS COMMENTS START
* upcoming. should be part of the today / calendar whatever extension probably. with bunch of customizations around urgency cutoff, size color etc, time cutoff and so on
* lirik. we have this already in spotify ext., but sometimes its not as real time as the lirik, not sure why, after thats fixed this can be considered done.
  * (claude, 10:10) why: `lirik --watch` reads the Spotify Web API and pushes every lyric line into `sketchybar --trigger lyric_line` as it plays (`plugins/lirik-stream.sh`), and the track comes from Spotify's `spotify_change` notification; no polling. pal's item re-renders on its `every` and on the MediaRemote stream (track changes only), so the line lags up to one interval. Fix: the extension runs its own synced-lyrics ticker (lrclib timestamps against `progress_ms`, resynced on each poll or MediaRemote event) and pushes each line with `bar.update`.
* mail. this can be part of the mail extension, popover should show unreads and have easy way of marking them as read or open in browser etc
* battery, we can have a battery/power usage extension, thatll show bunch of data about the battery draw, biggest culprits etc. and a bar item with tons of options on when to hide/show usage and/or the battery itself, so i can have a similar thing
* bt-battery, lets do this as a nice polished extension, and accompanying bar item
* volume. lets handle this as a bar item of the existing audio source extension. we can have the mic bar item as volume's bar item as well as extra.
* network, we have an ext already, we can use the same data to constuct the nice bar item as well. we can have a way of users adding a mapping to they can mark their ssid's
* weather. lets add a nice ext for weather and super polished one. also goes for its bar item.
* cldd, lets leave this last, if theres a way to cleanly implement this as an extension without any of the claude specific things i did as a hack, we can create the ext, othwerwise lets discuss
* prs, this should be an additional bar item of the github ext. current func. is nice so you can check its deisng etc to get ideas, popover should show the prs nicely
* issues, same as prs, extra bar item of github ext.
* timer. we have this already i think

* tan/stan lets not do rn. maybe later
* also clock and media_use. these will be as-is in sketchybar for now outside of any pal thing.
* also lets leave out any auto them hide/show work etc out as well for now.
# CAGDAS COMMENTS END

## Current build handoff (2026-09-17)

This is the active scope; the inventory and larger plan below remain useful research,
but do not revive rows that conflict with it.

### Landed — `cde7c26`

- **B1 direct action:** a bar item can declare `click: "open"`. Calendar uses it to
  join the current meeting when it has a conference URL, otherwise open Calendar;
  hover still opens its popover.
- **Settings mock states:** an extension may expose stable named `bar.<item>.mocks`
  scenarios. Settings shows a `Preview state` selector and renders the selected item
  only in its configuration strip — never in the real bar and never by mutating
  configuration. Spotify, Calendar, Timer, Audio, Network and GitHub provide useful initial scenarios.
- **Spotify lyrics:** timestamped LRC lines now tick at lyric boundaries while playing,
  including when the bar is closed; polling/MediaRemote resynchronises the ticker.
- **Calendar Upcoming:** has far/near/warning/critical/running presentation states,
  configurable colours, sizing and placement, plus sensible mocks.
- **B2 runtime appearance:** an item can dynamically supply a background, separate
  icon/label sizes, icon width and sketchybar position. Menu bar uses the separate
  sizes where it can; background, icon width and placement are sketchybar-only.
- **GitHub Pull requests and Issues:** now two independent items using their existing
  cached palette queries. PRs show red attention, amber active, green ready and muted
  waiting counts; Issues distinguish assigned, mentioned and authored. Each hides at
  zero, has Settings mock states, and opens its existing palette on click. No brackets,
  separators, combined GitHub item or parallel data path.
- **Weather, Power and Bluetooth Battery:** Weather is a standalone Open-Meteo surface
  with a configured place, condition-led glyphs, comfort thresholds and current
  conditions popover; Power reads the OS gauge and enriches it from the existing fresh
  `power` watcher state; Bluetooth extends the existing device source with an
  interruption-only low-battery alert. All three have useful Settings mocks and their
  own palettes/popovers rather than becoming a generic status cluster.

### Landed — live polish pass

Ran against the real bar on hornet, which is where all three defects showed up;
none of them were visible in the Settings previews, because a preview renders the
mock rather than the extension.

- **Weather was dead on his bar, showing a red `󰖪 Weather`.** Open-Meteo's geocoder
  takes one bare place name, so the configured `Istanbul, Turkey` — the manifest's
  own placeholder — matched nothing. The first comma-separated segment is now the
  query and the rest only *rank* the answers: the index stores endonyms
  (`Republic of Türkiye`) that a written exonym (`Turkey`) never equals, so a hard
  filter would turn a good answer into no answer. Unmatched qualifiers fall through
  to population, which is what a bare `Istanbul` should resolve to anyway. This also
  buys `London, Ontario` and `Paris, Texas`. The old test could not catch it: its
  fake geocoder answered every query, so it now matches on the name like the real one.
- **Power drew the level twice.** `progress` makes the sketchybar renderer prefix an
  8-cell rule to the icon (`sketchybar.rs:122`), so a 23% battery read
  `━━────── 󰁺 23%` — the timer's signature look, spent saying what the label already
  said. The rule is gone and the glyph now carries the level as his 6-step ramp does
  (`battery.sh:161-169`); severity stays the colour's job, so an alert at 80% still
  reads as "battery fine, something else is wrong".
- **Power never said how long.** The title is now `16% · 1:04 · 9.5W`, in his order
  and never four fields wide: the ETA appears five points *above* the amber
  threshold so the number that explains the colour is already on screen when the
  colour arrives, and it takes the slot the culprit would have had, since at 15% the
  question is how long, not who. A recalculating pmset `0:00` now defers to the
  watcher's estimate instead of displacing it (his `battery.sh:225-239` warning).
- **Bluetooth Battery** moved to his numbers: alert at 25%, red at 20%.

Two of his workarounds were deliberately *not* copied, because pal does not have the
limitation they answer. His `󰋋 󰁺` glyph pair cannot be used: `icon_kind`
(`bar/mod.rs:222-236`) classifies any multi-character icon as `Text`, which the menu
bar draws as status-item text in the system font (`menubar.rs:114`) — tofu for two
private-use glyphs — and `target` defaults to `auto`, so the menu bar is a real
target. The pair is unnecessary anyway: pal's item leads with the device name, so it
never needs a glyph to say which battery it is. Likewise his `''|0` guard exists
because a shell cannot tell an empty read from a zero; `battery` is `Option<u8>` in
`core/src/bluetooth.rs:29`, so `null` already means unknown and hiding a 0 would hide
a dying device.

### Next, in order

1. **Nothing queued on Weather, Power or Bluetooth.** Network is now at parity too
   (`icon_only`, `networks` with `hide`/`hotspot`/`public`, the signal ramp). What
   is left across the bar: Network's compact kv popover in place of the full
   palette, and Audio's volume-level flash (E9).

### Explicitly deferred

- No automatic theme switching, work-hours visibility, native power/audio event
  sources, tan/stan, cldd, or `clock`/`media_use` work in this pass.
- Do not add grouped-item brackets or separators. A future GitHub PR/issue surface is
  independent semantic bar items, not a cluster.



# sketchybar parity: what pal's bar needs to match his bar

2026-09-17. Asked: "check all my existing sketchybar items and functionalities
and looks, and map out what's needed to be done to have at least that" in
pal's bar items. This is the map, not the build.

Sources read: the live config `~/dotty/sketchybar/.config/sketchybar/`
(stowed to `~/.config/sketchybar`: `sketchybarrc`, `lib.sh`, `colors.sh`,
`theme.sh`, `plugins/*.sh`, `helpers/*`; `~/dotty/macos/.config/sketchybar/`
is the pre-August config and is not what runs), `~/dotty/sketchybar/PICKS.md`,
`~/Sync/vault/setup/bar.md`, `~/dotty/macos/power/README.md`; the live bar
over `sketchybar --query` on hornet at 09:39; pal's `docs/design/bar.md`,
`docs/config.md` `[bar]`, `docs/extensions.md` "Bar items",
`app/src-tauri/src/bar/{sketchybar,colors,mod,popover}.rs`, the eleven `bar`
blocks in `extensions/*/pal.json` and their `index.ts`, `notes/decisions.md`
(the two 2026-09-17 bar sections). `file:line` below is relative to
`~/.config/sketchybar/` for his side and the repo for pal's.

**Counts.** 22 items of his: have 1, partial 6, missing 11, not-for-pal 4.
Everything he has is expressible in pal's model except the eight things in
section 3, and five of those are small.

## 1. Inventory: his items

Shared behaviour, so the table does not repeat it. Every plugin sources
`lib.sh`: `cache_fetch` serves the last value and marks the item stale (dims
icon and label to `DIMMER`, `lib.sh:122`) when a source fails;
`hover_guard` tints the item `SURFACE` with `--animate sin 8` on
`mouse.entered` (`lib.sh:165`) and opens the item's popup (every popup is
sketchybar rows: `popup_row` two-column list rows with a hover fill and a
`click_script`, `popup_kv`, `popup_head`, `popup_action`, `lib.sh:384-470`);
`work_item` hides the item and exits unless `dek -q state working is on`
(`lib.sh:30-31`); `updates=on` everywhere so a hidden item keeps ticking and
can come back (`sketchybarrc:21-24`). The bar's defaults: icon `FiraCode Nerd
Font` 15, label `.SF NS` 14, padding icon 8/4 label 4/8, popups `BASE` with a
1 px `SURFACE` border, radius 6 (`sketchybarrc:59-74`). Positions: `left`,
`q` (against the notch's left edge), `e` (its right edge), `right`; the right
region fills right to left in add order.

| item | pos | shows | source | interaction | cadence | notable looks | live now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| session | left (first) | `` + `name` or `name 2/3` (session + tab position) only while kitty is focused; hidden for a one-tab `tt` (`session.sh:47-57`) | `kitty @ ls` over `/tmp/mykitty-*`, front app from yabai | none (hover tint only) | event: `front_app_switched`, `session_change` pushed by a kitty watcher | icon `SUB`, `max_chars` 28 | present, hidden (kitty not front) |
| upcoming | left, moves to `q` inside 15 min | no icon; HA `calendar_summary` verbatim (`Standup in 0:12`), fallback `Title · in 3 days` under 10 h (`upcoming.sh:121-127`) | HA `calendar_summary` / `merged_event_0..7`; join links from `helpers/meetings` (Google Calendar via archer's broker, both audiences) | click joins the next call's URL else opens Calendar (`upcoming.sh:51-55`); popup: next 8 events, row click joins, Open Calendar | 60 s | 10 pt `DIM` far off, `SUB` under 60 min, `YELLOW` + `q` under 15, `RED` + 14 pt under 5 (`upcoming.sh:152-155`), `--animate sin 10` | present, hidden |
| lirik | q | `󰎇` + the synced lyric line (44 chars), else `Artist - Track` (`lirik.sh:19,33`) | `lirik --watch` streamed by `lirik-stream.sh` into `--trigger lyric_line`; `spotify_change` (NSDistributedNotification) | click play/pause, scroll next/prev (`lirik.sh:37-39`); popup: track, artist, album, position, Open Spotify | event-driven | icon `DIMMER`, label `DIM` 10 pt, `max_chars` 46 | present, hidden (nothing playing) |
| wmail | e (first) | `󰇰` + unread count of the SerpApi inbox | n8n `ds-gmail-unread?acct=work` (count, ttl 25) and `ds-gmail-messages` (list, warmed on the tick) | click focuses the Gmail tab (`bt activate`) else opens it; popup: 8 subjects with sender, left click opens the message, right click marks read in place (`gmail-read`), `+N more`, Open Gmail | 30 s | **dark off the clock** (`mail.sh:33`); hidden at 0 | present, hidden (0) |
| stan | e | `󱒕` + count of items needing him at work; `RED` when any is `now` | `http://marko:8803/state.json` (ttl 100) | click opens stan.lan; popup: a section per bucket, `id` (semibold, coloured by urgency) + title, row click opens the item's first link, quiet-bucket counts, Open stan | 120 s | **dark off the clock** (`tan.sh:37-38`); hidden at 0 | present, drawn: `7`, red |
| slack | e | `󰒱` + `dm + mention + thread`; `RED` when `dm + mention > 0` (`slack.sh:146-147`) | `helpers/slack-unreads` (Slack web API with the desktop client's xoxc token + `d` cookie), ttl 25 | click opens Slack; popup: DMs / Mentions / Threads with text, where and (on hover) age, row click deep-links `slack://`, `ALSO UNREAD · #a #b`, Open Slack | 30 s | **dark off the clock** (`slack.sh:19`); hidden at 0 | present, drawn: `1`, red |
| clock | right (rightmost) | `Thu Sep 17 09:39` (`clock.sh:29`), no icon | `date` | click opens Calendar.app; popup: `cal` month grid in the mono font, Open Calendar | 10 s | | present, drawn |
| battery | right | 5-step ramp glyph or `󰂄` charging + `98%`, plus ` · H:MM` under 25 % draining, plus ` · 18.9W · <rule or culprit>` when `power` says so (`battery.sh:162-272`) | `pmset -g batt`; `~/.local/share/power/state.json` (the `power` LaunchAgent, 30 s; stale past 120 s); `system_profiler SPPowerDataType` for the popup | click opens Battery Settings; popup: POWER kv (draw, level, source, remaining), BREAKDOWN, EATING IT NOW (per-process share), LAST 24H, HOLDING IT AWAKE, HEALTH, OVER WHAT IT NEEDS, Battery Settings | 120 s, plus `power_update` pushed by the watcher, `power_source_change`, `system_woke` | hidden when draining above 50 % or charging above 20 % unless `loud` (`battery.sh:302-310`); `YELLOW` at 20 %, `RED` at 10 %, `ORANGE`/`RED` for a `power` warn/crit **on battery only**; `--animate sin 12` | present, drawn: `98% · 18.9W · churn` |
| bt_battery | right | `󰋋 󰁺` + `NN%` of the connected headphones, only at 1..25 % (`bt_battery.sh:23-26`) | `helpers/btbattery.swift` (IOBluetoothDevice battery keys) | none | 120 s | `YELLOW`, `RED` at 20 % | present, hidden |
| volume | right | route/level glyph only (`󰕿 󰖀 󰕾`, `󰋋` headphones, `󰓃` external, `󰝟` muted at `DIM`); `NN%` label flashes for 3 s after a change (`volume.sh:29-37,98-139`) | `osascript get volume settings`; `SwitchAudioSource -c`; device kind via `system_profiler` (cached) | click mutes, scroll ±5 (`volume.sh:40-43,79-84`); popup: `OUTPUT · 38%`, one row per output device (aside `current`, BT battery %), row click switches output and system device, Sound Settings | event: `volume_change` | icon 18 pt (optical), `icon.width=31` pinned so the arcs do not shove the clock (`sketchybarrc:253-262`); `--animate sin 10` | present, drawn |
| media_use | right | `󰄀 󰍬 󰹑 󰆍` (camera, mic, screen share, asciinema) on an **orange band** (`media_use.sh:19-43`) | `pmset -g assertions` (`BWFigCaptureDevice`, `com.apple.audio.*` with `audio-in` and not `AudioTap-*`), `pgrep screensharingd`, `pgrep asciinema` | none | 2 s | `background.color=$ORANGE`, height 22, square; "the one item allowed to shout" | present, hidden |
| mic | right | `󰍭` muted or `󰍾` no input device, `RED`, icon only (`mic.sh:16-21`) | `osascript input volume` | click sets input to 75 | 10 s | hidden when input is fine | present, hidden |
| network | right | icon only: `󰤭` `RED` no route; hotspot ``, public `󰅶`, RSSI ramp `󰤨 󰤥 󰤢 󰤟`, wired `󰈀` (`network.sh:64-95`) | `route -n get default`, SSID via `sudo -n plutil` on the DHCP lease (sudoers rule), RSSI via `helpers/wifi.swift` (CoreWLAN) | click opens Network Settings; popup: interface, ip, gateway, signal, network, Network Settings | 5 s, `wifi_change`, `system_woke` | **hidden at home** (SSID `eldiven` or gw `192.168.1.1`, `network.sh:33-34`) | present, hidden |
| weather | right | condition glyph (`󰖙 󰖔 󰖕 󰖐 󰖗 󰖖 󰖘 󰖑 󰖝 󰖓`) coloured by kind + `19°` (`weather.sh:45-68`) | Home Assistant via `ha` CLI: `outdoor_temperature` (ttl 600), `weather.forecast_home` condition, feels-like, humidity, wind (ttl 900) | click nothing; popup: NOW (or the stale note), condition, feels like, humidity, wind | 600 s | hidden unless notable: precipitation / storm / fog / wind or temp outside 10..30 (`weather.sh:61-66`) | present, drawn: `󰖗 19°` |
| mail | right | `󰇮` + unread count of the personal inbox | n8n `ds-gmail-unread` / `ds-gmail-messages` (same plugin as wmail, keyed on `$NAME`) | as wmail (Gmail `u/0`) | 30 s | hidden at 0; never work-gated (`mail.sh:31-33`) | present, drawn: `26` |
| tan | right | `󰛨` + count of open items; `RED` when any is `now` (`tan.sh:160-164`) | `http://marko:8793/state.json` (ttl 100) | as stan, against tan.lan | 120 s | hidden at 0 | present, drawn: `4` |
| cldd + cldd_run | right, one bracket | `󰆍` + **your turn** count in `YELLOW`, then the **working** count in `BLUE` as a second item (`cldd.sh:22-25,124-136`) | local `claude-state ls`; remote `ssh marko cldd ls` (ttl 100, 2 s on hover); `cldd-stream.sh` holds `ssh marko inotifywait` open and fires `cldd_change` | click copies `ssh -t marko` to the clipboard, opens nothing; popup: HORNET (row click focuses the kitty window, `cldd-focus`) and MARKO (row click copies the attach line, `cldd-copy`) sections, `state · dir · up 2h`, Shell on marko | 120 s + push | two items because an item has two colourable fields; the bracket is the hover surface | present, drawn: `2` `1` |
| prs | right, seven items in a bracket | `󰘬` (`DIMMER`) then `󰅙 2` `RED` blocked, `󰗠 1` `GREEN` ready, `󰦗 1` `YELLOW` running, `󰄰 3` `DIM` waiting, `│`, `󰇧 7` OSS (`DIM`; glyph `RED` when a drive-by is his move) (`prs.sh:65-73,151-171`) | `helpers/gh-prs`: one GraphQL query over `viewer.pullRequests`, classified block / run / ready / wait / draft with `canmerge` (`viewerPermission`), `latestReviews`, `statusCheckRollup`, `mergeStateStatus`; OSS lane = repos he cannot merge, watermark `OSS_SINCE=2026-09-08`; landed within 14 d (`gh-prs:122-162,281-313`) | click opens github.com/pulls; popup built on the tick: sections BLOCKED / READY TO MERGE / CHECKS RUNNING / IN REVIEW / OUT THERE / DRAFTS / LANDED, `repo #N title` + `why · age`, row click opens the PR, Open GitHub · checked 3 m ago | 60 s while a check runs else 300 (`prs.sh:194-203`); `system_woke` | **the one item drawn whenever a PR is open** (`prs.sh:43-49`); serpapi rows dropped off the clock (`prs.sh:118-122`); segments hide at 0; fixed order; lane rule 11 pt | present, drawn: `2 1 1` |
| issues | right, three items in a bracket | `󰌸` (`DIMMER`) then `󰃩 1` `RED` unread threads about him, then a bare `6` assigned (`issues.sh:41-50,92-98`) | `helpers/gh-issues`: unread notifications of subject type Issue minus reasons `subscribed ci_activity`, author-watermarked; `assignee:@me is:open` search, partitioned (`gh-issues:45-135`) | click opens github.com/notifications; popup: NEW (`who · reason · age`) and ASSIGNED (`label · age`), row click opens **and marks the thread read** (`issue-open` → `issue-read` PATCH + `--trigger issues_change`), Open GitHub | 180 s; `issues_change`; `system_woke` | hidden at 0 (a real zero, unlike prs); serpapi rows dropped off the clock | present, drawn: `6` |
| timer | right (leftmost of the cluster) | 8-cell rule `━━━───` as the icon (11 pt) + `04:59  tea  +1`; paused `mm:ss  name  paused`; done `name done` on a `URGENT_BG` band (`timer.sh:57-64,145-170`) | `timer _bar` / `timer _list` (`~/.local/bin/timer`, one file per timer in `~/.local/share/timer/`) | click dismisses a done timer, else nothing; popup: TIMERS rows (`name`, `left` / `paused · left` / `done · 3m ago`), +5 min, Dismiss, Stop all | 1 s, `timer_change` pushed by the CLI | icon `ACTIVE`, `PEACH` under 60 s, `RED` under 10 s; paused `DIMMER`/`DIM`; done `GREEN` on `URGENT_BG` | present, hidden |
| theme_watch | (invisible) | nothing | `AppleInterfaceThemeChangedNotification` | on a flip: writes the mode file, drops popup signatures, repaints bar colour and every `[a-z_]*` item's colours in the other palette twice (1.5 s apart), then `theme apply` (`theme_watch.sh:45-93`) | event | Frappe dark / Rosé Pine Dawn light (`colors.sh`) | present |
| raycast | right | an alias of a Raycast menu bar command | `sketchybar --query default_menu_items` | click AXPresses the real item by x position | | **off since 2026-08-27**: an alias screen-captures, which keeps the purple recording dot lit (`sketchybarrc:483-488`) | absent (empty list) |

Mechanisms that are not items but shape the look: brackets `cldd_group`,
`prs_group`, `issues_group` (a resting `SURFACE_SOFT` band came off
2026-09-08; now they exist to be one hover surface, `lib.sh:145-163`); band
rules `sep_prs`, `sep_issues` (`│` 15 pt `DIMMER`, lit only between two
**drawn** groups, `band_seps_sync`, `lib.sh:587-612`); `row_hover.sh` (popup
row fill and the hover-aside swap); `lirik-stream.sh` and `cldd-stream.sh`
(long-lived processes pushing `--trigger` events).

## 2. Mapping: his item to pal's

pal today draws 11 items (`pal bar list`, 09:41): calendar/upcoming,
github/notifications, gmail/unread, gmail@work/unread, hue/home,
media/now-playing, otp/latest-code, slack/unreads, spotify/playing,
tela/inbox, timer/timer, whatsapp/unread. All on `left` except spotify at `q`
(`~/.config/pal/config.toml:45-50`); none of his is on `left`. A pal popover
opens on click only (`open_on_hover = false`, `docs/config.md:210`).

`have` = the data and the interaction are there, what differs is config or
by design; `partial` = the item exists, a behaviour needs code; `missing` =
no pal item; `not-for-pal` = leave it to sketchybar.

| his | status | pal | what is missing, precisely |
| --- | --- | --- | --- |
| mail | **have** | `gmail/unread` (`extensions/gmail/index.ts:333-362`: `󰇮`, badge = inbox unread, hidden at 0, popover: newest five with Open / Mark as read, Open in pal, Open Gmail) | Looks only: the count is a separate red `.badge` item, his is the label in `TEXT` (section 5); click opens the popover, his focuses the Gmail tab (Open Gmail is one keystroke in). Data source differs (Gmail API through archer's broker instead of n8n), same numbers. |
| wmail | partial | `gmail@work/unread` (instance, `title = "Work"` drawn as the label, `index.ts:337`) | **No work-hours gating** (gap G1). The label reads `Work` + badge, his is `󰇰 1`: `show_title = false` on the item drops the word. |
| slack | partial | `slack/unreads` (`index.ts:355-368`: `󰒱`, badge = dm + mention + thread, `urgent` while a DM waits, hidden at 0, popover with reply / mark read / open) | **No work-hours gating** (G1). Red rule differs: his goes red on `dm + mention`, pal on DM only (`dm_urgent`); add a `mention` case to the setting (S). Count is a `.badge` item, not the label. |
| timer | partial | `timer/timer` (`index.ts:239-249`: `󰕕` + `12:34`, `progress` rule, blue / amber / red by fraction, `muted` paused, `urgent` done; 1 Hz `bar.update` from `fs.watch` on `~/.local/share/timer/`, so `timer_change` is covered) | Done state has no **background band** (G2: `URGENT_BG`); a click on a done timer opens the popover instead of dismissing (G4); the label has no name / `+N` (`04:59  tea  +1`), a `bar_name` setting (S); colour is by elapsed fraction, his by seconds left (60 s / 10 s), a setting or the same rule (S); the rule is drawn at the icon size, his at 11 pt (G3). |
| upcoming | partial | `calendar/upcoming` (`today.ts:86-130`: `󰃭` + `Standup in 12m` / `now`, muted / amber under 15 / red under 5 / green running, dot when there is a call, hidden past 10 h, popover with Join) | **No position move** to `q` inside 15 min (G5); **no size step** 10 pt → 14 pt (G3); no icon-less form (`show_icon = false` on the item does it, config); a bare click joins the call in his, opens the popover in pal (G4, `j` joins inside). Data is EventKit / Google API rather than HA, which is a gain: the join link comes with the event instead of a second fetch over ssh. |
| lirik | partial | `spotify/playing` with `bar_lyrics` (`index.ts:326-335`: the synced lyric line from lrclib, else `track · artist`, `refresh` timed to the next line, hidden when not playing) | No **scroll** for next / prev (G6); click play / pause needs G4 (`space` in the popover does it); dim look (icon `DIMMER`, label `DIM` 10 pt) is `color = "muted"` + `size = 10` on the item in config, once G3 lets the size differ from the glyph's. |
| issues | partial | `github/notifications` (`index.ts:598-608`: `󰊤` + badge = every unread thread, popover by repo with mark-read) | Different filter: his counts **Issue** threads only, minus `subscribed` / `ci_activity`, author-watermarked (`gh-issues:22-53`), plus a second bare **assigned** count; pal counts every thread. Needs a `github/issues` item (or settings on notifications: subject types, skipped reasons, an assigned segment) (M); the `@` glyph in red for new; serpapi rows dropped off the clock (G1). Row click marks read and opens: pal has it (Enter). |
| prs | **missing** | none; the `prs` palette has per-row tags (`index.ts:78-92`) but no classification and `data.ts` fetches no `viewerPermission`, `latestReviews`, `reviewThreads`, `mergeStateStatus` | A `github/prs` bar item: `icon 󰘬 muted`, `segments` block red / ready green / run amber / wait muted / `│` / oss, `hidden` only when nothing is open, `refresh: 60` while a check runs, `stale`, the OSS watermark setting, off-clock filter (G1), popover = the sections. The design doc's migration row (`docs/design/bar.md:533`) already specifies it. (L) |
| tan, stan | **missing** | none (no extension reads `marko:8793` / `:8803`) | A `tan` extension, `multi` like gmail (instances `tan` → 8793, `tan@work` → 8803): count of items outside `know parked wait`, red when one is `now`, popover a section per bucket with the `id` leading, row click opens `links[0]`, quiet counts, Open tan; `stan` work-gated (G1). Also a natural palette. (M) |
| cldd + cldd_run | **missing** | none | A `claude` (sessions) extension: `segments` [`yours` amber, `working` blue], hidden at 0; local `claude-state ls`, remote `ssh marko cldd ls` with the short ttl on `show`; the inotify stream owned by the extension with `bar.update`; `claude-state`'s hook calls `pal bar render claude/sessions`; popover with a host section each, focus (local) and copy (remote) actions; the bare-click copy of `ssh -t marko` needs G4. Design doc row at `bar.md:538`. (M-L) |
| battery | **missing** | none (nothing in pal reads battery %; `pmset` is only used to sleep, `core/src/system.rs:317`) | A `power` extension (or `system/battery`): `pmset -g batt` + `fs.watch` on `~/.local/share/power/state.json` (replaces `power_update`), the hide / colour / `loud` rules of `battery.sh:174-310` (on battery only), `title` `98% · 18.9W · churn`, `stale` past 120 s, popover a `{ view }` of the kv sections with progress bars per process, Battery Settings action. Colour ease (G7). Design doc row `bar.md:537`. (M) |
| bt_battery | **missing** | `bluetooth` reads device battery (`core/src/bluetooth.rs:29-31`, AirPods left / right / case) but declares no bar item | `bluetooth/battery`: hidden unless a connected device reports 1..25 %, `󰋋 󰁺` + `NN%`, amber, red at 20; a `low` setting. (S) |
| volume | **have** | `audio/volume`: route/level glyph + level, pinned 18 pt / 31 pt icon slot; click mutes, wheel moves ±5, popover opens Audio's device rows; polls 5 s until an audio event exists | It keeps the level visible rather than flashing it only after a change; switching the default output through CoreAudio is covered, but system-output reconciliation / Sound Settings remain polish. |
| mic | **have** | `audio/microphone`: hidden while input is fine, red muted/missing glyph otherwise; click restores an available input to 75%; same Audio popover and 5 s poll | no native audio event yet. |
| media_use | **missing** | none | `system/privacy` (or its own): `pmset -g assertions` + `pgrep`, glyph list, hidden when clear, orange band (G2), 2 s `refresh`. (S-M) |
| network | **have** | `network/status`: active Wi-Fi SSID (with optional `SSID = label`) or wired interface; red Offline without a route; click opens Network Settings, popover opens Network; 5 s plus wake/network refresh and Settings mocks | home hiding, hotspot/public/RSSI glyph variants and a compact kv popover remain polish. |
| weather | **missing** | `home-assistant` exists (entities over `ha.ts`) but has no bar item | `home-assistant/weather`: `outdoor_temperature` + `weather.forecast_home` (entity ids as settings), condition glyph + colour map, hidden unless notable (`lo` / `hi` / condition list), popover kv, `stale`. (S-M) |
| clock | not-for-pal | | Furniture sketchybar draws for free; pal owns no calendar-grid view and the popover would add nothing over his `cal`. If the menu bar target ever becomes the daily one, macOS has its own clock. |
| session | not-for-pal | | A label on the kitty window fed by a kitty watcher (`session_change`, `session.sh:17-18`); no pal extension owns kitty and a popover has nothing to add. If wanted later: a `kitty/session` item with `on: ["focus"]` and the watcher calling `pal bar render kitty/session` (S-M). |
| theme_watch | not-for-pal | | A bar-only mechanism. But pal's items depend on it indirectly: see G10. |
| raycast | not-for-pal | | Off by his choice (the recording dot); an alias is a screen capture and pal has no such primitive. |

## 3. Gaps in the bar model itself

Things his items do that `BarItem` / `[bar]` cannot say today, with what it
takes. Sizes: S under a day for an agent, M a day or two, L more.

| # | gap | his use | what it takes | size |
| --- | --- | --- | --- | --- |
| G1 | **Work hours as a pal notion.** `docs/design/bar.md:559` lists it open. | wmail, stan, slack hide; prs, issues drop `serpapi/*` rows (`lib.sh:23-36`) | Core: `[bar] gates = { working = "dek -q state working is on" }` probed each `minute` trigger and on `pal bar gate working on|off` (a dek hook can call it); `[bar.items.X] when = "working"` hides the item (no slot, render keeps running); the value rides on `BarCtx` (`ctx.gates.working`) so prs / issues filter rows instead of hiding. Fallback without core work: a `work_hours` setting per extension shelling `dek` inside `render` (each extension its own copy). | M core, or S ×4 in extensions |
| G2 | **Per-item background band.** | media_use orange band (`media_use.sh:42-43`); timer done on `URGENT_BG` (`timer.sh:152-154`); his hover tint | `BarItem.background?: BarColor` → sketchybar `background.color`, `background.drawing=on`, `background.height=22`, `corner_radius=0`; menu bar: a rounded pill behind the prerendered strip; feed: `class`. | S |
| G3 | **Size per item state / icon vs label size.** `size` is one number per look (`sketchybar.rs:143-144` sets both fonts). | upcoming 10 pt → 14 pt as it nears; lirik 10 pt label under a 15 pt glyph; timer rule at 11 pt under a 14 pt label; volume glyph at 18 pt | `BarItem.size?: number` (this render only, sketchybar only) and `[bar.items.X] icon_size` separate from `size`; the menu bar ignores both (it prerenders). | S |
| G4 | **Click that acts instead of opening the popover.** A click opens the popover whenever `menu` is set (`popover.rs`). | timer click dismisses, cldd click copies, upcoming click joins, volume click mutes, mic click unmutes, network / battery click opens System Settings | `BarItem.click?: "menu" | "open"` (default `menu`): `open` sends `bar/open` on a click and keeps the menu for hover, hotkey and the CLI. | S |
| G5 | **Position by state.** `position` is config; the renderer already re-adds on a change (`sketchybar.rs:225-228`). | upcoming moves `left` → `q` inside 15 min (`upcoming.sh:138-155`) | `BarItem.position?: string` honoured by the sketchybar target over the item's config; menu bar / feed ignore it. | S |
| G6 | **Scroll.** No `mouse.scrolled` reaches pal. | volume ±5, lirik next / prev | Renderer subscribes `mouse.scrolled`, script `pal bar hover … --state mouse.scrolled --delta $SCROLL_DELTA`; core sends `bar/action` with `scroll:up` / `scroll:down`; the SDK documents the two ids. Menu bar: `TrayIconEvent` has no scroll, so sketchybar only. | S-M |
| G7 | **Colour eases.** Every colour change on his bar is `--animate sin 8..12`; the design doc promised it (`bar.md:218`) and `sketchybar.rs` never emits `--animate`. | battery, volume, network, upcoming, hover | Prefix the `--set` batch with `--animate sin 10` when only colours changed (a rule or a label change must not tween). | S |
| G8 | **Event sources pal does not have.** Triggers are `show wake network focus minute media` (`sdk/src/protocol.ts:713`, `bar/mod.rs:963-990`). | `volume_change`, `power_source_change`, `wifi_change`, `system_woke` (have), `spotify_change` (`media` covers it) | Core `on` gains `power` (IOKit power source notification), `audio` (CoreAudio default-device / volume listener), `wifi` (`network` may already cover it); until then the extensions poll with a short `refresh` while relevant. | M |
| G9 | **Fixed icon width.** `width` is `label.width` (`sketchybar.rs:150-151`). | volume pins `icon.width=31` so a growing glyph does not shove the clock (`sketchybarrc:253-262`) | `[bar.items.X] icon_width` → `icon.width`; the menu bar's prerendered `width` already fixes the whole item. | S |
| G10 | **Theme flip.** The palette is read per apply (`menubar::dark`, `sketchybar.rs:434`), nothing re-applies on `AppleInterfaceThemeChangedNotification`, so a pal item keeps the old palette until its next render (up to `every`, 300 s for github). And `[bar.sketchybar.colors]` is one map: his bar has two palettes (`colors.sh`), so an override that matches Frappe is wrong under Dawn. His `theme_watch` repaint skips pal's names on purpose (`[a-z_]*` excludes dots, `theme_watch.sh:18-25`). | every pal item on his bar | Core: observe the theme notification (the tray already has `dark()`), `sync_all` with the palette cleared from `drawn` so every colour is re-sent; config: `[bar.sketchybar.colors.dark]` / `.light` (a flat map stays valid for both). | S |
| G11 | **Groups: brackets, one hover surface, band rules.** Segments are separate items but no bracket is added (`sketchybar.rs:156-189`, `--add bracket` never appears), segments get no hover script, and there is no hairline between adjacent groups; `bar.md:570` lists the separators as open. | cldd, prs, issues hover as one; `sep_prs` / `sep_issues` | Renderer: `--add bracket pal.<key>.group` over the chain when segments exist, hover script on every member, `[bar.sketchybar] separators = true` drawing `│` between visible pal items that have segments (the `band_seps_sync` rule: only between two drawn groups). | M |
| G12 | **Hover tint on the strip.** The design says the popover is the one rich surface, but his items also tint themselves `SURFACE` while the pointer is on them; a pal item under the pointer shows nothing until the peek opens (and peeks are off). | every item (`hover_guard`) | The hover path already reaches core (`pal bar hover`): a `Target::highlight(key, on)` setting `background.color=<surface> background.drawing=on` with `--animate sin 8`; the colour from `[bar.sketchybar.colors] surface`. | S |
| G13 | **Truncation.** `max_chars` is `label.max_chars`, a hard cut mid-word; his `trunc` backs off to a word and adds `…` (`lib.sh:540-549`). | every label | Clip in core with `menubar::clip` before the label goes to sketchybar (the menu bar already does). | S |

Not gaps: two-colour counts (segments), stale dimming (`stale`), a hidden
item that keeps ticking (`hidden`), 1 Hz ticks (`bar.update` with the diff),
custom `--trigger` events (`bar.update` / `pal bar render`), the popup rows'
hover-aside swap (the popover shows both columns), right-click mark-read (a
key in the popover), `q` / `e` positions and the add-order precedence at the
notch (`position` + `order`), per-instance items (`multi`).

## 4. Plan

Ordered so that the core gaps every extension leans on land first; anything
in one row can be handed to one agent as written. "∥" marks rows that can run
as parallel agents.

### (b) Bar model / core, first

| # | work | size | ∥ |
| --- | --- | --- | --- |
| B1 | G4 `click: "open"` on `BarItem` (sdk type + `checkBarItem`, `popover.rs` click path, docs). | S | ∥ with B2, B3, B4 |
| B2 | G2 `background` + G3 `size` / `icon_size` + G5 `position` + G9 `icon_width` on `BarItem` / `BarLookOverride`: sdk types, `shaped`, `sketchybar::props`, `diff` (a property that goes away re-adds the item, already), tests on the argv builder, docs `config.md` / `extensions.md`. | M | ∥ |
| B3 | G7 `--animate sin 10` around colour-only sets, G12 hover highlight through `Target::highlight`, G13 clip in core. One agent, all in `sketchybar.rs` + `popover.rs`. | S | ∥ |
| B4 | G10 theme: observe `AppleInterfaceThemeChangedNotification` (objc2 `NSDistributedNotificationCenter`), re-sync with the palette cleared; `[bar.sketchybar.colors.dark|light]`. | S | ∥ |
| B5 | G1 work hours: `[bar] gates`, `[bar.items.X] when`, `ctx.gates`, `pal bar gate`, a dek hook line in dotty (his to add). | M | after B1-B4 land (touches `mod.rs` render loop) |
| B6 | G6 scroll: renderer subscription + `pal bar hover --state mouse.scrolled`, `scroll:up|down` actions. | S-M | ∥ with B5 |
| B7 | G11 brackets + separators (`[bar.sketchybar] separators`). | M | after B2 (shares `props`) |
| B8 | G8 `power` / `audio` triggers in core (IOKit `IOPSNotificationCreateRunLoopSource`, CoreAudio property listener on the default output device). Optional: the extensions poll until then. | M | last |

### (a) Extension work

| # | extension, item | what to add | size | ∥ |
| --- | --- | --- | --- | --- |
| E1 | `github/prs` (new bar item) | **done:** independent PR item over the existing `prs` cache and palette, with deduped open PRs; red attention / amber active / green ready / muted waiting segments, hidden at zero, refreshes at 60 seconds only while checks run, Settings mocks. No combined cluster or separators. Deeper Sketchybar-era workflow classification can be considered separately if it proves useful. | M | — |
| E2 | `github/issues` (new bar item) | **done:** independent Issues item over the existing `issues` cache and palette, deduped into assigned / mentioned / authored segments, hidden at zero, Settings mocks. No combined cluster or separators. | S | — |
| E3 | `slack/unreads` | `dm_urgent` gains a `mention` case (red on `dm + mention`); `when = "working"` is config once B5 lands. | S | ∥ |
| E4 | `gmail/unread` | nothing in code; config: `show_title = false` for `gmail@work/unread`, `when = "working"` (B5). Optional `badge_style = "title"` idea dropped: his count-in-label look is section 5's `[bar.sketchybar.colors]` + `badge_style`. | 0 | |
| E5 | `timer/timer` | `background: "destructive-soft"` on done (B2), `click: "open"` + `onOpen` dismissing a done timer (B1), `bar_name` setting adding `  tea  +1`, `escalation = "seconds"` setting (60 s peach / 10 s red) or leave his fraction rule; rule size via `icon_size` (B2). | S | after B1, B2 |
| E6 | `calendar/upcoming` | `position: "q"` and `size: 14` under `warn_minutes` (B2), `click: "open"` + `onOpen` joining the next call (B1); config `show_icon = false`, `size = 10`, `color` muted far off is already there. | S | after B1, B2 |
| E7 | `spotify/playing` | `scroll:up|down` → next / previous (B6), `click: "open"` + `onOpen` play / pause (B1); config `position = "q"` (done), `color = "muted"`, `size = 10`, `icon_size = 15`, `order` above calendar so a near meeting takes the notch edge. | S | after B1, B6 |
| E8 | `power/battery` | **done:** macOS `pmset` / Linux `upower` gauge plus optional fresh watcher state for measured draw, warning rules, wake locks and top consumers; configurable healthy hide thresholds, direct Battery Settings action, palette and compact diagnostic popover, Settings mocks. Polished on the live bar: his 6-step ramp glyph instead of the duplicated `progress` rule, and a `16% · 1:04 · 9.5W` title with his ETA-before-amber ordering and the `0:00` fallback. Native source events remain deferred; the item polls. | M | — |
| E9 | `audio/volume` + `audio/microphone` | **done:** output glyph/level, direct mute, wheel ±5, 18 pt / 31 pt stable glyph slot, Audio palette popover and 5 s poll; mic hidden while healthy, direct 75% restore when muted or absent. Remaining polish: temporary volume-level flash, Sound Settings action and a native audio event. | M | ∥ |
| E10 | `bluetooth/battery` | **done:** extends the existing Bluetooth core source; connected devices that report at or below a configurable threshold surface as an amber/red interruption, otherwise hidden. It opens Bluetooth Settings directly, uses the Bluetooth palette as its popover and has Settings mocks. Tuned to his numbers: alert at 25%, red at 20%. The glyph stays single — a pair would be menu-bar tofu, and the device name already says which battery it is. | S | — |
| E11 | `network/status` | **done:** active SSID / wired label, optional friendly SSID map, red no-route state, direct Network Settings action, Network palette popover, `refresh: 5` plus wake/network and mocks. Polished to parity: `icon_only` drops the name and lets the glyph carry a four-step signal ramp, a hotspot, an open network, wired or offline; `networks` maps an SSID *or* a gateway to `hide` / `hotspot` / `public`, so home is gone rather than dimmed. Signal now comes from the core on macOS and `iw dev <dev> link` on Linux. Remaining: a compact kv popover instead of the full palette. | M | ∥ |
| E12 | `weather/weather` | **done:** standalone Open-Meteo location search/current forecast, no Home Assistant dependency; configurable place, comfort thresholds and extra WMO codes; condition glyph/tint mapping, quiet hidden state, visible failure diagnosis, compact current-conditions popover and Settings mocks. Fixed on the live bar: the geocoder takes one bare name, so `Istanbul, Turkey` matched nothing; qualifiers now rank rather than filter. | S-M | — |
| E13 | `system/privacy` (media_use) | assertions + `pgrep`, glyph list, hidden when clear, `background: "orange"` (B2), `refresh: 2` (min `every` is 10, so a `setInterval` + `bar.update` inside the extension). | S-M | after B2 |
| E14 | `tan` (new extension, `multi`) | instance → port map (`tan` 8793, `tan@work` 8803, a `url` setting), `state.json` + headers for "ran 5 m ago", `quiet_buckets` setting, count / red rule, popover per bucket (`id` semibold coloured by urgency, title muted), Enter opens `links[0]` else `https://tan.lan`; Open tan; a palette of the same rows. `when = "working"` on `tan@work/items`. | M | ∥ |
| E15 | `claude` (sessions, new extension) | `claude-state ls` (local) + `ssh marko cldd ls` (remote, `hosts` setting), segments [`yours` amber, `working` blue], hidden at 0, `on: ["show"]` with a 10 s remote ttl on `show`, a long-lived `ssh marko inotifywait` the extension owns (restart with backoff, `dispose()`), `bar.update` per burst; hook line in `claude-state` → `pal bar render claude/sessions`; popover: HORNET rows (Enter focuses the kitty window, the `cldd-focus` logic over `kitten @ ls`), MARKO rows (Enter copies the attach line, HUD "copied"), Shell on marko; `click: "open"` copying `ssh -t marko` (B1). Retire `cldd-stream.sh` when it lands. | M-L | ∥ |

### (c) Config only, `~/.config/pal/config.toml`

Doable now, before any code (the keys exist, `docs/config.md:195-262`):

```toml
[bar]
target = "sketchybar"

[bar.sketchybar]
open_on_hover = true          # his popups open on hover (hover_guard)
position = "right"            # his cluster; nothing of his is on `left`
spacing = 8                   # his icon.padding_right 4 + label.padding_left 4
# Frappe (dark) today; needs G10 for the Dawn half
colors = { text = "0xffc6d0f5", muted = "0xff7c8299", red = "0xffe78284", destructive = "0xffe78284", amber = "0xffe5c890", green = "0xffa6d189", blue = "0xff8caaee", accent = "0xff8caaee", grey = "0xff535766" }

[bar.items."gmail/unread"]          # mail: right cluster, left of the clock's neighbours
order = 60
[bar.items."gmail@work/unread"]     # wmail: at the notch, first (owns 1010)
position = "e"
order = 10
show_title = false
[bar.items."slack/unreads"]         # slack: notch, right of wmail (and stan)
position = "e"
order = 30
[bar.items."calendar/upcoming"]     # upcoming: left, no glyph, small
position = "left"
show_icon = false
size = 10
[bar.items."spotify/playing"]       # lirik: q, dim, small
position = "q"
color = "muted"
size = 10
order = 20                          # after upcoming's q form (G5) so the meeting takes the edge
[bar.items."timer/timer"]           # far left of the right cluster
order = 10
[bar.items."github/notifications"]  # issues' slot, left of prs
order = 20
```

Orders for the missing ones once they exist, right to left as his bar reads
(`sketchybarrc:228-540`): clock (his) · battery 90 · bt_battery 85 · volume 80
· media_use 75 · mic 70 · network 65 · weather 62 · mail 60 · tan 55 · cldd 50
· prs 30 · issues 20 · timer 10; on `e`: wmail 10 · stan 20 · slack 30; on
`q`: upcoming (near) 10 · lirik 20; `left`: upcoming (far). `spacing = 8` and
`size = 10` are per-item keys where they differ.

## 5. Looks: his hand-made items vs pal's on the same bar

What pal's sketchybar target sets per item (`sketchybar.rs:87-154`):
`drawing`, `updates=on`, `icon`, `icon.drawing`, `icon.color`, `label`,
`label.drawing`, `label.color`, `label.max_chars`, `icon.padding_left=8`,
`icon.padding_right=<spacing 4 | 8 when icon-only>`, `label.padding_left=0`,
`label.padding_right=8 | 2 before a segment or badge`, `icon.font.size` /
`label.font.size` only when `size > 0`, `label.font.family=Menlo` for
`mono`, `label.width` + `label.align=left` for `width`, `click_script`,
`script` (hover). Segments and the badge: their own items with
`icon.padding_left=<spacing>`, `icon.padding_right=2`, `label.padding_left=0
| spacing`, `label.padding_right=2 | 8`. Left alone, so his `--default` applies:
`icon.font` (FiraCode Nerd Font 15), `label.font` (.SF NS 14), `background.*`,
`popup.*`, `y_offset`. Verified on the live items: `pal.slack.unreads` reads
`icon.font FiraCode Nerd Font:Regular:15.00`, `label.font .SF NS:Regular:14.00`,
paddings 8/4/0/2.

Where a pal item is visibly not one of his:

| trait | his | pal's | fix |
| --- | --- | --- | --- |
| colours | Frappe: text `c6d0f5`, dim `7c8299`, dimmer `535766`, active `8caaee`, urgent `e78284`, yellow `e5c890`, green `a6d189`, peach `ef9f76` (`colors.sh:52-72`); Dawn in light | pal's tokens: text `ececf0`, muted `a3a4ae`, red `ff8a82`, destructive `ff6e66`, amber `f0b25a`, green `5ccb8e`, blue `7fb0ff` (`colors.rs:11-12`); live: his slack red is `e78284`, pal's slack is `ff6e66` next to it | `[bar.sketchybar.colors]` (section 4c) for the dark half now; both halves after G10 |
| gap between glyph and text | 8 pt (4 + 4) | 4 pt (`spacing` + 0) | `spacing = 8` |
| a count | in the label, `TEXT` (or the item's colour) | a separate `.badge` item in red after the label (`sketchybar.rs:160`) | for mail / wmail / github / tela the badge is the whole reading, so a `badge_style = "title"` (draw the count as the label in the item's colour) is the honest match: a `BadgeStyle` variant (S, add to B2) |
| glyph size per item | 15 default, 18 for volume, 11 for the timer rule | one `size` for glyph and text | G3 |
| icon-only items | `icon_only` moves the label's 8 onto the icon (`lib.sh:45`) | the same rule (`icon.padding_right=8` when title-less and trailing) | matched |
| stale | icon + label `DIMMER` | `muted` at `dim` 50 % alpha (`muted_hex`) | `dim = 100` + `muted = 0xff535766` reproduces his exactly; or keep pal's softer one |
| hover | `SURFACE` fill eased in | nothing (the popover, on click) | G12 + `open_on_hover = true` |
| colour changes | eased (`--animate sin`) | instant | G7 |
| truncation | word boundary + `…` | hard cut at `max_chars` | G13 |
| grouped counts | one bracket, hover lights the group, hairline between groups | loose items, no bracket | G11 |
| a shouting item | orange band (media_use), `URGENT_BG` band (timer done) | `urgent` colours the glyph and text only | G2 |
| the popup | sketchybar rows in the bar's palette, aligned under the item (`popup.align=left` at the notch) | pal's popover (420 px, the app's theme), centred under the anchor | by design (`bar.md:24-30`); the theme follows `general.theme` so it reads as pal, not as the bar |
| fonts | `.SF NS` 14 / Nerd 15 | inherited | matched |

With section 4c applied and B2 / B3 / B4 landed, a pal item on his bar is
indistinguishable from his own at rest; G11 and G12 close the hover and the
grouping.
