# States

Design spec, 2026-09-21. Named variables the whole of pal can read: the
user declares them, sets them by hand (for three hours, until reset),
derives them from one another, feeds them from a shell hook or an
extension, and points bar items and palettes at them. `working` is the
motivating one: a state you compose from what pal already knows (the
hour, the weekday, a session extension's "busy") or force from the
command line, and that the PR item hides on. Status: built 2026-09-21
(the deltas from the proposal are marked "as built").

## Goals and non-goals

- A state is the user's. `working` exists because `[states.working]` is in
  the config (or because `pal state set working true` was run once), not
  because any extension or built-in defined it. pal ships no meaning for
  "work hours"; it ships `hour` and `weekday` and the user writes the rule.
- Three ways a value gets in, one resolution order: a manual value (with
  an optional expiry), else the state's expression, else what an
  extension published, else the declared default. `reset` clears the
  manual value and the rest takes over.
- Anything in pal that asks "should I" can ask a state: a bar item's
  `show_when`, a render trigger `state:<name>`, `state.get` in the SDK,
  `pal state get` for a script outside pal.
- Extensions cannot clobber the user's names: what an extension publishes
  lands under `<extension>/<name>`, and the user composes it in.
- Non-goals: a general rules engine (no actions fire on a change; a state
  is read, not obeyed); history; states per config profile (they are
  machine state, like the clipboard db); Linux bar targets (nothing to
  hide there yet, the rest works).

## Config shape

```toml
[states.working]                 # the table existing declares the state
expr = "weekday != 'sat' && weekday != 'sun' && hour >= 9 && hour < 18 || sessions/working > 0"
description = "On the clock"     # the States palette's subtitle

[states.deep]                    # no expr: only ever set by hand or from outside
default = false

[states.home]
expr = "network == 'Zaxxon 5G'"

[bar.items."github/prs"]
show_when = "working"            # the item leaves the strip when this is false

[bar.items."spotify/playing"]
hide_when = "working && deep"
```

- `expr`: a string in the expression language below, over any state by
  name. Re-evaluated when any state it names changes, and at load.
- `default`: the value with nothing set and no expression (`false` when
  absent). Also the type hint: a state whose default is a number keeps
  numbers.
- `description`: what the palette shows.
- A state named in an expression but declared nowhere is a load warning
  and reads `null`.
- A cycle (`a = "b"`, `b = "a"`) is a load error naming the states; both
  read `null` until fixed.
- `[states]` is a pal table like `[palettes]` and `[bar.items]`:
  `Config.states: BTreeMap<String, State>` next to `bar` and `instances`
  (`core/src/config/mod.rs:50`), with the same `extra`/`unknown_keys`
  handling and the schema.

**Names.** Lowercase letters, digits, `_`, one optional `/` for an
extension's (`sessions/working`). The user's are bare; the built-ins
(below) are bare and reserved, so `[states.hour]` is a load error;
an extension's are `<key>/<name>` where `<key>` is the instance key
(`gmail@work/unread`), the same rule as bar items.

## Values

JSON scalars: `true`/`false`, a number, a string, `null` (unknown). Not
objects or arrays: a state is a fact, not a record; an extension with a
record publishes the facts it wants read.

## Resolution

Every state resolves to one value in this order, and `pal state` shows
which layer answered:

1. **Manual** (`source: "manual"`): what `pal state set` / the palette
   set, with an optional `until` (absolute unix ms). Expired, it is
   removed and the next layer answers; the change fires like any other.
2. **Expression** (`source: "expr"`): the config's `expr`, when declared.
3. **Published** (`source: "<who>"`): the last `state.set` from an
   extension, or the built-in's own value.
4. **Default** (`source: "default"`): the config's `default`, else
   `false` for a declared state and `null` for one that only ever
   existed as a publisher's.

A manual value on a state with an expression is an override the palette
shows as one ("forced true, 2 h 40 m left"); on a state without one it is
just the value. `reset` removes the manual layer either way.

## Persistence

`<data dir>/states.json` (`{ "manual": { "<name>": { "value",
"until"? } }, "published": { "<name>": { "value", "who", "at" } } }`,
plus, as built, `entries` (every resolved state as `Entry`) and
`diagnostics`, so `pal state` reads it in its own process the way `pal
bar list` reads `bar.json`), written whole and atomically on every
change, next to `bar.json`. Read
at startup so a `--for 3h` survives a relaunch and an extension's last
value is there before its worker is up (marked stale in the palette
until it publishes again). Built-ins are not stored; they are read at
startup.

## Built-ins

Ready-made variables, bare and reserved, each with the core source that
already exists:

| name | value | source |
| --- | --- | --- |
| `hour` | 0..23 | the minute tick (`bar/mod.rs:1103`) |
| `minute` | 0..59 | the same tick |
| `weekday` | `mon`..`sun` | the same tick |
| `date` | `YYYY-MM-DD` | the same tick |
| `front_app` | bundle id, or the app name where there is none | `NSWorkspaceDidActivateApplicationNotification` (`bar/mod.rs:1127`), the `focus` trigger's source |
| `awake_since` | unix ms of the last wake | `NSWorkspaceDidWakeNotification`, the `wake` trigger's source |
| `network` | the SSID, `"wired"`, `"none"` | `wifi.rs` status, polled on the `network` trigger and the minute |
| `theme` | `dark` / `light` | `theme.rs` |
| `locked` | bool | `com.apple.screenIsLocked` / `screenIsUnlocked` (distributed notifications; new) |
| `idle` | seconds since input | `CGEventSourceSecondsSinceLastEventType`, read on the minute (new) |
| `host` | the machine's hostname | once |
| `panel` | bool, the panel is showing | `pal://shown` / hide |

Each built-in changes only when its source fires, so an expression over
`hour` costs one evaluation a minute. Linux: `hour`..`date`, `host`,
`theme`, `network` and `panel` work; the rest read `null`.

## The expression language

As built: **Jinja**, through `minijinja` (Cagdas, 2026-09-21: a syntax
people already know beats a grammar of pal's own), one grammar for
`expr`, `show_when`, `hide_when` and `pal state eval`:

- `and`, `or`, `not`, `in`, `== != < <= > >=`, `x if c else y`,
  parentheses, the builtin filters (`hour|string`), `true`/`false`/`none`,
  numbers, `'single'` or `"double"` quoted strings.
- A state by name (`hour`, `working`). Since `/` divides, an extension's
  state is `sessions.working` (its states as a map under its key), and
  any name at all is `states['gmail@work/unread']`.
- What Jinja says, a state says: an unknown state is `none`, which is
  false on its own and compares like a value (`none >= 9` is false, not
  unknown), a missing extension map is undefined (`Chainable`, so
  `sessions.working` with no `sessions` reads false rather than
  erroring). An expression that fails to parse is a load diagnostic and
  reads `null`; one that fails to evaluate reads `null` and the palette
  shows the error.
- `show_when` / `hide_when` want a boolean; a string or number there is
  truthiness.

`Expression::undeclared_variables(nested)` gives the dependency set (the
names it reads), which is what the cycle check and `bar_items_reading`
need; `states[...]` in a source depends on everything.

## Change propagation

`core/src/states.rs`, `States`: the table, the compiled expressions with
their dependency edges, the persisted layers. As built, every write
recomputes the whole table (tens of states, once a minute at most from
the clock) in dependency order rather than walking a graph; the edges
serve the cycle check and "which bar items read this". The set of states
whose resolved value changed is the **change**, and the change goes out
once:

- to the bar (`bar::on_states_changed(changed)`): every item whose
  `show_when`/`hide_when` names one re-runs `draws` and syncs (the same
  path a `show` flip takes in `apply_config`, no render; `Entry.held`
  remembers, and the flip back renders since what it last drew is as old
  as the hold), and every item that asked for `state:<name>` in
  `refresh.on` renders with reason `state` (`state:*`: on any change, and
  on any hold or reset by hand through `on_states_held`, since holding a
  state at the value it had is still something the `forced` item shows);
- to the pages as `pal://states` with the changed names and values (a
  view palette lists `state:<name>` under `on` like any trigger,
  `views.rs`);
- to the host as `states/changed { <name>: value }` (the `settings/changed`
  shape, `settings.rs:520`), which the SDK fans out to `state.onChange`
  subscribers.

An expiry (`until`) is a set at that instant: one tokio timer for the
nearest expiry, re-armed on every change to the manual layer.

## The SDK

`state` in `@zcag/pal`, `core/states.{get, set, list}` on the bridge
(`bridge.rs`):

```ts
state.get("working")                          // the resolved value, or null
state.get()                                   // every state: { name: { value, source, until? } }
state.set("busy", 3)                          // publishes sessions/busy (the caller's key is prepended)
state.set("busy", null)                       // withdraws it: the state reads its default
state.onChange("working", (v) => ...)         // a resolved change; returns the unsubscribe
state.onChange((changed) => ...)              // every change, { name: value }
```

`set` outside `list`/`pick`/`render` takes the extension's name as the
last argument, as `storage` does; the host's `instances.ts` rewrites the
name to the instance key like it does for `bar.update` (`instances.ts:112`).
A `set` to a name with a `/` is refused: an extension owns its own
prefix and nothing else. A value that is not a scalar is refused.

**Declaring what you publish.** `pal.json` lists them so the palette and
Settings can show a state before it is ever set, with its description:

```json
"states": {
  "working": { "description": "Sessions with a turn in progress", "kind": "number" },
  "waiting": { "description": "Sessions waiting on you", "kind": "number" }
}
```

Undeclared publishes still work (a load warning, like a code title with
no manifest counterpart). `kind` is `boolean` | `number` | `string`.

## Bar items

- `[bar.items."<key>"] show_when = "<expr>"` and `hide_when = "<expr>"`
  (both allowed; hidden when `show_when` is false or `hide_when` is
  true). Read at draw time in `Bar::draws` (`config/mod.rs:819`) next to
  `enabled` and `target`, so an item hidden by a state costs no render
  and no host request, the same as `target = "off"` (the timer stops
  too; the item renders once when it comes back, reason `state`).
- `refresh.on` takes `"state:<name>"` next to `show`, `wake`, `focus`,
  `minute`, `network` (`ManifestBar::wants`, `bar/mod.rs:346`): for an
  item whose *content* follows a state, not just its presence (prs
  dropping the work rows off the clock reads `state.get("working")` in
  `render`, and this is what re-renders it on the flip). `ctx.reason` is
  `state`.
- Settings > Bar: the item's pane gets a "Show when" field (the
  expression, with the live value beside it) under Behaviour, next to
  `show`.

## The CLI

```
pal state                          # a table: name  value  source  until  description
pal state get working              # the value, one line (`null` for unknown); exit 1 when the state does not exist
pal state json                     # every state as JSON
pal state set working true         # manual, until reset
pal state set working true --for 3h   # manual, expires (durations as the config's: 90s 25m 1h30m)
pal state set working true --until 18:00
pal state reset working            # the manual layer goes; expr / published / default answers
pal state eval "hour >= 9 && working"   # what an expression reads now, for writing one
pal state watch                    # streams `name\tvalue` on every change, for a script
```

`set` on an undeclared bare name declares it for this run and persists
its value, so a shell hook can feed a state before anyone has written a
`[states.<name>]` table for it. The value is parsed as JSON, else taken
as a string, so `set mood grumpy` works and `set n 3` is a number. With
`--for` and `--until` both given, `--for` wins (as built). This is the route for a
hook, a cron, a launchd tick, a `claude-state`-style script: it feeds
`working` exactly as an extension would, without being one.

The table, `get`, `json`, `eval` and `watch` read the feed file in the
calling process (the single-instance channel is one way, as for `pal bar
list`); `eval` runs the expression against the feed's resolved values.
`set` and `reset` are a handover to the running instance, like `pal bar
render`, and print nothing.

## The States palette

A bundled core-backed extension, `extensions/states/`, like `system`:
`list` from `state.get()`, one row per state:

- title the name, subtitle the description (or the expression, for a
  derived one with none), accessory the value drawn as a tag
  (`true` green, `false` muted, a number or string plain, `null` "unknown"
  muted), a second accessory the source (`manual · 2 h 40 m` amber when
  forced, `expr`, `sessions`, `default`), a filter per source.
- Actions: **Set true / Set false** (until reset), **Set true for…** a
  submenu of 15 m / 1 h / 3 h / until tomorrow / a form for a value and a
  duration, **Reset** (only on a manual layer), **Copy name**, **Edit in
  config** (opens the file at `[states.<name>]`), **New state** at the
  top: a form (name, kind, default, expression, description) that writes
  the table through `settings.set`-style surgical edit (`edit.rs`, the
  path the settings window uses), so the palette and the file agree.
- A `live` palette (the values change under it): every show lists again,
  and every action answers `keep`, which lists again.

Rows are indexed at the root (`working` typed at the root finds the state
with its value in the accessory), tier `secondary`.

**A bar item, `states/forced`**: hidden unless some manual layer is in
place; then the names with the shortest time left (`working ⏱ 2 h 40 m`,
or `working` alone with no expiry), amber, click opens the palette
filtered to `manual`. The honest tell that a state is being held by hand.

## Rules: extensions publish facts, the core decides presentation

Built 2026-09-21, second pass (Cagdas: "clean up a lot of tech debt around
auto hide / colour change / size change based on state logic for bar
items; they can all publish states and use their own states to have
default rules for those behaviours, configurable over their defaults").
The survey found the same shape in every bar extension: a fact the
extension knows, a presentation decision hard-wired in `render`, and a
bespoke setting bolted on (calendar's eleven `bar_*_color/size/position`,
power's three thresholds, a `bar_show` select each on media, spotify,
slack, bluetooth and audio with its own option names, weather's band,
`dm_urgent` on slack and whatsapp, network's `icon_only`).

- **A render carries its facts**: `BarItem.states` (`{ name: scalar }`),
  published as `<extension>/<name>` atomically with the render
  (`bar/mod.rs` `set` before the draw), so a rule reads the facts of the
  render it decorates. Declared under `states` in `pal.json`. A `null`
  withdraws (an item that could not read at all publishes nulls).
- **Rules in the manifest** (`bar.<id>.rules`, an ordered list of
  `{ id, when, description?, hidden?, urgent?, position?, ...look }`),
  compiled with the other conditions in `States::configure`
  (`BarConditions.rules`), evaluated at draw time (`States::active_rules`,
  `draw_for`): `hidden` and `urgent` land on the item before `kept`, a
  rule's `color` replaces the render's (a `muted` from the render
  included: the rule is the decision), the rest merge over the item's
  look override in order.
- **Overrides by id**: `[bar.items."<key>".rules.<id>]` merges key by key
  (`BarRule::with`, `Bar::rules_of`); an id the manifest lacks is a rule
  of the user's own and needs `when`. The conditions are rebuilt when an
  extension registers its items (`states::reconfigure_bar`), since rules
  come from manifests.
- **Settings > Bar** (`SettingsBarRules.tsx`): under the item, a "Reads"
  line with the facts and their live values, then a row per rule (a dot
  for "holds now", the id, the condition in mono, the effect as chips,
  "Power's" / "Power's, changed" / "yours"), opening into an editor of the
  few keys a rule is made of (When, Hidden, Urgent, Tint, Size, Position,
  Icon), each edit one key under the rule's table; Reset drops an
  overridden extension rule's table, Remove a rule of the user's own; Add
  a rule takes an id and a condition and starts hidden.
- **Migrated**: calendar (`phase`, `minutes`, `call`; rules far/near/
  warning/critical/running; eleven settings gone), power (`level`,
  `charging`, `draw`, `alert`; fine/plugged/low/warn/critical/crit; three
  gone), media (`playing`, `state`, `app`; paused), spotify (`playing`,
  `loaded`; paused), slack (`attention`, `dm`, `channels`; quiet/dm;
  `bar_show` and `dm_urgent` gone), whatsapp (`unread`, `direct`;
  quiet/dm; `dm_urgent` gone), bluetooth (`low`, `lowest`, `connected`;
  none/fine/low/critical; `bar_show` gone, `low_threshold` kept since it
  shapes the content), weather (`temp`, `code`, `quiet`, `condition`;
  ordinary/cold/hot; `low`, `high`, `notable_conditions` gone), audio's
  microphone (`input`; live/muted/missing), network (`icon_only` gone:
  `show_title = false` was already the core's).
- Kept as settings, on purpose: what shapes content rather than
  presentation. Since 2026-09-23 (`docs/design/model.md`) they are the
  items' own, `bar.<id>.settings`: the now-playing item's `artwork`,
  Spotify's playing item's `lyrics`, the calendar upcoming item's
  `near/warn/urgent_minutes` that define the phase, the bluetooth battery
  item's `low_threshold`, the hue home item's `main_room`.

## Settings

Settings > Bar shows `show_when` and `hide_when` on the item pane under
Placement, and the state line reads "off the strip by show_when ..."
while a condition holds the item off. Declaring and editing states
happen in the palette and the file, not in a second form.

## What lands where

- `core/src/states.rs`: the model over `minijinja`, the resolution, the
  persisted shape, the tests (pure: a table of sets in, changes out).
- `core/src/config/mod.rs`: `Config.states` (`states::Decl { expr,
  default, description }`), `BarItemConfig.show_when / hide_when` as
  strings (`Bar::conditions()` hands them to `States::configure`, which
  compiles them; a bad one is a diagnostic and the item shows), the
  schema.
- `app/src-tauri/src/states.rs`: the live table behind `lock`, the
  built-in sources (the minute tick, the workspace notifications, the
  lock notifications, idle), the expiry timer, the fan-out to the bar,
  the pages and the host; `bridge.rs` gains `"states"`.
- `app/src-tauri/src/bar/mod.rs`: `wants("state:<name>")` and
  `state:*`, `on_states_changed`, `on_states_held`, `draws` asking
  `states::shows`, `Entry.held` (also in the feed and Settings), reason
  `state`.
- `app/src-tauri/src/cli.rs`: `Cmd::State { cmd: StateCmd }`.
- `app/src-tauri/src/events.rs`: `pal://states`.
- `sdk/src/api.ts`: `state`; `sdk/src/manifest.ts`: `states` in the
  manifest; `sdk/src/protocol.ts`: the types; `host/src/`: the
  `states/changed` notification to subscribers, the instance rewrite.
- `extensions/states/`: the palette and the `forced` item;
  `host/test/extensions/states.test.ts`.
- `extensions/sessions/`: publishes `working` and `waiting` at every
  render, declared in its `pal.json`.
- Settings > Bar: `show_when`/`hide_when` fields on the item pane under
  Placement; the state line reads "off the strip by show_when ...".
- `extensions/github/`: prs keeps its `work_hours` setting for now (the
  extension does not know the user's state names); its description points
  at `show_when = "working"` on the item as the general way, and the
  bespoke setting goes once that has been the answer for a while.
- `docs/config.md` (`[states]`, the two bar keys), `docs/extensions.md`
  (`state` in the SDK, `states` in the manifest, the trigger),
  `docs/cli.md` (`pal state`).

## Not built, on purpose or not yet

- Settings > Extensions > States as a section listing the declared
  states: the palette and the file are the two places; a third form was
  not worth its upkeep.
- Linux: `front_app`, `awake_since`, `locked` and `idle` read `null`
  there (the sources are AppKit and CoreGraphics); the rest works.
- The `github` prs item keeps its own `work_hours` setting; `show_when =
  "working"` on the item is the general way now.
