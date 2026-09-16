# Scripts and data files

The zero-code tier. A palette can be a data file (json, jsonl or toml) or
a shell script that prints JSON lines, described by a small TOML table. No
TypeScript. The extension reads those tables from a pal v1 style config
file and turns each `[palette.<name>]` into a palette named after its
table, with the config id `scripts-<name>`. It also runs **script
commands**: single executable files with a `# @pal.title` header, one row
each in the Script Commands palette (`scripts-commands`). The full format
is in [docs/scripts.md](../../docs/scripts.md); this is the short version.

## A script command

```bash
#!/usr/bin/env bash
# @pal.title Deploy site
# @pal.icon 🚀
# @pal.mode hud
# @pal.confirm true
# @pal.args target Environment: staging or prod
echo "Deployed to $1"
```

`chmod +x` it and put it in `~/.config/pal/commands/` (the `commands`
setting; the folder is watched). Enter runs it, a form first when it has
`args`; `hud` shows the first output line in the HUD, `silent` nothing,
`show` the whole output as a level, `list` its JSON-lines output as rows
(a row with `url` opens, one with `copy` copies, another runs the script
again with `PAL_PICK`), `inline` its first line as the row's subtitle,
refreshed every `@pal.refresh`. `@pal.keyword`, `@pal.section`,
`@pal.cwd` and an icon that is an emoji, a glyph, a hex, a brand colour, an
image next to the script or a url. Raycast's `@raycast.*` headers are
accepted as they are, so a Raycast script command drops in unchanged.
`cmd+o` opens the file, `cmd+c` copies its output, `cmd+shift+c` its
path. Two examples are in `examples/commands/`.

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

`links.json` is a JSON array (or one object per line, or a TOML file
whose first top-level array is the rows). Every row is an item: `name` is
the title, `id` defaults to `name`; `subtitle`, `keywords`, `section`,
`url` (a favicon when there is no icon), `accessories`, `detail` and
`icon_utf` are what they say. The table's `actions` apply to every row.
Without `actions`, `auto_pick = true` with `default_action` (`copy`,
`open`, `cmd`, `type`) and `action_key` gives one built-in action.

## A script palette

```toml
[palette.hosts]
base = "plugins/hosts"    # the directory holding run.sh
requires = ["awk"]        # skipped when the binary is missing
ttl = 3600                # reuse a listing for an hour
```

`run.sh list` prints one JSON object per line (the row fields above, plus
`preview`, a shell command whose stdout becomes the detail pane's
markdown, run lazily). `run.sh pick` gets the picked row as JSON on stdin
and every field as `PAL_<KEY>` in the environment (`PAL_ID`, `PAL_NAME`,
`PAL_ACTION`, `PAL_FILTER`), and prints a result envelope: `clipboard`,
`open`, `toast`, `hud`, `show` (a read-only level), `palette` (drill into
another script palette with `env`), `reload`. No envelope hides the panel.

Table keys: `input` (list on every keystroke, the query on stdin and in
`PAL_QUERY`), `input_prompt`, `live` (list on every show), `ttl`, `view =
"grid"`, `display = { detail = true, columns = 8 }`, `filter` (a scope
dropdown, the id in `PAL_FILTER`), `requires`, `os`, `command` (instead of
`run.sh`). A `plugin.toml` in `base` may carry the same keys. `base` may
also be `github:<user>/<repo>/<path>` from v1's plugin cache.

## Keyboard

What a row does is the table's: the first action (or the `primary` one)
runs on `enter`, the second on `cmd+enter`, every action from `cmd+k` with
the `shortcut` it declares. With no actions at all a script palette's row
is Select, which runs `run.sh pick`.

| keys | action |
| --- | --- |
| `enter` | The primary action: `open`, `copy`, `cmd`, `type`, or `pick` into the script |
| `cmd+enter` | The second action |
| `cmd+k` | Every action of the row, with its shortcut, style and confirm |
| `cmd+i` | The detail pane: the row's `detail`, or its `preview` command's output |
| `tab` | The next `filter` scope |
| `cmd+r` | Run the script again past any `ttl` |

In Script Commands:

| keys | action |
| --- | --- |
| `enter` | Run the command as its mode says; Open a `list` one; a form first when it has `args` |
| `cmd+o` | Open the script file |
| `cmd+c` | Copy output: run it and copy what it printed |
| `cmd+shift+c` | Copy the file's path |

## Setup

Point `config` at the file that holds the tables. The default is pal's
own config file; pal's parser flags a `palette` table as an unknown key
(the palettes still work), so a file of their own keeps the warning away:

```toml
[extensions.scripts]
config = "~/.config/pal/scripts.toml"
```

Relative paths inside that file (`data`, `base`, `[general] env_file`)
are resolved against its directory; `~` is expanded. Scripts get the
app's PATH plus `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin` and
`/usr/local/bin`. A `type` action pastes into the app in front, which
needs Accessibility on macOS (`wtype` or `ydotool` on Linux).

Settings, `[extensions.scripts]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.config/pal/config.toml` | The file whose `[palette.<name>]` tables become palettes. |
| `skip` | list | `["combine", "pals", "apps", "bookmarks", "calc", "emoji", "clipboard"]` | Table names not to load, because a bundled extension covers them. |
| `v1_repo` | path | `~/proj/pal-v1` | The v1 checkout: where `github:zcag/pal/...` bases resolve when v1's plugin cache has no copy, and where a base under a v1 checkout missing on this box (`~/proj/pal/plugins/...` or `~/proj/pal-v1/plugins/...`) is looked up. `~/proj/pal` is tried when this path has no `plugins/palettes`. |
| `commands` | path | `~/.config/pal/commands` | The folder of single-file script commands, read on every listing and watched. |
| `timeout` | seconds, 1 to 300 | `30` | A `list` or `pick` still running after this is killed. |
| `preview_max` | 0 to 32 | `4` | How many `preview` commands run at the same time. 0 turns previews off. |
| `ttl` | seconds, 0 to 604800 | `3600` | Listing lifetime for non-live tables that declare no `ttl`; a table's own `ttl` wins. 0 runs every script on every start. |

`config`, `skip`, `v1_repo` and `ttl` are read when the extension loads;
after changing them, Settings > Restart extension host. `timeout`,
`preview_max` and `commands` apply to the next run or listing.

## What it does not do

- v1's `builtin/...` bases: no equivalent, one inert row says so.
- Raycast icon names (`icon_rc`): dropped; use `icon_utf`, `icon` or
  `icon_xdg`.
- Metadata separators in `detail`: no equivalent, left out.
- Run a `list` or `pick` past `timeout`: it is killed with its process
  group and counts as failed.
- Watch the config: a new table shows after Restart extension host (the
  commands folder is watched; the v1 config is not).
- Confirm a script command that takes arguments: its form is the
  confirmation.

## Platforms

macOS and Linux. A table with `os = "macos"` or `"linux"` is skipped
elsewhere; `requires` gates on binaries on PATH the same way on both.
