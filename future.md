# Future Ideas

## Palettes

### Development
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `ssh` | SSH hosts from ~/.ssh/config | Builtin (parse config) |
| `tmux` | Sessions - attach/create/kill | Bash (tmux ls) |
| `docker` | Containers - start/stop/exec/logs | Bash (docker ps) |
| `k8s` | Pods/services/deployments | Bash (kubectl) |
| `git-branches` | Checkout branches | Bash (git branch) |
| `git-stash` | Apply/pop/drop stash entries | Bash (git stash list) |
| `git-log` | Commits - cherry-pick/revert/show | Bash (git log) |
| `projects` | Project dirs - cd/open in editor | Bash (find ~/proj) |
| `ports` | Listening ports - kill process | Builtin (netstat/ss) |
| `env` | Environment variables - copy | Builtin (env) |

### Productivity
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `pass` | password-store entries | Bash (pass ls) |
| `bitwarden` | Vault entries via bw cli | Bash (bw list items) |
| `notes` | Search markdown/obsidian notes | Builtin (ripgrep) |
| `snippets` | Code snippets - copy | Autolist (JSON data) |
| `todo` | Todo list management | Bash (todoist/taskwarrior) |
| `calendar` | Calendar events | Bash (khal/calcurse) |
| `contacts` | Contact lookup | Bash (khard/abook) |
| `mail` | Recent emails | Bash (notmuch/mu) |

### Reference
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `man` | Man pages - open on pick | Bash (man -k) |
| `tldr` | Tldr pages | Bash (tldr --list) |
| `emoji` | Emoji picker | Autolist (JSON data) |
| `http` | HTTP status codes | Autolist (JSON data) |
| `cheatsheet` | Various cheatsheets | Autolist (JSON data) |
| `keybinds` | Search keybindings | Bash (parse config) |
| `aliases` | Shell aliases - run/copy | Bash (alias) |
| `history` | Shell history - rerun | Bash (fc -l) |

### System
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `power` | Shutdown/reboot/suspend/lock | Bash (systemctl) |
| `brightness` | Screen brightness | Bash (brightnessctl) |
| `displays` | Display configuration | Bash (xrandr/wlr-randr) |
| `vpn` | VPN connections | Bash (nmcli/wg) |
| `mounts` | Mount points - unmount | Builtin (/proc/mounts) |
| `trash` | Trash - restore/delete | Bash (trash-cli) |
| `cron` | Cron jobs | Bash (crontab -l) |
| `packages` | Installed packages | Bash (pacman/apt) |
| `updates` | Available updates | Bash (checkupdates) |
| `logs` | System logs | Bash (journalctl) |
| `notifications` | Notification history | Bash (dunstctl/swaync) |

### Media & Files
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `media` | Player control - play/pause/next | Bash (playerctl) |
| `screenshots` | Recent screenshots | Bash (find) |
| `downloads` | Recent downloads | Bash (find ~/Downloads) |
| `wallpaper` | Set wallpaper | Bash (swww/feh) |
| `fonts` | Font picker | Bash (fc-list) |
| `colors` | Color picker - copy hex/rgb | Autolist (JSON data) |

### Utilities
| Palette | Description | Implementation |
|---------|-------------|----------------|
| `calc` | Calculator - eval expressions | Builtin (bc/python) |
| `timezones` | Time in different zones | Builtin (chrono) |
| `units` | Unit converter | Bash (units) |
| `dns` | DNS lookup | Bash (dig/host) |
| `ip` | Public/local IP info | Bash (curl/ip) |

---

## Frontends

### Terminal
| Frontend | Description | Notes |
|----------|-------------|-------|
| `fzf-tmux` | fzf in tmux popup | `fzf-tmux -p` |
| `skim` | Rust fzf alternative | Drop-in replacement |
| `peco` | Another fuzzy finder | Simpler than fzf |

### Wayland
| Frontend | Description | Notes |
|----------|-------------|-------|
| `wofi` | Wayland rofi | Native wayland |
| `fuzzel` | Fast wayland launcher | Minimal, fast |
| `bemenu` | Wayland dmenu | Simple |
| `tofi` | Tiny rofi alternative | Very minimal |
| `walker` | GTK4 launcher | Modern look |

### X11
| Frontend | Description | Notes |
|----------|-------------|-------|
| `dmenu` | Classic suckless | Minimal |

### Desktop Integration
| Frontend | Description | Notes |
|----------|-------------|-------|
| `ulauncher` | Plugin-based launcher | Has own ecosystem |
| `albert` | C++/Qt launcher | Fast |
| `zenity` | GTK dialogs | Simple lists |
| `kdialog` | KDE dialogs | KDE integration |
| `yad` | Yet another dialog | More features than zenity |

### Widget/Bar
| Frontend | Description | Notes |
|----------|-------------|-------|
| `eww` | Eww widget popup | Custom styling |
| `ags` | AGS widget | JavaScript config |
| `waybar` | Waybar custom module | Status bar integration |

### Programmatic
| Frontend | Description | Notes |
|----------|-------------|-------|
| `json` | Raw JSON output | For piping/scripting |
| `notify` | Show as notification | Quick info display |
| `clipboard` | Copy first item | Non-interactive |

### Advanced
| Frontend | Description | Notes |
|----------|-------------|-------|
| `telescope` | Neovim telescope | Editor integration |
| `tui` | Custom ratatui TUI | Full control |
| `web` | Local web interface | REST API + browser |
