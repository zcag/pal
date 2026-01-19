# pal

Extensible command palette for Linux/macOS.

## Install

```bash
pip install -e .
```

## Usage

```bash
pal run                    # default frontend + default palette
pal run rofi               # rofi + default palette
pal run rofi apps          # rofi + apps palette
pal run fzf commands       # fzf + commands palette
```

## Config

User config: `~/.config/pal/config.yaml`

```bash
pal where        # show config path
pal defaults     # show default config
pal config-show  # show resolved config
```

## Palettes

- **combine** - aggregates other palettes
- **palettes** - list and run other palettes
- **apps** - installed applications (Linux .desktop / macOS .app)
- **commands** - custom shell commands from config

## Frontends

- **fzf** - terminal fuzzy finder
- **rofi** - X11/Wayland launcher (with icons)

## Roadmap
- [ ] packaging/distribution
- [ ] json input for palettes (starting with commands)
- [ ] Custom external palettes (executable contract)
- [ ] Define custom frontends from builtins with custom config
- [ ] Define custom palettes from builtins with custom config
- [ ] Caching layer for slow palettes
- [ ] (?) ultra strict caching for rofi for instant load, to have instant keymap open
- [ ] capabilities list for fe/palette
- [ ] pal doctor, checking config/capabilities for palettes/frontends
- [ ] Prompt support
    - [ ] raw text input
    - [ ] choice
    - [ ] yes/no
- [ ] Frecency sorting
- [ ] More builtin palettes
    - [ ] Audio output devices
    - [ ] Bookmarks palette (browser bookmarks)
    - [ ] Clipboard history palette
    - [ ] Wifi
    - [ ] BLE
    - [ ] chars, list special characters -> copy clipboard
    - [ ] icons, nerdfont icons
    - [ ] windows - focus/move to current w selected win
- [ ] non-builtin plugin palettes
    - [ ] restart/status selected systemd service
    - [ ] psg
    - [ ] OTP codes selector
    - [ ] browser-apps -> focus toggle on preset browser tabs
    - [ ] Cal events
    - [ ] Hue room/presets/scenes
    - [ ] Hue sync control -> set bri/mode/area/instensity/onoff
- [ ] More frontends
    - [ ] simple stdin/stdout
    - [ ] (?) rest
    - [ ] (?) dmenu/wofi
- [ ] Better readme with usages
- [ ] (?) Plugin management
