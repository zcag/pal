# Future Ideas

## Planned

| Item | Type | Description |
|------|------|-------------|
| `calendar` | palette | Calendar events via khal/calcurse |
| `mail` | palette | Recent emails via notmuch/mu |
| `brightness` | palette | Screen brightness control |
| `vpn` | palette | VPN connections (nmcli/wg/fortivpn) |
| `notifications` | palette | Notification history (dunstctl/swaync) |
| `screenshots` | palette | Recent screenshots - view/copy/delete |
| `clipboard` | palette | Clipboard history (cliphist/clipman) |
| `calc` | palette | Calculator with live qalc preview |
| `colors` | palette | Color picker - hex/rgb/hsl |
| `ip` | palette | Public/local IP, network info |
| `tui` | frontend | Custom ratatui TUI |
| `web` | frontend | Local web interface + REST API |

---

## More Ideas

### Palettes

**Integrations**
- `homeassistant` - Control HA entities (lights, switches, scenes)
- `spotify` - Spotify playlists, search, queue management via spotifyd/spotify-tui
- `mpd` - MPD library browser and playlist control
- `kdeconnect` - Phone notifications, send files, ring phone
- `syncthing` - Folder status, conflicts, pause/resume

**Dev Tools**
- `gh-notifications` - GitHub notifications - mark read, open
- `gh-prs` - Your open PRs across repos - open, checkout
- `gh-issues` - Assigned issues - open, close, comment
- `jira` - Your jira tickets - transition, open
- `linear` - Linear issues
- `aws` - AWS profiles, regions, quick console links
- `kubectl-ctx` - Kubernetes context/namespace switcher

**Launchers**
- `recent` - Recently opened files (via tracker/zeitgeist)
- `frecency` - Most used apps/commands (learn from usage)
- `web-search` - Quick search Google/DDG/GitHub with query
- `translate` - Quick translate via translate-shell

**System**
- `inhibit` - Manage sleep/screen inhibitors
- `usb` - USB devices - mount/eject/info
- `displays` - Monitor arrangement, resolution, refresh rate
- `gamma` - Color temperature (gammastep/redshift)
- `audio-apps` - Per-app volume control (pavucontrol-like)

**Files**
- `zoxide` - Zoxide frecent directories
- `marks` - Shell bookmarks/marks (like bashmarks)
- `trash` - Trash management - restore/delete/empty

### Frontends

- `dmenu` - Classic suckless dmenu
- `fuzzel` - Fast wayland launcher
- `bemenu` - Wayland dmenu clone
- `eww` - Eww widget popup
- `ags` - AGS widget system
- `telescope` - Neovim telescope picker

### Actions

- `open` - xdg-open wrapper
- `term` - Run in new terminal
- `notify` - Show as notification
- `type` - Type via wtype/xdotool (for password managers)
- `qr` - Show as QR code
