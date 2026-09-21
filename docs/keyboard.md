# Keyboard

The grammar, as the panel resolves it (`app/src/ui/keys.ts`). `cmd` is the
platform's primary modifier: `⌘` on macOS, `Ctrl` on Linux. Keys are
spelled `⌘K` in prose and `cmd+k` where a file or a manifest names them
(a hotkey in the config file, an action's `shortcut`).

| keys | does |
| --- | --- |
| `↓`, `↑`, `ctrl+n`, `ctrl+p` | Move the cursor |
| `enter` | Run the primary action |
| `cmd+enter` | Run the secondary action |
| `cmd+k` | Toggle the action panel |
| `escape` | Close action panel, else clear the marks, else clear query, else pop a level, else hide |
| `cmd+backspace` | Pop a level when the query is empty |
| `backspace` | With nothing typed: the row's action carrying it (a folder's Go up), else pop a level, as `cmd+backspace` does (`general.backspace_back`, on by default; never at the root); with text it deletes as usual |
| `tab`, `shift+tab` | Cycle the filter dropdown, when there is one |
| `cmd+i` | Toggle the detail pane |
| `cmd+1` | Jump to row 1..9 (cmd+1 to cmd+9) |
| `home`, `end`, `pageup`, `pagedown` | Scroll the list |
| `cmd+c` | Any other modifier combo runs the action carrying that shortcut |
| `h`, `space`, `backspace` | In a view level with bare-key actions (`keys: "actions"`), a bare key runs the action carrying it; with a text field up it is typing |
| `shift+↑`, `shift+↓` | A shifted arrow runs the action carrying it (a view's big step); in a list it marks the row under the cursor and moves |
| `cmd`-click | Mark or unmark one row |
| `tab`, `x` | In a palette that opts in (`multi`: Files, Windows, `pal pick --multi`; none has a filter dropdown), mark the row and step down; `x` only while nothing is typed, so a name can still be searched |
| `→`, `←`, `backspace` | In a list while nothing is typed: the row's action carrying that key (a folder's Browse on `→`; `←` and `backspace` also reach the `..` row's Go up from anywhere in a browsed folder). With text in the box the arrows move the caret as usual; a `backspace` no row claims goes back a level (above) |

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
- In a form level, Enter submits (⌘Enter from a textarea), Escape leaves,
  Tab moves between fields.
- At the top of the empty root, `↑` recalls the last query that led to a
  pick, `↑` again the one before, `↓` walks forward, Escape clears
  (`general.search_history`).

## Shortcuts the shell adds

These ride on the last row of the grammar: actions the panel itself puts in
the action panel, with a shortcut (`app/src/Launcher.tsx`). The ones
without a key are reached through ⌘K.

| keys | action | where |
| --- | --- | --- |
| `cmd+,` | Open Settings | the root |
| `cmd+r` | Refresh everything (root) or Refresh (palette, or a bar menu) | the root, an indexed palette, a bar popover's menu |
| `cmd+shift+b` | Browse (palette): drill into the palette a result came from | the root |
| `cmd+i` | Show details / Hide details | everywhere but compact mode |
| `cmd+shift+m` | Compact panel / Full panel: flips `general.compact` ([Config](config.md#general)) | the root, a palette |
| `cmd+shift+c` | Copy deep link: the `pal://` link for what is under the cursor ([Links](links.md)) | every row, palette, view and form |
| | Reset ranking for this item: its picks and the queries that found it are forgotten | an indexed or palette row |
| | Clear selection | while rows are marked |
| | Show tips again | the root, once the Welcome tips are hidden |

Palette actions carry their own (`⌘C` Copy link in bookmarks, `⌘P` Pin in
clipboard history, ...); the action panel lists them next to each action.
See [Palettes](palettes.md).

## Switcher

Cmd+Tab's shape over a palette's rows, for the palette whose `hold` chord
is set ([Config](config.md#palettesid)); Windows suggests `alt+tab`. The
list is flat (no sections, the index's order: for Windows most recently
used first, so row 2 is where you just were) and the cursor starts there.

| keys | does |
| --- | --- |
| `alt+tab` (the `hold` chord) | Held: show the palette with the cursor on row 2; pressed again while held: step down, wrapping |
| `shift+alt+tab` | Step up |
| let go of `alt` | Run the primary action of the row under the cursor (Focus, for a window); with nothing listed, hide |
| typing | Filter as always; the cursor keeps its row while it is still listed, else goes to row 1 of the filtered list; the release then runs that row |
| `escape` | Cancel: hide, whatever is typed |
| `enter` | Also runs the row, as in any list; a chord with no modifier (`f13`) has no release, so this is its commit |

The release is read from the OS's modifier state (macOS; nothing to grant),
so the chord's key may go up long before the modifier does. On Linux a
compositor keybind drives the same machine with [`pal switch`](cli.md#pal-switch).

## Other windows

- **The picker** (`pal pick`, [CLI](cli.md#pal-pick)) is a level of the
  panel, so the grammar above applies: Enter prints the row, Escape prints
  nothing.
- **Large Type** (the `large_type` effect, [Extensions](extensions.md))
  closes on any key, a click, or after 8 s.
- **A confirm card** (a link that acts, Quit pal, a kill): Enter runs,
  Escape does not, Tab moves between the two buttons; a link's card
  answers no by itself after 30 s.
- **The Settings window**: `escape` and `⌘W` (`Ctrl+W` on Linux) hide it;
  `/` focuses its search, `⌘1` to `⌘6` switch pages, arrows move along the
  tabs and the search hits.
- **A bar popover** takes the same grammar as the panel for its menu, view
  and palette levels ([Extensions](extensions.md#bar-items-glanceable-state-on-the-bar)).
