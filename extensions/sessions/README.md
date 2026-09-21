# Sessions

Every AI coding session on this machine and what each is doing: Claude
Code, Codex and Copilot CLI, read from the files the three CLIs keep for
themselves, with the process table saying which of them is still there.
Nothing is asked of the agents and nothing is installed into them; a hook
line per CLI (below) is optional and makes the state exact.

**Sessions** (`sessions`) is one row per session under a header per state,
in the order that matters: **Waiting on you?** (red), **Your turn**
(amber), **Working** (blue), **Ended** (grey). The row is the session's
title (Claude's own `ai-title`, Codex's first prompt, Copilot's session
name), the subtitle the agent, the folder and the branch; on the right
the state tag, the model, how long the state has held, and the tty or the
tmux pane. Filters: All, Claude, Codex, Copilot, and **Recent**, every
session written in the last `recent_hours` whether or not anything runs
it, which makes the palette a way to resume one. A live palette, primary
at the root: type the folder, the branch, the agent or the first letters
of the id.

The pane shows the last exchange (your last prompt, the assistant's last
text) and, for a session waiting on you, the tool call left hanging with
its command or path; under it the agent and version, the model, the
folder and branch, when it started, the last write, the number of turns
and how long the last one took, the tokens the file reports, the
permission mode, the process, the session id and the transcript path.

**Transcript** (`cmd+t`, `t` in the popover) opens the conversation as a
view without leaving pal: a header (the agent's mark, the title, the
state with its age, folder, branch, model, turns, tokens), then the last
15 entries oldest to newest as a chat. A prompt is a sunken block with a
rail in the accent colour, the assistant's text plain paragraphs (cut at
1200 characters with a line counting the rest), a tool call one compact
row (its name, the command or path, a dot: green done, red failed, grey
still running) lit when the session is waiting on that call, a stretch of
thinking one muted line ("thought for 12 s"). While the level is shown
the file is watched and every write redraws it, so a running session
streams into the view. The fold keeps the last 60 entries of a file, not
the whole of it; older ones are not shown.

| key | what |
| --- | --- |
| `[` | 15 older entries |
| `f` | Focus the terminal |
| `c` | Copy the last reply |
| `o` | Open the transcript in the editor |
| `s` | Send a line (a tmux-backed session): the search row becomes a field, Enter types the line into the pane |
| `r` | Refresh |
| `up` / `down` | Scroll |
| `escape` | Back |

## Where the files are

| agent | files | resume |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<cwd slug>/<id>.jsonl`, one line per entry (`user`, `assistant`, `system` with `turn_duration`, `ai-title`, `permission-mode`) | `claude --resume <id>` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` (`session_meta`, `event_msg` with `task_started` / `task_complete`, `response_item` messages and tool calls) | `codex resume <id>` |
| Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl` with `workspace.yaml` beside it, and `~/.copilot/open-sessions-state.json` | `copilot --resume=<id>` |

Each file is folded once and then from the byte it was last read to,
so a 50 MB transcript costs one read; a directory the listed files sit in
is watched, and a write there re-renders the bar within half a second.
Files older than `recent_hours` are not read at all.

## How a state is derived

1. **Live or not.** `ps` lists the `claude`, `codex` and `copilot`
   processes (matched on the command's basename, so `claude-state` and
   `codex mcp-server` are not sessions) and `lsof` (Linux: `/proc`) their
   working directories. A Copilot session is paired to its process by the
   `inuse.<pid>.lock` in its directory; a Claude or Codex file is paired
   to a process of that agent on the same directory, the newest file to
   the newest process. Two sessions in one directory both list, and which
   pid each gets is a guess.
2. **Working**: the file's last turn has not ended. Claude: a user prompt
   after the last `turn_duration`; Codex: `task_started` after the last
   `task_complete`; Copilot: `working: true` in `open-sessions-state.json`
   or `assistant.turn_start` after the last `turn_end`. A working file not
   written for `stale_minutes` is an interrupted turn (Escape leaves no
   mark) and reads as your turn.
3. **Waiting on you?**: working, the assistant's last tool call has no
   result after 20 s, and the process used no cpu across two `ps` reads
   2 s apart. That is what a permission prompt looks like from outside,
   and it is a guess: a long-running command with idle cpu (a `sleep`, a
   network wait) looks the same. The question mark stays unless a hook
   said so.
4. **Your turn**: the turn ended and nothing came since.
5. **Ended**: no process runs on the directory and the file was written
   within `stale_minutes`, so a crash or a closed window is seen for a
   while; older than that the session is only under Recent.

A session whose work runs in a subagent reads as your turn once the
parent's own turn ended: the parent is, in fact, waiting.

### Exact states from a hook

`pal://sessions/state?agent=<claude|codex|copilot>&session=<id>&state=<working|waiting|blocked>`
records a state for ten minutes over anything the files say (`pal call
sessions/state agent=claude session=<id> state=working` from a shell).
Claude Code hands every hook the session id as JSON on stdin, so a few
lines in `~/.claude/settings.json` cover it:

| hook | command |
| --- | --- |
| `UserPromptSubmit` | `pal call sessions/state agent=claude state=working session=$(jq -r .session_id)` |
| `Stop` | `pal call sessions/state agent=claude state=waiting session=$(jq -r .session_id)` |
| `Notification` | `pal call sessions/state agent=claude state=blocked session=$(jq -r .session_id)` |
| `PostToolUse` | `pal call sessions/state agent=claude state=working session=$(jq -r .session_id)` (the prompt was answered; back to work) |

The same lines with `agent=codex` or `agent=copilot` serve a Codex
or Copilot hook that gives the session id the same way. Without hooks the
files decide, as above; with them the tag reads `waiting on you` with no
question mark and the pane says "from a hook".

## Focus: which terminals

Enter on a live row brings its window in front, by a ladder of rungs each
tried in turn until one answers; a rung whose tool is missing or whose
socket does not answer is skipped with a line in pal's log, and the toast
("Could not find its window") comes only when every rung failed:

1. **tmux**: `tmux list-panes -a` finds the pane on the process's tty (or
   whose shell is an ancestor of it); `switch-client`, `select-window`
   and `select-pane` select it inside its server, and the client attached
   to that session gives the tty the next rungs look for. A pane with no
   client attached gets a new terminal window running `tmux attach`.
2. **kitty**: `kitten @ ls` lists windows with the pid of their shell; the
   one that is an ancestor of the process is focused with `kitten @
   focus-window`, then the app is brought in front (focus-window alone
   does not raise kitty over another app). kitty is optional and never
   assumed; it needs `allow_remote_control yes` and a `listen_on
   unix:/tmp/<name>` in `kitty.conf`, and pal finds the socket from that
   line: kitty appends its pid to the path, so `<path>-<pid>` is tried
   for every running kitty, then `<path>` itself (`KITTY_LISTEN_ON` first
   when pal itself runs inside kitty). The socket that answered is kept
   until it stops answering.
3. **iTerm2** and **Terminal**: an AppleScript walks the tabs for the one
   whose tty matches and selects it; only when the app is running, since
   the script would launch it otherwise.
4. **WezTerm**: `wezterm cli list` names each pane's tty; the matching
   pane is activated with `wezterm cli activate-pane` and the app raised.
   Only while WezTerm runs.
5. **By pid**: the nearest ancestor of the process that is a GUI app (its
   command inside a `.app` bundle) is brought to the front through System
   Events by its pid. For a terminal with one window per process
   (Alacritty) that is exactly the window; for one process with many
   windows (Ghostty, Warp, VS Code's terminal) it raises the app with its
   last window, which is the most macOS offers without an API of the
   app's own.
6. **The app**: the `.app` bundle is activated with `open`, the last
   resort when no ancestor could be raised.

The `terminal` setting narrows this: `tmux only` stops after the pane,
`kitty`, `iTerm2`, `Terminal` and `WezTerm` try tmux then that app alone,
`Auto` runs the whole ladder. The same setting says what **Resume in a
terminal** opens for an ended session: a new window in that app running
the resume command in the session's folder, or a new tmux window.

The host runs under launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so
`tmux`, `kitten`, `wezterm`, the editor and the agents' own CLIs are
looked for on PATH and then in `/opt/homebrew/bin`, `/usr/local/bin`,
`~/.local/bin`, kitty's and WezTerm's app bundles.

## Keyboard

| keys | action | what |
| --- | --- | --- |
| `enter` | Focus the terminal | the ladder above; on an ended row, Resume in a terminal |
| `cmd+enter` | Send the line | a tmux-backed session only: the bar's `text` argument typed into the pane with `send-keys -l`, then Enter |
| `cmd+t` | Transcript | the conversation as a view, above |
| `cmd+o` | Open transcript in the editor | the file in the `editor` command when it is found, else `open -t` (TextEdit); a refusal is a toast with the reason |
| `cmd+shift+o` | Reveal transcript | in Finder (the file manager on Linux) |
| | Open folder | the session's folder |
| `cmd+e` | Open in editor | `<editor> <folder>` when the editor is on PATH, else the folder opens |
| `cmd+c` | Copy resume command | `claude --resume <id>`, `codex resume <id>`, `copilot --resume=<id>` |
| `cmd+shift+c` | Copy session id | |
| | Copy folder path | |
| `cmd+d` | Kill | `kill -TERM <pid>` after a confirm; marked rows go together |

## The bar item

`sessions` shows the count as its title with a segment per state: red
`!N` waiting on you, amber `·N` your turn, blue `…N` working; an alarm
while anything waits on you; hidden with no session at all (Settings can
keep it as a muted glyph). The core asks every 10 s and on show and wake;
the file watcher pushes sooner. The popover is a row per session under
the same headers, six rows then "and N more in pal", the ring on the row
the keys act on (a click moves it):

| key | what |
| --- | --- |
| `enter` | Focus the terminal (an ended row: resume it) |
| `t` | The transcript as a view, over the list |
| `o` | Open the transcript in the editor |
| `r` | Copy the resume command |
| `x` | Kill (asks first) |
| `s` | Open the palette on a tmux session's row, to type a line into it |
| `p` | Open the Sessions palette |
| `up` / `down`, `j` / `k` | Move the ring |

## Settings

| id | default | what |
| --- | --- | --- |
| `agents` | `claude`, `codex`, `copilot` | which agents' files are read |
| `stale_minutes` | 30 | how long an ended session stays listed, and how long a silent turn counts as working |
| `recent_hours` | 24 | how far back Recent lists, and how old a file may be to be read at all |
| `terminal` | Auto | the Focus ladder and what Resume opens: Auto, kitty, iTerm2, Terminal, WezTerm, tmux only |
| `editor` | `code` | the command Open in editor and Open transcript run; the OS opener when it is not found |
