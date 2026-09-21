# Scripts and data files

The zero-code tier. A palette can be a data file (json, jsonl or toml) or a
shell script that prints JSON lines, described by a small TOML table. No
TypeScript. The `scripts` extension reads those tables from a config file in the
previous pal's format and turns each into a palette named after its table, with
the config id `scripts-<name>`. The same extension also runs **script
commands**: single executable files with a `# @pal.title` header, one row each,
in one Script Commands palette ("Script commands", at the end).

## Where the tables live

The extension reads the file named by its `config` setting, by default
`~/.config/pal/config.toml`, and takes every `[palette.<name>]` table in it.
That default is pal's own config file, and pal's parser does not know a
`palette` table: it keeps it and reports one "unknown key" warning in the
Settings window (the editor's schema flags it too). The palettes still
work. To keep the warning away, put the tables in their own file and point
the extension at it:

```toml
[extensions.scripts]
config = "~/.config/pal/scripts.toml"
```

Relative paths inside that file (`data`, `base`, `general.env_file`) are
resolved against the file's directory. `~` is expanded.

Coming from the previous pal, the first launch does this for you: the old
config is kept
as `config.v1.toml` next to pal's, and `config` is set to it (the
migration is described in [Config](config.md)).

## A data-file palette

```toml
[palette.links]
auto_list = true
data = "links.json"       # relative to the config file's directory
icon_utf = "🔗"
actions = [
  { id = "open", title = "Open", action = "open", key = "url", primary = true },
  { id = "copy", title = "Copy link", action = "copy", key = "url", shortcut = "cmd+c" },
]
```

`links.json`, a JSON array (or one JSON object per line, or a TOML file
whose first top-level array is the rows):

```json
[
  { "name": "Home Assistant", "url": "http://ha.lan", "keywords": ["ha", "home"] },
  { "name": "Grafana", "url": "http://grafana.lan", "subtitle": "dashboards" },
  { "name": "GitHub", "url": "https://github.com", "icon_utf": "🐙" }
]
```

Every row is an item: `name` is the title, `id` defaults to `name`,
`subtitle` and `keywords` are what they say. The palette's `actions` apply
to every row: `Enter` opens `url` (the `primary` one goes first), `⌘C`
copies it, and both show in the action panel.

Without `actions`, the shorter form is one built-in action for every row:

```toml
[palette.links]
auto_list = true
data = "links.json"
auto_pick = true
default_action = "open"   # copy | open | cmd | type
action_key = "url"        # which row field the action takes
```

## A script palette

A directory with a `run.sh` (or any `command`) that answers `list` and
`pick`:

```toml
[palette.hosts]
base = "plugins/hosts"    # the directory, relative to the config file
requires = ["awk"]        # gated on the binary being on PATH
ttl = 3600                # reuse a listing for an hour
```

`plugins/hosts/run.sh`, listing the hosts in `~/.ssh/config` and copying an
`ssh` command line on pick:

```bash
#!/usr/bin/env bash
case "$1" in
  list)
    awk '/^Host / && $2 !~ /\*/ {
      printf "{\"id\":\"%s\",\"name\":\"%s\",\"icon_utf\":\"🖥\"}\n", $2, $2
    }' ~/.ssh/config
    ;;
  pick)
    printf '{"clipboard":"ssh %s"}\n' "$PAL_ID"
    ;;
esac
```

`chmod +x` it. `list` prints one JSON object per line; `pick` gets the
picked row as JSON on stdin and every field as an environment variable
(`PAL_ID`, `PAL_NAME`, ...), and prints a result envelope. Here the
envelope copies the text, and the panel hides.

## The palette table

Keys of `[palette.<name>]`. A `plugin.toml` in the `base` directory can
carry the same keys; the table's values win where set.

| key | what |
| --- | --- |
| `base` | The plugin directory. `~/...`, absolute, relative to the config file, or `github:<user>/<repo>/<path>[@ref]` (looked up in the previous pal's plugin cache under `~/.local/share/pal/plugins/github.com/...`; for `zcag/pal` the `v1_repo` checkout). `builtin/...` bases from the previous pal have no equivalent and show one inert row. |
| `command` | The script, a string or an argv list, resolved in `base`. Default: `run.sh` in `base`. |
| `data` | The data file, used when `auto_list` is true. |
| `auto_list` | Read `data` instead of running `command list`. |
| `auto_pick` | With no `actions`: run `default_action` on the row's `action_key` field instead of `command pick`. |
| `default_action` | `copy`, `open`, `cmd` or `type` (default `cmd`). |
| `action_key` | The row field an action takes as its value when the action has no `key` or `value` of its own (default `name`). |
| `actions` | A list of actions for every row (below). |
| `icon_utf`, `icon`, `icon_xdg` | The palette's icon: a glyph, an emoji or a hex colour; `icon_xdg` is an XDG icon name. |
| `input` | The palette lists on every keystroke inside it, with the query. Its rows are not at the root. |
| `input_prompt` | The search box placeholder inside the palette. |
| `live` | Listed again every time the panel shows, arrival order kept. |
| `ttl` | Seconds a listing stays good for (below). |
| `tier` | The palette's tier at the root: `"primary"`, `"normal"` or `"catalog"` ([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)). Unset, a data-file palette of 100 rows or more is a `catalog` (the nerd icons, the kde icons, `chars`), anything else `normal`. |
| `view` | `"grid"` for tiles; `display = { columns = 8 }` sets the width. |
| `display` | `{ detail = true }` opens the palette with the detail pane showing; `{ columns = N }` for a grid. |
| `filter` | A list of `{ id, name }`: a scope dropdown, `Tab` cycles it, the chosen id reaches the script as `PAL_FILTER`. The first is the default. |
| `requires` | Binaries that must be on PATH, a vertical bar between alternatives (`["jq", "gh\|glab"]`). The palette is skipped when one is missing. |
| `os` | `"macos"` or `"linux"`: skipped elsewhere. |

The scripts file's `[general] env_file = "..."` names a `.env`-style file whose
variables every script gets.

## The script protocol

`command list` runs for a listing. For an `input` palette the query is on
stdin and in `PAL_QUERY`, on every keystroke; otherwise stdin is empty
(the null device) and there is no query. The chosen filter is `PAL_FILTER`.
Stdout is JSON lines: one object per row, blank lines skipped, lines that
are not a JSON object dropped. Stderr goes to pal's log.

Row fields:

| field | what |
| --- | --- |
| `id` | Defaults to `name`. What `pick` gets back. |
| `name` | The title. |
| `subtitle` | Under the title. |
| `keywords` | Extra words the search matches. |
| `section` | Consecutive rows with the same section get a header. |
| `icon_utf`, `icon`, `icon_xdg` | The row's icon, same forms as the palette's; the palette's when absent. Raycast icon names (`icon_rc`) are dropped. |
| `url` | A row with a url and no icon (its own or the palette's) gets the site's favicon. |
| `accessories` | Right-aligned on the row: `[{ "text": "..." }, { "tag": "...", "color": "amber" }, { "date": 1700000000000 }]`. The Raycast forms `{ "text": { "value", "color" } }` and `{ "tag": { "value", "color" } }` work too. |
| `detail` | `{ "markdown": "...", "metadata": [{ "label", "text" }, { "label", "text", "link" }, { "label", "tags": ["a", "b"] }] }`, the detail pane's content. |
| `actions` | This row's own actions, replacing the palette's. |
| `preview` | A shell command whose stdout is the detail pane's markdown, run lazily (below). |

Anything else rides along and comes back to `pick` as `PAL_<KEY>`.

`command pick` runs when a row is picked and the action is a `pick` one
(the default when the row and the palette declare no actions, or an action
without `action`). The row's JSON is on stdin, and every field is in the
environment as `PAL_<KEY>` in upper case: strings as they are, anything else
as JSON. `PAL_ACTION` is the action's id when it has one. Stdout is read
for a result envelope: the whole output when it is one JSON object, else
the last line. A line that is not JSON is ignored.

Every script also gets `_PAL_CONFIG` (the config file), `_PAL_CONFIG_DIR`,
`_PAL_PALETTE` (the table's name) and `_PAL_PLUGIN_CONFIG` (the merged table
as JSON), the variables from `env_file`, and the arguments of a drill-in
(below). PATH is the app's plus `~/.local/bin`, `~/.cargo/bin`,
`/opt/homebrew/bin` and `/usr/local/bin`, since the app under launchd has
none of them.

A `list` or `pick` still running after `timeout` seconds (default 30) is
sent SIGTERM with its whole process group, then SIGKILL two seconds later,
and counts as failed.

## Actions

An entry of the palette's `actions` or a row's:

| field | what |
| --- | --- |
| `id` | Name the script sees as `PAL_ACTION`. `title` when absent. |
| `title` | What the action panel shows. |
| `action` | `pick` (run `command pick`), `copy`, `open`, `cmd` (run the value with `bash -c`, the row's variables set), `type` (paste the value into the app in front; Accessibility on macOS, see [Palettes](palettes.md)), or the name of an action plugin under `plugins/actions/<name>` next to the config or in `v1_repo`. Default `pick`. |
| `value` | The literal value for `copy`, `open`, `cmd`, `type`. |
| `key` | Take the value from this row field instead; falls back to the palette's `action_key`. |
| `primary` | This one goes first, so `Enter` runs it. Otherwise the first listed is primary and the second is `⌘Enter`. |
| `shortcut` | `"cmd+shift+c"` style, lower case, `+` joined. |
| `style` | `"destructive"` colours it as such. |
| `confirm` | A question to ask first; the title is the go-ahead. |
| `reload` | Stay open and list again after the action. |

A `cmd` action is waited on for up to 3 seconds so that a `reload` sees
its work and an envelope it prints counts; a slower one runs on alone.

## The result envelope

The JSON object a `pick` (or a `cmd` action, or an action plugin) prints.
Any of these keys makes it an envelope:

| key | effect |
| --- | --- |
| `clipboard` | Copy the string. |
| `open` | Open the url or path. |
| `toast` | `{ "title", "message", "style" }` (`success` or `failure`); the panel stays open to show it. |
| `hud` | A passive message: shown as a toast only when the envelope has no `toast`, `clipboard`, `open` or `close`, since those hide the panel. |
| `show` | `{ "title", "markdown", "metadata" }`: pushes a read-only level with that detail full width; `Enter` or `Esc` goes back. |
| `palette` | Drill into another script palette: `{ "palette": "otp-codes", "env": { "ACCOUNT": "..." } }` pushes a level scoped to that palette; its `list` and `pick` run with `env` exported, on every keystroke, and its picks are not remembered in the search history. |
| `reload` | Stay open and list again. |
| `close` | Recognised as an envelope key; the panel hides anyway after a pick without `toast` or `reload`. |

No envelope: the panel hides.

## `ttl`

Two things, one key. In the extension, a listing is cached for `ttl`
seconds per query, filter and drill-in arguments, so a show or a drill-in
inside that window does not run the script again. In the core, every
listing is written to disk and restored at the next start; with a `ttl`
the palette is listed again only when the restored listing is older than
that (in a low-priority pass shortly after startup), without one on every
start. A `live` palette relists on every show; with a `ttl` only when its
last listing is older than that. `⌘R` (Refresh) runs the script regardless.

A table without `ttl` takes the extension's `ttl` setting (default an
hour) when that is above 0; a `live` table without one is exempt and keeps
relisting on every show, since that is what `live` asks for.

## `preview`: lazy detail

A row of a script palette can carry `preview`, a shell command. It runs
only when the detail pane is open and the cursor has rested on the row;
its stdout becomes the pane's markdown, and the row's variables are set as
for `pick`. At most `preview_max` (default 4) run at once, each with a 10
second limit; the answer is cached per row until the palette lists again.
`preview_max = 0` turns previews off. Data-file rows never run previews.

## Script commands

The cheapest palette of all: a folder of executable files, each one a row
of the **Script Commands** palette (`scripts-commands`), described by a
comment block at the top of the file. Nothing else to declare. The folder
is the `commands` setting, `~/.config/pal/commands` by default, and it is
watched: a file saved there is read again on the next listing (the
palette is live, so the next time the panel shows).

```bash
#!/usr/bin/env bash
# @pal.title Deploy site
# @pal.description Push the site to an environment
# @pal.icon 🚀
# @pal.mode hud
# @pal.confirm true
# @pal.keyword deploy ship
# @pal.args target Environment: staging or prod
# @pal.args note Release note (optional)

echo "Deployed to $1${2:+ ($2)}"
```

`chmod +x` it. With the cursor on the row the search bar shows a field
for `target` and one for `note` after the query (Tab into them); Enter
runs the file with them as `$1` and `$2`, the panel hides, and the HUD
shows the first line it printed.
A pick that arrives without the fields (an item hotkey, a bare `pal run`,
a script) gets the same two as a form. The two files under
`examples/commands/` in the repo are this one and a list-mode one.

Any language: the file runs as it is, so the shebang decides
(`#!/usr/bin/env python3`), and the tags are read from `#`, `//`, `--`,
`;` or `*` comments in the first 60 lines. A file that is not executable,
has no `title`, is a dotfile or has `.template.` in its name is not a
command.

### The tags

| tag | what |
| --- | --- |
| `@pal.title` | The row's name. Required. |
| `@pal.description` | The row's subtitle (an `inline` command's output replaces it). |
| `@pal.icon` | An emoji or a Nerd Font glyph, a hex colour, one of the twelve brand colours (`amber`: a tile in that colour with the script mark), a PNG, JPEG or SVG next to the script (relative to it, inlined up to 64 KB), or an https url. Without one the row wears the script mark in the extension's colour. |
| `@pal.mode` | `hud` (default): the panel hides and the HUD shows the first output line, "Done" with none. `silent`: nothing shown unless the run failed. `show`: the whole output comes back as a level, in the detail pane, with a Copy action. `list`: the output is rows, below. `inline`: the first output line is the row's subtitle, refreshed on every show once `refresh` has passed. |
| `@pal.args` | `<name> <placeholder…>`, one per line, in the order the script gets them as `$1`, `$2`, ... They are the row's typed arguments, one field each in the search bar while the cursor is on the row (Tab into them); Enter runs; a placeholder ending in `(optional)` makes the field optional, the rest are required. A pick without the values (a hotkey, `pal run`) gets them as a form. |
| `@pal.confirm` | `true`: ask before running (the title as the go-ahead). A command with `args` asks through its fields instead. |
| `@pal.keyword` | Extra words the search matches, space or comma separated; repeatable. |
| `@pal.section` | A section header the rows with the same one share. |
| `@pal.cwd` | The working directory (`~` expanded, relative to the script's folder); the script's folder by default. |
| `@pal.refresh` | How long an `inline` command's line is kept before it runs again: `10s`, `2m`, `1h`, a bare number of seconds. A minute by default. |

**Raycast's headers work as they are.** A script command written for
Raycast drops into the folder unchanged: `@raycast.title`, `@raycast.mode`
(`compact` is `hud`, `fullOutput` is `show`, `silent` and `inline` are
themselves), `@raycast.icon`, `@raycast.description`,
`@raycast.packageName` (the section), `@raycast.argument1..3` (the JSON
form, `placeholder` and `optional` read), `@raycast.needsConfirmation`,
`@raycast.currentDirectoryPath`, `@raycast.refreshTime`.
`@raycast.schemaVersion`, `author`, `authorURL` and `iconDark` are
ignored.

### The palette

| keys | action |
| --- | --- |
| `enter` | Run (as the mode says); Open, for a `list` command; with `args`, the arguments in the bar first (`$1`, `$2`, ... in header order) |
| `cmd+o` | Open the script file in its editor |
| `cmd+c` | Copy output: runs the command (up to 8 s) and copies what it printed; with `args`, the arguments in the bar first |
| `cmd+shift+c` | Copy the file's path |
| `cmd+i` | The detail pane: file, mode, arguments, confirm, working directory |
| `cmd+r` | List again now |

The row's id is the file name, so a global hotkey for one command is
`[palettes.scripts-commands.item_hotkeys]` with `"deploy-site.sh" =
"ctrl+alt+d"` ([Config](config.md)). The mode sits on the right of the
row unless it is `hud`. A run that exceeds the extension's `timeout`
(30 s) is killed with its process group; `inline` lines and Copy output
get 8 s at most. Scripts get the same PATH as the table palettes (the app's
plus `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`,
`/usr/local/bin`).

### `list` mode

Enter pushes a level whose rows are what the script printed: JSON lines (the row
fields of "The script protocol" above: `name`, `id`, `subtitle`, `keywords`,
`section`, `url`, `icon_utf`, `accessories`, `detail`, `actions`), a JSON array
of them, or, when no line is JSON, one row per plain line. A row with `url`
opens it on Enter, one with `copy` copies that string; any other row runs the
script again with `PAL_PICK` set to the row's id (and the same arguments), and
the HUD shows the first line it prints. A row's own `actions` (the table shape
above, `copy` and `open` with `key` or `value`) are honoured.

```bash
#!/usr/bin/env bash
# @pal.title Listening ports
# @pal.mode list
# @pal.icon cyan
[ -n "$PAL_PICK" ] && { echo "Port $PAL_PICK"; exit 0; }
lsof -nP -iTCP -sTCP:LISTEN | awk 'NR > 1 { split($9, a, ":"); p = a[length(a)]
  printf "{\"id\":\"%s\",\"name\":\":%s\",\"subtitle\":\"%s\",\"copy\":\"%s\"}\n", p, p, $1, p }'
```

### `inline` mode

```bash
#!/usr/bin/env bash
# @pal.title Battery
# @pal.mode inline
# @pal.refresh 30s
pmset -g batt | awk -F'\t' 'NR == 2 { print $2 }'
```

The first line the script prints is the row's subtitle. The palette is
live, so every show of the panel lists it again; the line is kept for
`refresh` and the script runs again only past that. Enter runs it once
more, in `hud` mode.

## Settings

`[extensions.scripts]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.config/pal/config.toml` | The file whose `[palette.<name>]` tables become palettes. |
| `skip` | list | `["combine", "pals", "apps", "bookmarks", "calc", "emoji", "clipboard"]` | Table names not to load, because a bundled extension covers them. |
| `v1_repo` | path | `~/proj/pal-v1` | A checkout of the previous pal: where `github:zcag/pal/...` bases resolve when its plugin cache has no copy. |
| `commands` | path | `~/.config/pal/commands` | The folder of single-file script commands ("Script commands", above). Read on every listing, and watched. |
| `timeout` | seconds, 1 to 300 | `30` | A `list` or `pick` still running after this is killed. |
| `preview_max` | 0 to 32 | `4` | How many `preview` commands run at the same time. 0 turns previews off. |
| `ttl` | seconds, 0 to 604800 | `3600` | Listing lifetime for non-live tables that declare no `ttl`; a table's own `ttl` wins. 0 runs every script on every start. |

`config`, `skip`, `v1_repo` and `ttl` are read when the extension loads;
after changing them, Settings > Restart extension host. `timeout`,
`preview_max` and `commands` apply to the next run or listing.
