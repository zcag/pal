# odak

Your [odak](https://github.com/zcag/odak) todos in the panel: every open one
by section with the overdue and today's on top, a todo typed in one line
with its tags, flag, section and a day in words, search across open and
completed, what you checked off. One bar item counts what is due today or
sits in today's sections, turns red while anything is overdue, and hides
at zero; its popover completes on Enter and adds from a field.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Todos | `odak` | live, 60 s | completes the todo (Tab marks several) |
| Add Todo | `odak-add` | input | adds the line as read |
| Search Todos | `odak-search` | input | completes an open todo, reopens a completed one |
| Completed | `odak-done` | live, 60 s | reopens |

## Signing in

Two settings under Settings › Extensions › odak: the **Address** of the
server (`http://host:8761` on your network, or its public address; the
same origin serves the web UI) and the **API key** (the server's
`ODAK_API_KEY`, kept in the OS keychain). Without either, every palette is
one hint row naming which and opening it in Settings; a refused key says so;
a server that does not answer names the address and the retry key, and
the rows already fetched stay through an outage.

## The endpoints it uses

Everything is the server's own REST API, `Authorization: Bearer <key>`:

| call | for |
| --- | --- |
| `GET /todos` | every todo, open and done, in the file's order (one call, cached 60 s, shared by the palettes and the bar item) |
| `GET /sections` | the file's `##` headings in order, cached 5 min |
| `GET /todos/:id` | a todo the cache no longer has (a pick after a restart) |
| `POST /todos` | Add Todo, New todo, the popover's field, `pal://odak/add` |
| `PATCH /todos/:id/done` | Complete, Reopen (the id stays: odak hashes the line after its checkbox) |
| `PATCH /todos/:id` | Edit, Snooze, Mark urgent |
| `POST /todos/:id/move` | Move to section, Edit with a new section |
| `DELETE /todos/:id` | Delete (odak takes the subtasks with it) |

Two things about odak's model the extension works around. **An id is a
hash of the line**, so an edit, a snooze, a flag or a move gives the todo
a new id, and the server's answer carries the old one. The extension
computes the new id the way odak does (`idOf` in `data.ts`), patches its
cache with it, uses it for the move that follows an edit, and fetches the
list again behind every write so the server's view wins. **A day cannot be
cleared**: `PATCH` keeps an empty `deadline`, so Edit refuses an emptied
due field and says to move the day instead. `urgent` is written on every
`PATCH` (odak overwrites it), so the current flag rides along.

## What each palette does

**Todos** lists every open todo: first two commands (New todo, whose text
is typed in the search bar as an argument, `⌘Enter` opening Add Todo; Open
odak), then **Overdue** and **Due today**, then the file's sections in
their order (Focus, Today, Next, ... whatever the headings are), a subtask
right after its parent with the parent under it, and **Not yet** at the
end for todos waiting on a `[w:date]` still ahead. A row: the text, its
tags as coloured chips, the day as a chip (`overdue 3 d` red, `today`
amber, `tomorrow` blue, `Fri` within the week, `Fri 26 Sep` beyond), a red
mark for an urgent one, `2 subtasks` on a parent. The pane: the text, the
subtasks as a task list, section, tags, due day, the link in the text, the
id. Typing a tag, a section or `overdue` narrows the list (they are the
rows' keywords), at the root too.

On every row: Complete (`Enter`; a toast, and an **Undo** row at the top
for a minute), Edit… (`⌘E`: text, section, tags, due day, urgent), Snooze
to tomorrow (`⌘T`), Snooze… (`⌘S`: tomorrow, in 3 days, next Monday, next
week, in a month, or a day typed), Move to section… (`⌘M`), Mark urgent
(`⌘U`), Add subtask… (`⌘N`), Open link (`⌘L`, when the text has one), Open
odak (`⌘O`), Copy text (`⌘C`), Copy link (`⌘⇧C`: the todo's, else
odak's), Delete (`⌘D`, asks; the subtasks go with it). Complete, Reopen
and Delete take several marked rows (`Tab` marks).

The root's **Now** section shows what is overdue or due today, from the
cache alone.

**Add Todo** reads the line as you type and shows what will be created:
`#tag` (any number), a bare `!` for urgent, `/section` (a prefix of one of
the file's sections; an unknown one stays in the text), `d:day` or
`w:day` (odak's due and wait-until days, without spaces: `d:fri`,
`d:2026-10-01`, `d:3d`), and a day in words at the end (`tomorrow`, `fri`,
`next mon`, `in 3 days`, `in 2 weeks`, `20 sep`, `sep 20 2027`,
`2026-10-01`, `by fri`). A time after the day (`next mon 9am`) stays in
the text: odak keeps a day only. Enter adds and hides with the HUD line;
`⌘Enter` adds and keeps the line for a variation; `⌘⇧C` copies the line.
Before anything is typed: what to type, what was just added (with Undo,
which deletes it), the front app's selection and the clipboard's text as
todos (Enter adds as typed, `⌘Enter` edits first). Any root query with no
hit offers "Add “…” to odak". Pushed from Add subtask, the todo lands
under the parent in its section.

**Search Todos** matches every typed word against the text, tags and
section of every todo, open ones by section first, completed ones after
with a green mark. **Completed** lists what is checked off by section,
with when, for the ones completed from pal; Enter reopens, `⌘D` deletes.

## The bar item

`odak/today`: the count of open todos due today or in the sections named
by its `today_sections` setting (Focus and Today by default), plus the overdue ones,
every 300 s and on show, wake and network. Its facts are `odak/overdue`,
`odak/today` and `odak/open`; the manifest's rules hide it at zero and
colour it red while anything is overdue (`[bar.items."odak/today"] show =
"always"` keeps the glyph at zero, muted; the rules are yours to override
under `rules.quiet` and `rules.overdue`). The popover: the overdue first,
then what is due today, then today's sections' todos, each with its flag,
section and tags under the text and the day on the right, a cursor the
arrows (`j`, `k`) move and a click sets; `Enter`/`x` completes, `u` flips
the flag, `t` snoozes to tomorrow, `n` turns the search row into a field
whose Enter adds a todo through the same grammar, `o` opens odak, `p` the
Todos palette, `r` fetches again.

## Links

`pal://odak/add?text=call the bank tomorrow #personal` (and `pal call
odak/add text=...`) adds a todo from a script or a keybind; the text takes
the add grammar, and `section`, `due` (a day in words), `tags` (repeated)
and `urgent` come on top. The HUD says where it landed.

## Settings, `[extensions.odak]`

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | (none) | The server's origin. |
| `api_key` | secret | (none) | `ODAK_API_KEY`. |
| `default_section` | text | `Inbox` | Where a todo lands unless the line names a section; must be one of the file's (else Inbox, else the first). |

`today` item settings, `[bar.items."odak/today".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `today_sections` | list | `["Focus", "Today"]` | What the item counts as today's, on top of what is due today. |

For the tests, `PAL_ODAK_URL` and `PAL_ODAK_KEY` replace the two settings.

## Not there

Reordering within a section (`POST /todos/reorder`; the file's order is
edited in odak), the raw file (`GET /raw`), clearing a day (the API cannot),
the WebSocket feed (the cache refetches on show and after every write
instead), several servers as instances (odak is one file per server).
