# Controls and groups

Design spec, 2026-10-04. How one device's view drives another device's
volume, power and inputs without either extension knowing the other, and
how every player reaches one Now Playing. Status: agreed with Cagdas
2026-10-04, being built.

## Why

Cagdas uses an Apple TV and a Samsung TV together: the Apple TV is what he
navigates, the Samsung is where the sound, the power and the inputs are.
Two remotes for one evening is the problem; a "living room" extension that
requires both is the wrong fix, since someone else has only one of them,
or an Apple TV with some other TV. The same shape shows up with now
playing: `media`, `spotify`, `appletv` and `theater` each have their own
"playing" bar item.

Rejected on the way (the conversation is in `notes/decisions.md`,
"Controls and groups"):

- **A common remote next to each extension's own.** Two places to look,
  and owning both devices would get you the lesser one.
- **One extension calling another.** Coupling, and a missing-extension
  case at every call.

## The shape

```
Apple TV view            pal (group "Living room")        Samsung extension
 [volume slot] ───────▶ volume → samsungtv ─────────────▶ controls.volume.set
 [inputs slot] ───────▶ inputs → samsungtv ─────────────▶ controls.inputs.set
 [power]       ───────▶ power  → appletv + samsungtv ───▶ controls.power.set
```

- **A control** is a small typed contract pal defines: `volume`, `power`,
  `inputs`, `player`. An extension that *provides* one says so in
  `pal.json` and implements it in its default export; it *publishes* the
  control's state when it changes.
- **A group** is the user's: a name, its members (extension instance
  keys), and for `volume` and `inputs` which member serves them. Power
  is every member that provides it. Built in Settings › Groups, mirrored
  in `[groups.<id>]`.
- **A consumer** asks pal for "my volume", not "the Samsung's": pal
  answers the provider the caller's group binds, else the caller itself
  when it provides that control, else nothing. Neither extension names
  the other; neither needs the other installed.
- **Each device keeps its own view.** The Apple TV remote stays the
  Apple TV extension's, every bespoke part of it untouched. Only the
  parts a group can hand to another device are pal's shared components
  (the volume row, the power button, the inputs row), so they look the
  same whoever serves them, and a slot nobody serves is not drawn.
- **Players are not grouped.** Every published `player` reaches `media`,
  whose Now Playing lists them all next to the system's players; picking
  one opens the provider's own palette, so Spotify keeps its lyrics and
  the Apple TV its clickpad. **No bar item is replaced**: the bespoke
  ones (Spotify's lyric line and ticking popover, the Apple TV's remote
  popover) stay on and stay theirs; `media`'s item only covers the
  players that have no item of their own showing.

The pattern pal already has: states (`design/states.md`) let an extension
publish under its own name and the user compose; controls do the same
for things you can also *do*.

## Controls (version 1)

Every state is optional field by field: a provider publishes what it
knows. `null` withdraws the control (the device is gone or asleep and
cannot be driven).

| Control | State | Ops |
| --- | --- | --- |
| `volume` | `level` 0..1 or absent (only steps), `muted` | `set(level)`, `step(+1 \| -1)`, `mute(on)` |
| `power` | `on` true/false, `busy` (waking) | `set(on)` |
| `inputs` | `list: { id, name, icon? }[]`, `current` id | `set(id)` |
| `player` | `state` (playing/paused/stopped), `title`, `artist`, `album`, `artwork` (url or `data:`), `app`, `position` + `at` (unix ms the position was read), `duration`, `palette` (the provider's own Now Playing palette), `item` (its own bar item for this playback, when it has one), `same` (bundle ids it duplicates on the system's list) | `play_pause`, `next`, `previous`, `seek(seconds)` |

Every state also carries the provider's `device` (its device's name,
"75\" Neo QLED") for the slot's tooltip and the group editor (as built:
`device`, not `title`, which `player` uses for the track).

## SDK

```ts
// provider: pal.json  "controls": ["volume", "power", "inputs"]
export default defineExtension(manifest, {
  palettes: { ... },
  controls: {
    volume: { set: (level) => tv.setVolume(level), step: (d) => tv.key(d > 0 ? "VOLUP" : "VOLDOWN"), mute: (on) => tv.mute(on) },
    power: { set: (on) => (on ? tv.wake() : tv.key("POWER")) },
    inputs: { set: (id) => tv.source(id) },
  },
});
controls.publish("volume", { device: "75\" Neo QLED", level: 0.24, muted: false });

// consumer (any extension, the provider itself included)
const v = await controls.get("volume");   // { provider: { key, title }, ...state } | null
await controls.run("volume", "set", 0.3);   // to whoever serves it for me
await controls.run("power", "set", true);   // every member's power, in a group
controls.onChange((which) => redraw());     // a served control changed
const players = await controls.all("player"); // every provider's, not grouped
```

- `get(control)` resolves for the **caller**: its group's binding, else
  itself. `power` answers the combined state (on when any member is on,
  the members listed).
- `run(control, op, ...args)` lands on the provider's handler, through
  the host, inside the provider's own context (its settings, storage,
  `view.update` are its own). Its error comes back to the caller.
- `onChange(cb)` fires on every publish and regroup with `{ control,
  provider, mine }`, `mine` when the caller's own `get` answer moved
  (Now Playing listens to every `player`).
- View components, pal's own look: `volumeRow(state, width, opts)`,
  `volumeButton(state, dir, size)`, `powerButton(state, size, opts)`,
  `inputsRow(state, width)`, `controlButton` for an extension's own
  button in the same look, answer a
  `ViewNode` (or nothing for a `null` state) whose actions are
  `controls:<control>:<op>[:<arg>]`; `controls.act(id, ctx)` runs one
  and answers whether it was one, so a view's `pick` forwards them in a
  line; `withControls(view)` declares the actions the parts run. The
  Apple TV's current volume row and buttons are where the look comes
  from.

## Core and host

- **State lives in the core** (`app/src-tauri/src/controls.rs`), as
  states do: `core/controls.publish { extension, control, state }`,
  `core/controls.get { extension, control }`, `core/controls.all
  { control }`, `core/controls.run { extension, control, op, args }`.
  A change notifies the host `controls/changed { keys }` (the instance
  keys whose answers moved), relayed to workers like `states/changed`.
- **`run`** is the core's request `controls/run { extension: provider,
  control, op, args }` to the host, which calls the provider's handler
  (inline, or its worker). A provider that is not loaded is an error
  ("75\" Neo QLED is not running"); a member that is not installed is
  dropped from the group's answers, and the editor says so.
- **The manifest** declares `controls` (the four names) so Settings and
  the store know what an extension provides without loading it;
  `checkControls` warns when the code and the manifest disagree.
- **Protocol 4.** A new SDK export: packages using it are stamped 4 and
  offered from the first app that runs 4.

## Config

```toml
[groups.living-room]
title = "Living room"
members = ["appletv", "samsungtv"]
volume = "samsungtv"     # unset: each member its own
inputs = "samsungtv"
```

`[groups]` is a pal table like `[states]`: `Config.groups`, the schema,
`unknown_keys`. A member in two groups is a load warning; the first
wins. A binding to a non-member is a load warning and ignored.

## Settings › Groups

UI first: the page is the way to make a group; the file mirrors it.

- A card per group: its name (editable), its members as chips (added
  from the extensions that provide any control, each with its tile),
  and a row per control with a picker among the members that provide
  it ("Volume: 75\" Neo QLED"; "each its own" when unset). Power reads
  "every member" with the members that provide it.
- "New group" at the bottom; a group with no members reads what it is
  for ("Put devices you use together in one group: one remote then
  drives the TV's volume and inputs").
- An extension in no group shows nothing new anywhere.

## Now Playing

- `media` adds every `controls.all("player")` to its list, ahead of
  the system's players. A provider's `same` bundle ids drop the system's
  row for the same playback (Spotify through its Web API and the
  Spotify app on the Mac are one).
- **Bar items stay as they are.** Spotify's item draws the lyric line
  on the strip on each line's timestamp, keeps a paused track muted
  ("held"), and its popover is the compact lyrics view with the queue's
  next two and its own keys, ticking through `view/shown { bar }`; the
  Apple TV's hides while the TV sleeps and its popover is the remote.
  None of that survives a hand-off to another extension's item, so
  nothing is turned off: `media`'s item skips a player whose provider's
  own item is showing (the provider says which item in its `player`
  state, `item: "playing"`, and the core knows whether it is enabled
  and drawn), and shows the rest (a browser tab, Jellyfin without its
  item) as today. Two items for one playback never happens; a bespoke
  one is never lost.
- Spotify, the Apple TV and theater (Jellyfin) publish `player`.

## The Samsung TV extension

`extensions/samsungtv`, registry-only (a device most Macs do not have,
and setup). Local only, current Tizen TVs (2016+, token auth): the
remote channel on `wss://<tv>:8002`, UPnP RenderingControl on `:9197`
for the volume level, Wake-on-LAN for power on. Provides `volume`,
`power`, `inputs`, `player` (the running app; DLNA media position).
Its own remote: the d-pad, the keys, apps, typing into the TV's
keyboard, inputs, the bar item, guided setup (find the TV, press Allow
on it).

## Building it

1. Foundation: SDK, host, core, config, manifest check, docs, protocol 4.
2. In parallel, on the foundation: Settings › Groups; the Apple TV as
   provider and consumer; `media` + Spotify + theater players; the
   Samsung TV extension's views on its protocol layer (built alongside
   the foundation).
3. Live, with Cagdas: pair the Samsung, make "Living room", check the
   Apple TV remote drives the TV's volume and inputs.
