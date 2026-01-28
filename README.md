# Pal

A fast, extensible command palette for Linux. Launch apps, switch windows, control audio, manage clipboard, and more - all from a unified interface.

```
pal run fzf apps      # launch applications
pal run rofi pals     # pick a palette to run
pal run fzf combine   # combined view of multiple palettes
```

## Features

- **Builtin palettes** - Apps, bookmarks, processes, and more - no external dependencies
- **Builtin frontends** - fzf, rofi, and stdin work out of the box
- **Plugin system** - Extend with bash, python, or any language
- **Layered config** - Defaults + user config + project config + env vars
- **Icon support** - Show icons in rofi and other frontends
- **Combine palettes** - Merge multiple palettes into one view

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

# Show loaded configuration
pal show-config
```

## Builtin Palettes

| Palette | Description |
|---------|-------------|
| `apps` | List and launch desktop applications |
| `bookmarks` | Browser bookmarks (Firefox/Chrome) |
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

For simple palettes, use a JSON lines file:

```json
{"id": "1", "name": "List files", "icon": "terminal", "cmd": "ls -la"}
{"id": "2", "name": "Git status", "icon": "git", "cmd": "git status"}
```

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

Create custom actions as plugins in `plugins/actions/`:

```bash
# plugins/actions/copy/run.sh
run() {
  cat | wl-copy
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `_PAL_CONFIG` | Path to current config file |
| `_PAL_CONFIG_DIR` | Directory of current config file |
| `_PAL_FRONTEND` | Current frontend name |
| `_PAL_PLUGIN_CONFIG` | JSON config for current plugin |

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

- [ ] `pal update` to update remote plugins
- [ ] Prompt support (text input, choice, etc.)
- [ ] Caching for slow palettes
- [ ] `pal doctor` for config validation
- [ ] REST API frontend
- [ ] More builtin palettes (calendar, OTP, etc.)

## Disclaimer

This is a rewrite of my personal bash spaghetti that I implemented over the years, covering many palettes and frontends for various stuff. Inspired by [Raycast](https://raycast.com/) - an awesome macOS Spotlight alternative that's also quite customizable. Many of the custom palettes here are ported from my custom Raycast plugins after I left macOS.

This is also an experiment for myself on Rust and AI-assisted coding. I have minimal Rust knowledge, and this is my first time properly using an AI agent for development. [Claude Code](https://claude.ai/claude-code) was heavily used in this project - it straight up implemented a ton of the palettes based on my descriptions and reference bash scripts from the original pal.

## License

MIT
