# pal for Raycast

Runs [pal](https://github.com/zcag/pal) palettes as native Raycast views. Every palette you have in
`~/.config/pal/config.toml` shows up here - the same bash plugins and data
files that back fzf and rofi, rendered with icons, accessories, detail panes
and action panels.

## How it works

pal normally drives the frontend: it lists items, pipes them into fzf or rofi
as a subprocess, and gets a selection back. Raycast can't be driven that way -
it's a resident app - so this extension inverts the flow and drives pal:

| Extension does | pal command |
|---|---|
| List palettes | `pal meta` |
| Configure the view | `pal meta <palette>` |
| List items | `pal list <palette> [--query …]` |
| Run an item | `pal pick <palette> [--action id]` (item JSON on stdin) |
| Run a known item | `pal pick <palette> --id <id>` (resolves it fresh) |

A pick may answer with a result envelope (`toast`, `hud`, `clipboard`, `open`,
`show`, `reload`, `close`, `palette`), which becomes the matching Raycast feedback.

## Setup

Start to finish, on a fresh machine.

### 1. pal

Needs **0.2.0 or newer** - this extension drives `pal meta`, `pal list --query`
and `pal pick --id`, which earlier versions don't have.

```bash
cargo install --path .        # from the repo root, or `cargo install pal`
pal meta >/dev/null && echo ok
```

### 2. Install the extension

```bash
cd raycast
npm install
npm run dev                   # `ray develop` - installs it into Raycast
```

`npm run dev` is the install mechanism for a local extension, not just a
watcher: it builds into `~/.config/raycast/extensions/pal/`. Those bundles stay
put after you stop it, so run it when you change the code and kill it when
you're done.

### 3. Extension preferences

Raycast Settings -> Extensions -> Pal.

| Preference | Set it to | Why |
|---|---|---|
| **Pal Command Shows** | *Default palette* | Root `Pal` opens your `default_palette`, matching bare `pal`. *All palettes* makes it a palette browser instead. |
| **pal Binary** | `pal` | Only needs a full path if it isn't on your login shell's `PATH`. |
| **Config File** | *(empty)* | Only for a non-standard `--config` path. |
| **Extension Source Folder** | the repo's `raycast/` dir | Required by *Sync Pal Palette Commands*, which rewrites this manifest. |
| **Palettes to Bake into Root Search** | *(empty)* | Empty means your `default_palette` - the same items `pal` shows. Or list palettes explicitly, comma-separated. |

### 4. Two things in Raycast's own settings

**Script Commands** - Settings -> Extensions -> Script Commands -> *Add a
folder*, pointing at:

```
~/.config/raycast/generated/pal
```

Select that **leaf folder**. Raycast does not recurse, so registering the
parent `generated/` finds nothing.

**Fallback command** - Settings -> **Launcher** -> Fallback Commands -> *Add
Fallback Command* -> pick **Pal**. (It's under Launcher, not Advanced.) Now a
root-search query that matches nothing can be handed to Pal, arriving with your
text already typed - which is how the live palettes stay reachable.

### 5. Generate

Run these two commands once from Raycast's root search:

- **Sync Pal Palette Commands** - one Raycast command per palette
- **Sync Pal Item Scripts** - one script command per item

### 6. Check it

Type `fileschema` (a bookmark item), `media` (a palette), and `otp` (a live
palette, reached through the fallback). All three should be one keystroke from
root search.

## Keeping it in sync

| You changed | Run | Notes |
|---|---|---|
| A palette's items, data file, or plugin | nothing | Read live on every open |
| Items of a *baked* palette | **Sync Pal Item Scripts** | Also runs hourly on its own |
| Added or removed a palette in `config.toml` | **Sync Pal Palette Commands** | Rewrites the manifest, so it needs a rebuild before the command appears |
| The extension's own code | `npm run dev` | Rebuilds and reinstalls |

Palette *contents* are never baked - the extension shells out on every open, so
config edits show up immediately. Only the two command layers need a sync,
because Raycast reads both from static manifests at install time.

## Why root search needs the extra step

Raycast's root search indexes **commands**, not the items inside them. A
bookmark listed by this extension only exists once you've opened a Pal command
- typing its name into Raycast itself will never find it. Setup step 4 closes
that gap two ways, and they compose.

**The fallback command** costs nothing and covers everything: a query that
matches nothing is handed to Pal already typed. Live palettes (`otp`, `tabs`,
`ha-states`) are reachable this way because nothing is stored ahead of time.

**Baked item scripts** remove that extra keystroke for stable palettes.
*Sync Pal Item Scripts* writes one script command per item, and each stores a
**pointer** rather than a copy:

```bash
exec pal pick bookmarks --id 'fileschema'
```

`pal pick --id` re-lists the palette and resolves the item at run time, so the
action is always current and only the title can go stale. That's what makes it
safe for palettes whose state moves even though their identities don't -
`ssh`, `systemd`, `docker`, `ha-states`.

Items from the `pals` palette are a special case: one *is* another palette, so
its script opens that palette's Raycast command by deeplink instead of running
a pick.

Palettes whose value *is* their content - `otp`, `tabs`, `clipboard`, `psg`,
`calc`, `pwatch`, `media` - are never baked, even if you name them. A root
search entry showing a twenty-minute-old OTP is worse than no entry.

Script command icons take an emoji, a file path or a URL - never Raycast icon
names, and never the Nerd Font glyphs palettes use in terminals. Freedesktop
names are mapped to emoji, and items with a `url` get their favicon fetched
once per sync and cached beside the scripts.

## Item fields it renders

Everything below is optional; palettes that don't set them still work.

| Field | Becomes |
|---|---|
| `name`, `subtitle`, `keywords` | Title, subtitle, extra search terms |
| `icon` / `icon_xdg` / `icon_utf` / `icon_rc` | Item icon - freedesktop names and emoji are mapped to Raycast icons; `icon_rc` names one directly |
| `color` | Icon tint |
| `accessories[]` | Right-hand text, relative dates, and coloured tags |
| `section` | List section |
| `detail` | Detail pane: markdown plus a metadata sidebar |
| `preview` | Shell command run for the selected item, output shown in the detail pane with the item's `PAL_*` variables set |
| `actions[]` | Action panel entries, with `shortcut`, `style: destructive` and `confirm` |
| `quicklook` | Quick Look preview |
| `tooltip` | Hover text on the item's icon |
| `mask` | `circle` or `rounded` - rounds the item's image, for avatars and artwork |
| `url` | Favicon fallback when there's no icon |

## Palette fields it renders

A palette says how it wants to be shown in its own `plugin.toml` (or its
`[palette.<name>]` block in `config.toml`). These are hints: the terminal
frontends have no equivalent and ignore them, so a palette can ask for the
Raycast treatment without becoming Raycast-only.

```toml
view = "grid"        # tiles instead of a list; hex-coloured items become swatches
live = true          # items are in the plugin's order, not frecency-ranked

[display]
detail = true        # open with the detail pane, for palettes you read rather than scan
columns = 5          # grid tiles per row (default 8)
aspect = "3/2"       # tile shape: 1, 3/2, 2/3, 4/3, 3/4, 16/9, 9/16
fit = "contain"      # or "fill"
inset = "small"      # none | small | medium | large
```

### Scopes

`[[filter]]` entries put a dropdown in the search bar. The first is the
default, and the chosen `id` reaches the plugin as **`PAL_FILTER`** - pal only
carries the id, the plugin decides what it means:

```toml
[[filter]]
id = "all"
name = "All senders"
icon_xdg = "mail-unread"

[[filter]]
id = "money"
name = "Banking"
```

```bash
pal list otp --filter money      # the same thing from the CLI
```

Nothing else changes: a frontend with no dropdown never sets `PAL_FILTER`, and
the plugin sees the unscoped list. The `otp` palette is the worked example.
