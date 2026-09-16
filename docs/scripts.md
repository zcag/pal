# Scripts and data files

The zero-code tier. A palette can be a data file (json, jsonl or toml) or a
shell script that prints JSON lines, described by a small TOML table. No
TypeScript. The `scripts` extension reads those tables from a pal v1 style
config file and turns each into a palette named after its table, with the
config id `scripts-<name>`.

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
| `base` | The plugin directory. `~/...`, absolute, relative to the config file, or `github:<user>/<repo>/<path>[@ref]` (looked up in v1's plugin cache under `~/.local/share/pal/plugins/github.com/...`; for `zcag/pal` the `v1_repo` checkout). `builtin/...` bases from v1 have no equivalent and show one inert row. |
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
| `view` | `"grid"` for tiles; `display = { columns = 8 }` sets the width. |
| `display` | `{ detail = true }` opens the palette with the detail pane showing; `{ columns = N }` for a grid. |
| `filter` | A list of `{ id, name }`: a scope dropdown, `Tab` cycles it, the chosen id reaches the script as `PAL_FILTER`. The first is the default. |
| `requires` | Binaries that must be on PATH, a vertical bar between alternatives (`["jq", "gh\|glab"]`). The palette is skipped when one is missing. |
| `os` | `"macos"` or `"linux"`: skipped elsewhere. |

The v1 file's `[general] env_file = "..."` names a `.env`-style file whose
variables every script gets.

## The script protocol

`command list` runs for a listing. For an `input` palette the query is on
stdin and in `PAL_QUERY`, on every keystroke; otherwise stdin is empty
(the null device) and there is no query. The chosen filter is `PAL_FILTER`. Stdout is JSON
lines: one object per row, blank lines skipped, lines that are not a JSON
object dropped. Stderr goes to pal's log.

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
| `action` | `pick` (run `command pick`), `copy`, `open`, `cmd` (run the value with `bash -c`, the row's variables set), `type` (paste the value into the app in front; Accessibility on macOS, see [Palettes](palettes.md)), or the name of a v1 action plugin under `plugins/actions/<name>` next to the config or in `v1_repo`. Default `pick`. |
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
start. `live` palettes still relist on every show. `⌘R` (Refresh) runs the
script regardless.

A table without `ttl` takes the extension's `ttl` setting when that is
above 0.

## `preview`: lazy detail

A row of a script palette can carry `preview`, a shell command. It runs
only when the detail pane is open and the cursor has rested on the row;
its stdout becomes the pane's markdown, and the row's variables are set as
for `pick`. At most `preview_max` (default 4) run at once, each with a 10
second limit; the answer is cached per row until the palette lists again.
`preview_max = 0` turns previews off. Data-file rows never run previews.

## Settings

`[extensions.scripts]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.config/pal/config.toml` | The file whose `[palette.<name>]` tables become palettes. |
| `skip` | list | `["combine", "pals", "apps", "bookmarks", "calc", "emoji", "clipboard"]` | Table names not to load, because a bundled extension covers them. |
| `v1_repo` | path | `~/proj/pal-v1` | Where `github:zcag/pal/...` bases resolve when v1's plugin cache has no copy. |
| `timeout` | seconds, 1 to 300 | `30` | A `list` or `pick` still running after this is killed. |
| `preview_max` | 0 to 32 | `4` | How many `preview` commands run at the same time. 0 turns previews off. |
| `ttl` | seconds, 0 to 604800 | `0` | Listing lifetime for tables that declare no `ttl`. 0 runs every script on every start. |

`config`, `skip`, `v1_repo` and `ttl` are read when the extension loads;
after changing them, Settings > Restart extension host. `timeout` and
`preview_max` apply to the next run.
