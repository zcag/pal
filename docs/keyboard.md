# Keyboard

The grammar, as the panel resolves it (`app/src/ui/keys.ts`). `cmd` is the
platform's primary modifier: `⌘` on macOS, `Ctrl` on Linux.

| keys | does |
| --- | --- |
| `↓`, `↑`, `ctrl+n`, `ctrl+p` | Move the cursor |
| `enter` | Run the primary action |
| `cmd+enter` | Run the secondary action |
| `cmd+k` | Toggle the action panel |
| `escape` | Close action panel, else clear the marks, else clear query, else pop a level, else hide |
| `cmd+backspace` | Pop a level when the query is empty |
| `tab`, `shift+tab` | Cycle the filter dropdown, when there is one |
| `cmd+i` | Toggle the detail pane |
| `cmd+1` | Jump to row 1..9 (cmd+1 to cmd+9) |
| `home`, `end`, `pageup`, `pagedown` | Scroll the list |
| `cmd+c` | Any other modifier combo runs the action carrying that shortcut |
| `shift+↓`, `shift+↑` | In a list, mark the row under the cursor and move (a view's own action first); `escape` clears the marks before the query |
| `cmd`-click | Mark or unmark one row |
| `tab`, `x` | In a palette that opts in (`multi`: Files, Windows, `pal pick --multi`; none has a filter dropdown), mark the row and step down; `x` only while nothing is typed, so a name can still be searched |

Notes from the same file:

- Only cursor movement repeats while a key is held; Enter, Escape and
  shortcuts fire once.
- Typing with nothing focused goes to the search box, unless an overlay
  (the action panel, a confirmation, a form) is up; then its own fields
  own the keys.
- Mid-composition (dead keys, CJK input) the keys belong to the input
  method: Enter commits, arrows pick a candidate.
- Without a filter, Tab is still swallowed, so focus never walks out of
  the search box.
- In a `show` level (a read-only detail pushed by a pick), Enter and
  Escape go back; arrows and PageUp/PageDown scroll.

## Shortcuts the shell adds

These ride on the last row of the grammar: actions the panel itself puts in
the action panel, with a shortcut (`app/src/Launcher.tsx`).

| keys | action | where |
| --- | --- | --- |
| `cmd+,` | Open Settings | the root |
| `cmd+r` | Refresh everything (root) or Refresh (palette) | the root, or an indexed palette |
| `cmd+shift+b` | Browse (palette): drill into the palette a result came from | the root |
| `cmd+i` | Show details / Hide details | everywhere |

Palette actions carry their own (`cmd+c` Copy link in bookmarks, `cmd+p`
Pin in clipboard history, ...); the action panel lists them next to each
action. See [Palettes](palettes.md).

In the Settings window, `escape` and `⌘W` hide it (the Meta key on Linux, not Ctrl).
