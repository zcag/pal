# Pal

A fast, extensible command palette for Linux. Launch apps, switch windows, control audio, manage clipboard, and more - all from a unified interface.

```
pal run fzf apps      # launch applications
pal run rofi pals     # pick a palette to run
pal run fzf combine   # combined view of multiple palettes
```

## Features

- **Builtin palettes** - Apps, bookmarks, SSH hosts, processes, and more
- **Builtin frontends** - fzf, rofi, and stdin work out of the box
- **Plugin system** - Extend with bash, python, or any language
- **Layered config** - Defaults + user config + project config + env vars
- **Icon support** - XDG icons for rofi, UTF/Nerd Font icons for terminal frontends
- **Combine palettes** - Merge multiple palettes into one view
- **Input palettes** - Text input mode with live results (calculator, eval, etc.)
- **Prompts** - Ask for user input on pick, usable from plugins and standalone scripts
- **Caching** - Pre-computed display for fast startup on heavy palettes

## Installation

```bash
cargo install rpal
```

Requires Rust 1.70+ ([rustup](https://rustup.rs/))

## Quick Start

```bash
# Initialize config at ~/.config/pal/config.toml
pal init

# Run with default palette and frontend
pal

# Run specific palette with specific frontend
pal run rofi apps

# List items without frontend (useful for debugging)
pal list apps

# Prompt user for input
pal prompt '{"message": "Enter hostname"}'

# Run an action on a value
echo "hello" | pal action copy

# List installed remote plugins
pal plugins

# Update all remote plugins
pal update

# Show loaded configuration
pal show-config
```

## Builtin Palettes

| Palette | Description |
|---------|-------------|
| `apps` | List and launch desktop applications |
| `bookmarks` | Browser bookmarks (Firefox/Chrome) |
| `ssh` | SSH hosts from `~/.ssh/config` |
| `pals` | List and run other palettes |
| `psg` | List and kill processes |
| `combine` | Combine multiple palettes into one |

## Builtin Frontends

| Frontend | Description |
|----------|-------------|
| `fzf` | Terminal fuzzy finder |
| `rofi` | Desktop launcher with icons |
| `stdin` | Simple numbered list selection |

## Configuration

Config is loaded in order (later overrides earlier):

1. Built-in defaults
2. `pal.default.toml` (in current directory)
3. `~/.config/pal/config.toml` (user config)
4. `pal.toml` (in current directory)
5. `-c <path>` (CLI argument)
6. `PAL_*` environment variables

### Example Config

```toml
[general]
default_palette = "combine"
default_frontend = "fzf"

[palette]
  [palette.combine]
  base = "builtin/palettes/combine"
  icon = "view-grid"
  include = ["pals", "quickcmds"]

  [palette.quickcmds]
  icon = "utilities-terminal"
  auto_list = true
  auto_pick = true
  data = "~/.config/pal/commands.json"
  default_action = "cmd"
  action_key = "cmd"

  [palette.audio]
  base = "~/.config/pal/plugins/audio"
  icon = "audio-card"
```

### Data Files (auto_list)

For simple palettes, use a JSON lines file or a JSON array:

```json
{"name": "List files", "icon": "terminal", "cmd": "ls -la"}
{"name": "Git status", "icon": "git", "cmd": "git status"}
```

```json
[
  {"name": "List files", "icon": "terminal", "cmd": "ls -la"},
  {"name": "Git status", "icon": "git", "cmd": "git status"}
]
```

TOML is also supported. Use an array-of-tables with any key name:

```toml
[[items]]
name = "List files"
icon = "terminal"
cmd = "ls -la"

[[items]]
name = "Git status"
icon = "git"
cmd = "git status"
```

Point `data` at a `.toml` file and pal will parse it automatically:

```toml
[palette.quickcmds]
auto_list = true
auto_pick = true
data = "~/.config/pal/commands.toml"
default_action = "cmd"
action_key = "cmd"
```

> **Tip:** For syntax highlighting of the `cmd` fields, name your file with a
> compound extension like `commands.bash.toml`. The
> [zcag/nvim-dek](https://github.com/zcag/nvim-dek) plugin uses the inner
> extension to highlight embedded languages within TOML string values.

The `id` field is optional and defaults to `name` if missing.

### Icons

Items and palettes support three icon types, used by different frontends:

| Field | Used by | Example |
|-------|---------|---------|
| `icon_xdg` | rofi (freedesktop icon names) | `utilities-terminal` |
| `icon_utf` | fzf (UTF-8/Nerd Font glyphs) | `󰆍` |
| `icon` | Fallback for either | `terminal` |

Rofi prefers `icon_xdg`, fzf prefers `icon_utf`, both fall back to `icon`. Character icons (non-ASCII) are rendered inline, while XDG icon names are shown as images in rofi.

Set a palette-level icon in config, and it applies to all items that don't have their own:

```toml
[palette.cmds]
icon_xdg = "utilities-terminal"
icon_utf = "󰆍"
```

## Input Palettes

Input palettes accept text input instead of filtering a static list. The query is passed to the plugin's `list` command via stdin, and the plugin returns items based on it.

```toml
[palette.calc]
base = "github:zcag/pal/plugins/palettes/calc"
input = true
input_prompt = "Calculate"
```

| Field | Description |
|-------|-------------|
| `input` | Enable text input mode |
| `input_prompt` | Custom prompt message (defaults to palette name) |

**fzf** reloads results live as you type using `--bind change:reload`. **rofi** uses script mode - type a query, press Enter to see results, then select. Other frontends use a two-step prompt then select flow.

The plugin's `list` command receives the query on stdin:

```bash
list() {
  query=$(cat)
  if [[ -z "$query" ]]; then
    echo '{"name":"Type an expression..."}'
    return
  fi
  result=$(qalc -t "$query" 2>/dev/null)
  echo "{\"name\":\"$query = $result\",\"result\":\"$result\"}"
}
```

## Prompts

Prompts let you collect user input before or during pick. There are two mechanisms:

### Item-level prompts

Add a `prompts` array to any item. When the item is picked, each prompt is shown to the user via the active frontend. Collected values are substituted into `{{key}}` placeholders in all item fields and injected as `PAL_<KEY>` env vars.

```json
{"name": "SSH Tunnel", "cmd": "ssh -L {{port}}:localhost:{{port}} {{host}}", "prompts": [
  {"key": "host", "message": "Hostname"},
  {"key": "port", "message": "Local port"}
]}
```

This works in data files, plugin output, and through the combine palette.

#### Prompt types

| Type | Description | Extra fields |
|------|-------------|--------------|
| `text` | Free text input (default) | |
| `choice` | Select from a list | `options`: array of strings |

```json
{"name": "Encrypt", "cmd": "gpg -c --cipher-algo {{algo}} file", "prompts": [
  {"key": "algo", "message": "Algorithm", "type": "choice", "options": ["AES256", "TWOFISH", "CAMELLIA256"]}
]}
```

### `pal prompt` command

Prompt the user directly from any script - plugin pick scripts, custom scripts, or anywhere. Uses the same prompt spec format.

```bash
# Text prompt
host=$(pal prompt '{"message": "Hostname"}')

# Choice prompt
algo=$(pal prompt '{"message": "Algorithm", "type": "choice", "options": ["AES256", "TWOFISH"]}')

# Multiple prompts - returns JSON object
result=$(pal prompt '[{"key": "host", "message": "Host"}, {"key": "port", "message": "Port"}]')
# → {"host": "myserver", "port": "8080"}

# From stdin
cat prompts.json | pal prompt
```

When called inside a pal flow (e.g., from a plugin pick script), it uses the current frontend (`_PAL_FRONTEND`). When called standalone, it uses the config default.

Example plugin pick script using `pal prompt`:

```bash
pick() {
  item=$(cat)
  host=$(pal prompt '{"message": "Hostname"}')
  [ -z "$host" ] && exit 0
  ssh "$host"
}
```

## Caching

For palettes with expensive list operations (like combine with many sub-palettes), enable caching to pre-compute the frontend display:

```toml
[palette.combine]
base = "builtin/palettes/combine"
include = ["apps", "bookmarks", "cmds"]
cache = true
```

On first run, items are listed, formatted, and cached at `~/.cache/pal/`. Subsequent runs read directly from cache and regenerate in the background for next time. Currently supported for the rofi frontend.

## Plugin Development

Plugins are directories with a `plugin.toml` and an executable.

### plugin.toml

```toml
name = "my-palette"
desc = "Description of my palette"
version = "0.1"
command = ["run.sh"]
```

### run.sh

```bash
#!/usr/bin/env bash

list() {
  echo '{"id":"1","name":"Item 1","icon":"folder"}'
  echo '{"id":"2","name":"Item 2","icon":"file"}'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')
  echo "Selected: $id"
}

case "$1" in
  list) list ;;
  pick) pick ;;
esac
```

### Plugin Config Access

Plugins receive their config via environment variable:

```bash
# In your plugin
cfg=$(echo "$_PAL_PLUGIN_CONFIG" | jq -r '.my_setting')
```

## Remote Plugins

Load plugins directly from GitHub repositories:

```toml
[palette.ip]
base = "github:zcag/pal/plugins/palettes/ip"

# With specific branch or tag
[palette.ip]
base = "github:zcag/pal/plugins/palettes/ip@v1.0"

# Data files also support github: URLs
[palette.colors]
base = "github:zcag/pal/plugins/palettes/colors"
data = "github:zcag/pal/plugins/palettes/colors/data.json"
```

Plugins are cloned on first use to `~/.local/share/pal/plugins/` using git sparse checkout. Requires git to be installed.

## Example Plugins

The [`plugins/`](plugins/) directory contains ready-to-use plugins. Use them directly via GitHub:

```toml
[palette.audio]
base = "github:zcag/pal/plugins/palettes/audio"
```

| Plugin | Description |
|--------|-------------|
| `audio` | Switch audio output devices (PipeWire/PulseAudio) |
| `clipboard` | Clipboard history (cliphist/clipman) |
| `wifi` | Connect to WiFi networks (nmcli) |
| `windows` | Focus windows (Hyprland/Sway/X11) |
| `systemd` | Manage systemd services |
| `ble` | Connect Bluetooth devices |
| `hue` | Control Philips Hue scenes |
| `repos` | Browse GitHub repositories (gh cli) |
| `chars` | Unicode character picker |
| `icons` | Freedesktop icon picker |
| `nerd` | Nerd Font icon picker |
| `emoji` | Emoji picker |
| `colors` | Color picker (hex/rgb/hsl) |
| `calc` | Calculator (qalc/bc) |
| `ip` | Network info (public/local IP, gateway, DNS) |
| `docker` | Docker container management |
| `op` | 1Password items |
| `media` | Media player control (playerctl) |
| `power` | Power menu (shutdown, reboot, etc.) |

## Actions

Actions define what happens when an item is picked with `auto_pick`:

```toml
[palette.commands]
auto_list = true
auto_pick = true
data = "commands.json"
default_action = "cmd"    # run as shell command
action_key = "cmd"        # field containing the command
```

### Built-in Actions

| Action | Description |
|--------|-------------|
| `cmd` | Execute the value as a shell command |
| `copy` | Copy value to clipboard (wl-copy/xclip/pbcopy) with notification |
| `open` | Open value with xdg-open/open |

Actions are resolved locally first (`plugins/actions/` in config dir), then fetched from GitHub as a fallback.

### Item Environment Variables

When an item is picked, all its JSON keys are injected as `PAL_<KEY>` environment variables into the action process:

```json
{"name": "Red", "hex": "#ff0000", "rgb": "255,0,0"}
```

```bash
# Available in your action script:
echo $PAL_NAME  # Red
echo $PAL_HEX   # #ff0000
echo $PAL_RGB   # 255,0,0
```

This works for both `auto_pick` actions and plugin-based palettes.

### Custom Actions

Create custom actions as plugins in `plugins/actions/`:

```bash
# plugins/actions/notify/run.sh
run() {
  notify-send "$PAL_NAME" "$PAL_DESCRIPTION"
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `_PAL_CONFIG` | Path to current config file |
| `_PAL_CONFIG_DIR` | Directory of current config file |
| `_PAL_PALETTE` | Current palette name |
| `_PAL_FRONTEND` | Current frontend name |
| `_PAL_PLUGIN_CONFIG` | JSON config for current plugin |
| `PAL_<KEY>` | Item key-value pairs injected on pick (e.g. `PAL_NAME`, `PAL_HEX`) |

## Tips

### Combine for a unified launcher

```toml
[palette.launcher]
base = "builtin/palettes/combine"
include = ["apps", "bookmarks", "quickcmds"]
```

### Different frontends for different contexts

```bash
# Terminal
alias p="pal run fzf"

# Desktop (bind to hotkey)
pal run rofi combine
```

### Project-specific palettes

Create `pal.toml` in your project:

```toml
[palette.project]
auto_list = true
data = "scripts.json"
default_action = "cmd"
action_key = "cmd"
```

## Roadmap

- [ ] capability system between palettes (or items of palettes) and fe's
- [ ] hotlink support. `pal://run?fe=rofi?palette=commands?item="confetti"`
- [ ] `pal integrate xdg` for registering hotlink
- [ ] `pal doctor` for config validation
- [ ] REST API frontend

## Disclaimer

This is a rewrite of my personal bash spaghetti that I implemented over the years, covering many palettes and frontends for various stuff. Inspired by [Raycast](https://raycast.com/) - an awesome macOS Spotlight alternative that's also quite customizable. Many of the custom palettes here are ported from my custom Raycast plugins after I left macOS.

This is also an experiment for myself on Rust and AI-assisted coding. I have minimal Rust knowledge, and this is my first time properly using an AI agent for development. [Claude Code](https://claude.ai/claude-code) was heavily used in this project - it straight up implemented a ton of the palettes based on my descriptions and reference bash scripts from the original pal.

## License

MIT
