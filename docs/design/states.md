# States

Design spec, 2026-09-21. Named variables the whole of pal can read: the
user declares them, sets them by hand (for three hours, until reset),
derives them from one another, feeds them from a shell hook or an
extension, and points bar items and palettes at them. `working` is the
motivating one: a state you compose from what pal already knows (the
hour, the weekday, a session extension's "busy") or force from the
command line, and that the PR item hides on. Status: proposed; nothing
implemented.

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

`~/.local/state/pal/states.json` (`{ "manual": { "<name>": { "value",
"until"? } }, "published": { "<name>": { "value", "who", "at" } } }`),
written whole and atomically on every change, next to `bar.json`. Read
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

Small, and one grammar for `expr`, `show_when`, `hide_when` and the
CLI's `pal state eval`:

- Literals: `true`, `false`, `null`, numbers, `'single'` or `"double"`
  quoted strings.
- A state by name (`hour`, `sessions/working`).
- `!`, `&&`, `||`, `== != < <= > >=`, parentheses.
- `in`: `weekday in ['sat', 'sun']`, `front_app in ['com.apple.Safari']`.
- Truthiness for a bare state or `!`: `false`, `0`, `""`, `null` are
  false. A comparison with `null` on either side is `null` (so `x > 3` on
  an unknown `x` is unknown, not false), and `null` reads false where a
  boolean is wanted.
- `show_when` / `hide_when` want a boolean; a string or number there is
  truthiness.

Implemented as a hand-written recursive descent parser in
`core/src/states/expr.rs`, ~200 lines with tests, parsed once at config
load and kept as a tree. A crate was considered (`evalexpr` is the usual
one) and rejected: it brings its own value model, its own functions and
its own precedence, and the grammar here is seven operators. The parser
also gives the dependency set of an expression for free (the names it
reads), which is what the cycle check and the change propagation need.

## Change propagation

`core/src/states/mod.rs`, `States`: the table, the parsed expressions
with their dependency edges, the persisted layers. `set(name, layer,
value)` writes one layer and then walks: every expression naming a state
whose resolved value changed is re-evaluated, breadth first, at most once
per set (the graph is acyclic by the load check). The set of states
whose resolved value changed is the **change**, and the change goes out
once:

- to the bar (`bar::on_states_changed(changed)`): every item whose
  `show_when`/`hide_when` names one re-runs `draws` and syncs (the same
  path a `show` flip takes in `apply_config`, `bar/mod.rs:928`, no
  render), and every item that asked for `state:<name>` in `refresh.on`
  renders with reason `state`;
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
pal state set working true         # manual, until reset
pal state set working true --for 3h   # manual, expires (durations as the config's: 90s 25m 1h30m)
pal state set working true --until 18:00
pal state set working null         # a manual null: forces unknown (rarely wanted; it is there for symmetry)
pal state reset working            # the manual layer goes; expr / published / default answers
pal state eval "hour >= 9 && working"   # what an expression reads now, for writing one
pal state watch                    # streams `name\tvalue` on every change, for a script
```

`set` on an undeclared bare name declares it for this run and persists
its value, so a shell hook can feed a state before anyone has written a
`[states.<name>]` table for it. The value is parsed as JSON, else taken
as a string, so `set mood grumpy` works and `set n 3` is a number. On
`--for` and `--until` at once the earlier wins. This is the route for a
hook, a cron, a launchd tick, a `claude-state`-style script: it feeds
`working` exactly as an extension would, without being one.

Exit codes as the rest of `cli.rs`; a running pal is required (the
command is a handover, like `pal bar render`).

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
- A `live` palette (the values change under it), `on: ["state:*"]`, so
  the panel updates while open.

Rows are indexed at the root (`working` typed at the root finds the state
with its value in the accessory), tier `secondary`.

**A bar item, `states/forced`**: hidden unless some manual layer is in
place; then the names with the shortest time left (`working ⏱ 2 h 40 m`,
or `working` alone with no expiry), amber, click opens the palette
filtered to `manual`. The honest tell that a state is being held by hand.

## Settings

Settings > General gains nothing. Settings > Bar shows `show_when` on the
item pane (above). A **States** section under Extensions > States (the
bundled extension's page) lists the declared states with their live
values and the built-ins; a "Manage" link opens the palette. Declaring
and editing happen in the palette and the file, not in a second form.

## What lands where

- `core/src/states/{mod.rs, expr.rs}`: the model, the parser, the
  resolution, the persistence, the tests (pure: a table of sets in,
  changes out; expressions in, values and dependency sets out).
- `core/src/config/mod.rs`: `Config.states`, `State { expr, default,
  description }`, `BarItemConfig.show_when / hide_when` as parsed
  expressions (a bad one is a load warning that reads "always"),
  `Bar::draws` taking the states, the schema.
- `app/src-tauri/src/states.rs`: the live table behind `lock`, the
  built-in sources (the minute tick, the workspace notifications, the
  lock notifications, idle), the expiry timer, the fan-out to the bar,
  the pages and the host; `bridge.rs` gains `"states"`.
- `app/src-tauri/src/bar/mod.rs`: `wants("state:<name>")`,
  `on_states_changed`, `draws` reading the states, reason `state`.
- `app/src-tauri/src/cli.rs`: `Cmd::State { cmd: StateCmd }`.
- `app/src-tauri/src/events.rs`: `pal://states`.
- `sdk/src/api.ts`: `state`; `sdk/src/manifest.ts`: `states` in the
  manifest; `sdk/src/protocol.ts`: the types; `host/src/`: the
  `states/changed` notification to subscribers, the instance rewrite.
- `extensions/states/`: the palette and the `forced` item.
- `extensions/github/`: prs keeps its `work_hours` setting for now (the
  extension does not know the user's state names); its description points
  at `show_when = "working"` on the item as the general way, and the
  bespoke setting goes once that has been the answer for a while.
- `docs/config.md` (`[states]`, the two bar keys), `docs/extensions.md`
  (`state` in the SDK, `states` in the manifest, the trigger),
  `docs/cli.md` (`pal state`).

## Order of work

1. `core/src/states`: the model and the parser, with tests. Nothing
   above it changes until this is solid.
2. Config: `[states]`, `show_when`/`hide_when`, the schema.
3. App: the live table, the built-ins, persistence, the bar hook
   (`draws` and the trigger), the events. `pal state` on the CLI.
4. SDK and host: `state.*`, the manifest key, `states/changed`.
5. The palette and the `forced` item.
6. Docs.
