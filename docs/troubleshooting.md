# Troubleshooting

What to look at when something does not work, and what pal itself can
tell you. Paths and messages below are the code's; where a line quotes
one, that is the exact text to search for.

## The log

Every line pal and its extension host print is tab-separated stderr:
`component<TAB>message`, one per line, no timestamps except the start
line (`log <path> start at unix <seconds>`). Started from a terminal
those lines are on the terminal; started from the Dock, the menu bar, a
LaunchAgent or a keybind, pal points stderr at a file:

- macOS: `~/Library/Logs/pal/pal.log`
- Linux: `$XDG_STATE_HOME/pal/pal.log`, else `~/.local/state/pal/pal.log`
- either, with `$XDG_DATA_HOME` set: `$XDG_DATA_HOME/pal/pal.log`

The extension host inherits the same file descriptor, so its lines land
in the same file in order, prefixed `[host]`
(`[host] loaded emoji (emoji) from <root> in 12.3ms`,
`[host] failed <name>: <message>`). Past 5 MB the file is renamed
`pal.log.1` at the next start. `tail -f` it while you reproduce the
problem. The components worth grepping: `host` (spawn, ready, exit),
`index` (every listing, `list failed`, `lazy, waits for a show`,
`fresh` against a `ttl`), `hotkey`, `updater`, `bar`, `secrets`,
`migrate`, `config`, `env` (the PATH probe), `autostart`.

A `pal <command>` from a shell keeps its own stderr on the terminal: a
refused link prints there and exits 2; what happens after the handover is
in the running instance's log and on the HUD.

## Copy Diagnostics

The root row **Copy Diagnostics** (`pal://commands/diagnostics`, also on
Settings › About) puts one block on the clipboard:

```text
pal 0.1.0
os: macos 15.6 arm64
config: /Users/you/.config/pal/config.toml (profile default)
data: /Users/you/Library/Application Support/pal/default
log: /Users/you/Library/Logs/pal/pal.log
extensions: 54 loaded: apps, bookmarks, ...; 1 failed: hello
hotkey: ctrl+space registered
accessibility: granted
theme: system
```

**Report a Bug** opens a GitHub issue with the same block filled in.
Settings › About adds the state of every permission and the last crash
report and Rust panic (`<data dir>/<profile>/last-panic.txt`), each with
Open, Reveal and Copy Path; "pal restarted after a crash" on the HUD
means the service manager brought it back ([Config](config.md#crash-relaunch)).

## Permissions on macOS

Settings › General › Permissions lists all five with a dot and a Grant
button; the Overview lists the missing ones nothing else will ask for
(Accessibility, Full Disk Access, Input Monitoring once expansion is on,
Calendars and Location once refused). Each is a switch under System
Settings › Privacy & Security. Nothing is asked at launch: the first
feature that needs one puts a card in the panel saying what pal does with
it, and Grant shows the system prompt (macOS shows it once per app; after
that Grant opens the pane, where the switch is).

| permission | what needs it | how pal asks | when it is missing |
| --- | --- | --- | --- |
| Accessibility | paste into the app in front (Clipboard History, Snippets, `pal paste`, `pal action type`), window focus, close, minimise and layouts, the selected text, Menu Bar Items, "Use in dialog", snippet expansion | a card in the panel the first time a paste, a layout, a window switch or the selected text is refused ("Paste needs Accessibility": what pal does with it, Grant for the system prompt), once per run; the Welcome row and Settings whenever pressed. Never at launch | after the card, a toast "Paste needs Accessibility" (or "Window layout", "Use in dialog") naming the switch; focus falls back to activating the app with "Switched to `<app>`; per-window switching needs Accessibility" on the HUD; Menu Bar Items is one row saying so |
| Input Monitoring | a bar peek closing on the next key press; snippet expansion (`[extensions.snippets] expand`); keycast; the app switcher's `cmd+tab` | a card when expansion is switched on, keycast starts or a `cmd+tab` chord is configured (a config reload; at startup the Overview lists it instead), or from Settings; the bar never asks | the peek stays until the pointer leaves; expansion does not see keys |
| Location Services | Wi-Fi network names (macOS 15 and later show them only to an app with it) | the first time the Wi-Fi palette lists while you are inside it (a listing at startup or on a show is held back: `permissions<TAB>location<TAB>skipped` in the log), or Enter on its "Wi-Fi names need Location access" row | rows read "name hidden by macOS without Location access" and that row opens the pane |
| Calendars | the Calendar extension | the extension's "Grant calendar access" row | "Calendar access denied" with a row that opens the pane |
| Full Disk Access | Verification Codes (Messages' database), Safari bookmarks, the Trash count on Empty Trash | there is no prompt: the row opens the pane and you add pal by hand | "Full Disk Access needed" as the palette's one row; the Safari section is one inert row |

Browser Tabs asks for Automation (an Apple Events prompt per browser)
the first time it drives Safari or Chrome; "Automation permission
needed" is the row when it was refused, and it opens that pane.

**The switch is on and nothing works.** A grant is tied to the app's
code signature, and a release is ad-hoc signed, so every build carries a
new one: after a reinstall the old grant matches nothing. Remove pal from
the list with the minus button and grant it again. A development build
from `make app` is signed with a local `pal-dev` identity for this
reason. pal polls the state every 2 s while one of its windows is open,
so a flipped switch is seen without a restart.

## The hotkey

Settings › General › Hotkey says under each entry whether the OS took it
("Not registered: HotKey already registered" when another app holds
it), and the Overview names the offender it can guess (Raycast, when it
is running). The log has `hotkey<TAB>status<TAB>registered=...`.

**⌘Space opens Spotlight.** The system takes that press before any app,
so it cannot be recorded: use the preset. Settings then says "Spotlight
uses ⌘Space" with a button to System Settings › Keyboard › Keyboard
Shortcuts; untick "Show Spotlight search" under Spotlight there. pal
reads Spotlight's binding from `com.apple.symbolichotkeys` and, while
the key is wanted and held, polls it every 2 s, so the registration
lands a moment after the tick (the log says
`hotkey<TAB>spotlight released`).

**Wayland.** The hotkey only fires while an X11 client has focus. Set
`hotkey = ""` and bind `pal toggle` in the compositor
([Getting started](getting-started.md#linux)).

**A palette or item hotkey does nothing.** The root hotkey wins a clash,
then a palette's, then an item's; the Overview counts them and Settings ›
Palettes shows each with its status.

## 1Password

The 1Password palette drives the `op` CLI, which reaches the vault
through the desktop app: install the CLI (`brew install
1password-cli`), and in 1Password turn on Settings › Developer ›
"Integrate with 1Password CLI". The first call asks you to allow pal;
every later one is a Touch ID (or password) prompt from 1Password. A
terminal's `eval $(op signin)` never reaches pal. Each of these is one
row in the palette, with the fix as its subtitle: "1Password CLI not
installed", "1Password is not running", "1Password did not answer"
(unlock it, then ⌘R), "Connect the 1Password CLI to the app". The
palette is `lazy`, so the prompt comes on the first panel show rather
than at login. The core gives any one listing 10 s; a prompt left
unanswered longer than that fails the listing ("the host did not answer
list within 10 s" in the log), so answer it and press ⌘R.

## PATH, from the Dock

An app launched from the Dock, Finder or a LaunchAgent gets the system's
PATH, not your shell's. At startup pal runs your login shell once
(`$SHELL -l -i -c`, 2 s at most) and adopts its PATH, adding the usual
places (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`,
`~/.cargo/bin`, `~/.bun/bin`, `~/go/bin`) when they exist; the log says
`env<TAB>path from the login shell`. The extension host inherits that
PATH, so an extension that shells out (`gh`, `docker`, `op`, `timer`,
`playerctl`) finds what your terminal finds. It is read once: a tool
installed after pal started wants pal relaunched (a host restart is not
enough). A missing tool is a hint row in the palette ("`<bin>` is not
installed"), never an error in Settings. The Shell palette runs your
login shell itself, so it sees your own PATH either way.

## The extension host

Every extension runs in one Bun process the app spawns (`host<TAB>spawn`,
`host<TAB>ready` in the log). It is restarted by "Reload Extensions" at
the root (`pal reload`, `pal://reload`), "Restart extension host" in the
menu bar icon's menu and under Settings › General › Maintenance, and
after every install, update and remove; a host that exits is respawned
after half a second (`host<TAB>exit`). During the gap a pick fails with
a "Could not open" toast (the action's own name: "Could not copy URL";
"the extension host is restarting; try again in a moment" under it), and
the footer says "updating…" while listings are pending. A
request the host does not answer within 10 s fails with "the host did
not answer `<method>` within 10 s".

An edited extension file is re-imported in place, no restart: the host
watches every root. What does want a restart: `general.extension_dirs`,
`emoji`'s `columns`, the `scripts` extension's `config`, `skip`,
`v1_repo` and `ttl`, 1Password's `vaults`
([Config](config.md#extensionsname)).

An extension that fails to load keeps its place in Settings › Extensions
with a red `failed` tag and the error ("Failed to load. `<error>` Fix
the code and pal reloads it, or restart the host under General"), is one
row on the Overview, and is one row at the root: "`<title>` failed to
load" with the error's first line, under "Needs attention" at the top of
the empty list and found by `failed` or its name; Enter opens its
Extensions page. Nothing is announced on a show: the row is the telling,
and it goes when the extension loads. Its palettes are gone from the
root meanwhile. A manifest that disagrees with the code is a `warning`
tag and loads anyway
([Extensions](extensions.md#where-a-palette-is-described)).

## A palette that lists nothing

In the order to check:

1. **Switched off.** `[palettes.<id>] enabled = false` keeps the palette
   known and lists nothing; Settings › Palettes has the switch. An
   instance that is off says "None while the instance is off."
2. **Needs setup.** A required setting is empty: Settings › Extensions
   shows "Nothing lists until `<label>` is set below" and the Overview
   "`<title>` needs `<setting>`".
3. **Failed to load.** The `failed` tag above; the log has
   `[host] failed <name>: <message>`.
4. **A permission or a tool.** The palette's own rows say so (the tables
   above); the root shows nothing for it.
5. **Lazy.** A palette marked `lazy` lists on the first panel show, not
   at startup; until then the root has last run's cached rows. The log
   says `index<TAB><ext>/<palette><TAB>lazy, waits for a show`.
6. **A cache.** A listing younger than the palette's `ttl` stands
   (`index<TAB>...<TAB>fresh`). `⌘R` inside the palette lists it again
   past the cache (the extension gets `ctx.refresh`); "Refresh Index" at
   the root, or Settings › General › Listings, does every indexed
   palette; "Reload Extensions" restarts the host and re-imports the code.
7. **The listing failed.** `index<TAB><ext>/<palette><TAB>list failed
   <TAB><error>` in the log; the panel shows "Nothing here" with no
   error text.

A root with few extensions loaded says so under the search box and points
at Settings › Extensions.

## Gatekeeper

Releases are ad-hoc signed and not notarised, so macOS refuses the first
launch of a downloaded copy once, with one of three dialogs. pal does
nothing about the quarantine mark itself; the three ways past it are in
[Getting started](getting-started.md#macos), the quickest being
`xattr -dr com.apple.quarantine /Applications/pal.app`. What a signed
release would take is in [Releasing](releasing.md#macos-signing-later).

## The config file

The Settings window shows a strip at the bottom when the file has
problems: an unknown key is a warning with its dotted path (the key is
ignored, so a typo never reaches the real one), a file that does not
parse is an error with its line, and the last good config stays live
meanwhile ([Config](config.md#diagnostics)). A secret reference that
does not resolve (no keychain item, a locked keychain, no `secret-tool`
on Linux) is `secrets<TAB>unresolved` in the log and the extension still
loads with the reference string as its value.

## Updates

"Check for Updates" (the root row, the menu bar icon, Settings › About)
answers on the HUD or as a toast: "pal `<version>` is available",
"pal is up to date", "Nothing to update to: no release published yet",
or "Could not check for updates" with the error. A build that cannot be
installed over says why in place of the Install button: a development
build, a `.deb` or `.rpm` (the package manager's), a bare Linux binary.
The log has `updater<TAB>available|up to date|error`.
