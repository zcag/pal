# Makefile Targets

Every target of every Makefile under the `projects` folders, one section
per project. A folder is scanned two levels deep for a `Makefile`,
`makefile` or `GNUmakefile` (GNU make's own order when several are there);
dot folders and `node_modules`, `target`, `vendor`, `dist`, `build` are not
entered. Targets are read from the file's text, not from `make -pn`: a
line beginning with one or more names and a colon (`:=` assignments,
pattern rules and `$(VAR)` targets are not targets), `.PHONY` names
included even when their rule is not literal, in file order. A
description is the `## text` on the rule's line, else the comment line
right above it (a `.PHONY:` line in between is skipped).

## The palette

The row is the target, the project folder the subtitle (with the
description after a colon), the project's name a keyword (so `pal test`
finds it from the root); a phony target has `phony` as one too. The
palette is indexed: listed once, searched from the index, refreshed with
`cmd+r` after a Makefile changes. The detail pane (`cmd+i`, asked when the
cursor rests on a row) shows the recipe as a code block and, in its
metadata, the project, the Makefile's name, the description and whether it
is phony.

While the cursor is on a target the search bar shows one field after the
query, the words to put after the target (`VERBOSE=1`, `-j4`, split on
spaces; Tab into it, Escape back); left blank, Enter runs it plain, as
does a pick that arrives without the field (a hotkey, a bare `pal run`).
Run opens a terminal in the project folder running `make <target> <words>`; the
window stays open until Enter is pressed, so a quick target's output is
not gone with it, and the HUD names the command. With `terminal =
"background"` make runs unseen instead: a toast carries the exit status
and the output's last line, and a failure opens the whole output in the
panel too; a run still going after 8 s is left to finish on its own and
the toast says so.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Run: `make <target>` in a terminal in the project folder, or in the background; argument `extra` (optional): variables or flags after the target |
| `cmd+c` | Copy command: `make -C <dir> <target>` |
| `cmd+o` | Open project: the folder in the file manager |
| `cmd+l` | Show Makefile: the whole file in the panel, `esc` goes back |
| `cmd+i` | The detail pane with the recipe |
| `cmd+r` | Refresh: scan the folders again |

## Setup

`make` on PATH for Run; the listing needs nothing (it reads the files).
Point `projects` at the folders that hold your checkouts; a folder that is
not there lists nothing.

Which terminal Run opens: on macOS the `terminal` setting (`auto` takes
the first installed of kitty, Ghostty, Alacritty, iTerm2, Terminal);
Terminal and iTerm2 are driven through AppleScript, so the first Run into
one of them asks for the Automation permission once. On Linux `$TERMINAL`,
else the first of kitty, foot, alacritty, xterm on PATH. `background`
needs no terminal at all.

Settings, `[extensions.make]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `projects` | list of paths | `["~/proj"]` | Folders to scan, two levels deep. `~` is expanded. |
| `terminal` | `auto`, `background`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | Where Run puts make. |

## What it does not do

- Evaluate the Makefile: targets built from variables (`$(BIN):`) or
  pattern rules (`%.o: %.c`) are not rows, and an included file's targets
  are not read.
- Arguments: `make <target>` runs as is; for `VAR=value`, copy the command
  and add to it in the terminal.
- Watch for changes: a new target shows after `cmd+r`, and a listing is
  kept across restarts until then.
- Other build tools (`just`, `task`, npm scripts): Makefiles only.

## Platforms

macOS and Linux. The terminal is chosen per platform as above; the scan
and the parser are the same on both.
