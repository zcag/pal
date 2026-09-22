# Diff

Diff what you copied. Open it and the two newest text entries of the
clipboard history are compared, the older on the left: what changed on
the way to the newer copy. Other pairs are a key away: the clipboard
against the selection in the app in front, two entries picked from the
history, two files.

## The view

A header names both sides (`−` the left, `+` the right) with what they
are and when they were copied ("Deploy notes · 3 lines · copied 2 min
ago from kitty"), and the counts as badges: `+12` green, `−4` red,
`whitespace only` amber when every change is whitespace, `no
differences` when there are none. Under it a keycap line with the keys
in use, then the lines on a sunken surface:

- **Unified** (the default): both line numbers in the gutter, the sign,
  the text in monospace. Removed lines sit on a red tint, added ones on
  a green one; consecutive lines of one kind share the block, so a
  change reads as one. Inside a removed/added pair that still shares
  most of its words, the words that differ are marked on a stronger
  tint (a pair that shares under 40% is drawn plain). A pair that
  differs in whitespace alone carries a `whitespace` tag.
- **Side by side** (`s`): a cell per side, the same tints, an empty cell
  where a line was only removed or only added.
- **Folds**: a run of unchanged lines longer than the 3 lines of context
  kept on each side of a change folds to one row, "⋯ 16 unchanged
  lines". `tab` and `shift+tab` move a cursor over the folds (an accent
  ring), `space` expands the one under it, `a` expands them all, a click
  expands one.
- A very long diff is cut where the host's node cap would be reached
  and says so; Copy unified diff has the whole thing.

The tints are fixed colours at a low alpha, so they read on both themes
with the panel's own ink.

| keys | action |
| --- | --- |
| `enter` | Copy the unified diff (`--- left`, `+++ right`, the hunks, 3 lines of context) |
| `o` (`cmd+enter`) | Open both sides in the external tool |
| `s` | Side by side, or unified |
| `w` | Ignore whitespace (as `diff -w`: none of it counts, the newline at the end included), or mind it |
| `x` | Swap the sides |
| `l`, `r` | Copy the left or the right text |
| `tab`, `shift+tab` | Next, previous fold |
| `space` | Expand the fold under the cursor (`a`: every fold) |
| `n` | The two newest copies again |
| `e` | The clipboard against the selection |
| `h` | Pick two entries from the history |
| `f` | Two files (a form: two paths, `~` allowed) |
| `escape` | Back |

`n` and `e` replace the sides in the same level; `h` and `f` open a new
level over it, so `escape` comes back to the diff you had.

## Sources

- **The two newest copies**: the newest two text entries of the history
  (images and file lists skipped). With fewer than two the view says so.
- **Clipboard vs selection**: what is on the clipboard now (the history
  entry for it, else the newest text entry) on the left, the selection
  in the app in front on the right (`selection.text()`, Accessibility on
  macOS); nothing selected is said in the view. The header names the
  app the selection is in.
- **From history** (`h`, the `Diff from History` palette,
  `diff-pick`): the history's text entries, searchable. `enter` on one
  takes it as the left side and lists the rest for the right; or mark
  two (`tab`, or `x` with nothing typed) and `enter` diffs them, the
  first marked on the left. The Clipboard History palette has the same
  two actions on a text entry: `Diff with…` and, with two marked, `Diff
  these two` (`cmd+shift+f`).
- **Two files** (`f`): a form with two paths; a missing file, a folder or
  a binary is refused under its field. A file over 1 MB is not read into
  the panel (the external tool takes it).

## The external tool

`o` writes each side that is not already a file under
`~/Library/Caches/pal/diff/` (`$XDG_CACHE_HOME/pal/diff` on Linux),
named after its label, and opens the pair in the `tool` setting: Auto
takes the first installed of VS Code (`code --diff`), kitty (`kitty
+kitten diff`, the app on macOS), FileMerge (`opendiff`, with Xcode) and
Meld; `custom` runs `tool_command` with `{left}` and `{right}` filled in
(a quoted argument stays whole): `nvim -d {left} {right}` in a terminal
wrapper, `delta {left} {right}`. No tool at all is a toast naming what to
install.

## Links

| link | what |
| --- | --- |
| `pal://diff/clipboard` | The two newest copies |
| `pal://diff/selection` | The clipboard against the selection |
| `pal://diff/files?left=~/a&right=~/b` | Two files |
| `pal://diff/text?left=…&right=…&left_label=…&right_label=…` | Two texts given in the link |
| `pal://diff/history?left=<id>&right=<id>` | Two history entries by id |

Each opens the panel on the diff. `pal call diff/files left=a right=b`
is the command form.

## Settings, `[extensions.diff]`

| key | type | default | what |
| --- | --- | --- | --- |
| `tool` | `auto`, `code`, `kitty`, `opendiff`, `meld`, `custom` | `auto` | What `o` opens the sides in. |
| `tool_command` | text | empty | With `custom`: the command line, `{left}` and `{right}` the two files. |

For the tests, `PAL_DIFF_PATH` is a directory searched for the tools
instead of `PATH`, `PAL_DIFF_CACHE` the folder the sides are written to.

## What it does not do

- Three-way merges, or editing either side: it reads. Open the tool for
  that.
- Diffing images or file lists: text entries only; a pick of another kind
  says so.
- Syntax colouring inside the lines.

The diff is [jsdiff](https://github.com/kpdecker/jsdiff) (`diff` on npm,
BSD-3-Clause): its line diff with one change per line, its word diff
for the spans, its patch writer for the unified text.

## Platforms

macOS and Linux.
