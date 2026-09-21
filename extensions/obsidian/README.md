# Obsidian

Your Obsidian vault in the panel: every note by title at the root, sectioned
by folder with its tags and change date; full-text search as you type;
today's daily note, made from its template when missing, with a line
appended to it from the clipboard or what you type; new notes from a
template; tags with counts; what links to a note and what it links to. A
note opens in Obsidian or in your editor, and reads inside the panel with
its headings, callouts, lists, code and tables drawn in pal's own tokens.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Notes | `obsidian-notes` | indexed, 5 min | opens the note |
| Search Notes | `obsidian-search` | input | opens the note |
| Daily Notes | `obsidian-daily` | live | opens today's note, or creates it |
| Tags | `obsidian-tags` | indexed, 5 min, catalog | lists the notes with the tag |
| Recent Notes | `obsidian-recent` | live | opens the note |
| Backlinks | `obsidian-backlinks` | indexed, 5 min | opens the linking note |
| Outgoing Links | `obsidian-outgoing` | indexed, 5 min | opens the linked note |

## What it reads

The **vault folder** from the `vault` setting, or, when that is empty, the
vault Obsidian has open (else opened last) in Obsidian's own
`obsidian.json` (`~/Library/Application Support/obsidian/` on macOS,
`~/.config/obsidian/` on Linux). Without either, every palette is one hint
row naming the setting.

Every `.md` under the vault, dot folders (`.obsidian`, `.trash`, `.git`)
and the `exclude` globs left out. Each note gives its title (the front
matter's `title`, else the first `# heading`, else the file name), its
description (the front matter's, else the first body line), its tags
(inline `#tag` and `#a/b`, the front matter's `tags`), its aliases and its
`[[wikilinks]]`, which resolve as Obsidian resolves them: a path, else the
unique name, else the shortest path among namesakes, else an alias. The
index is kept per file by modification time and size, so a rebuild
re-reads only what changed; a watcher on the vault marks it stale on any
change (a burst is one), and the next listing rebuilds it. Search runs
ripgrep over the vault when `rg` is on PATH, else a scan in Bun that stops
after a second.

The daily-notes plugin's `.obsidian/daily-notes.json` (`folder`, `format`,
`template`) stands in for the `daily_folder`, `daily_format` and
`daily_template` settings while those are empty; `YYYY-MM-DD` when nothing
says. The format is moment's, the tokens Obsidian takes (`YYYY MM DD dddd
MMMM Do WW` and `[literal]`); `{{date}}`, `{{time}}`, `{{title}}` and
`{{date:FORMAT}}` are filled in a template.

## What it writes, and when

Three things, each on your action and nowhere else:

- **Today's daily note**, from its template, when you pick Today's note or
  Create today's note (which asks first) and the file is missing; also
  before an append when it is missing.
- **A line at the end of today's note**: Append to today (the line is
  the row's typed argument: Enter turns the search bar into the field,
  Enter again appends; `{selection}`, `{clipboard}`, `{date}`, `{time}`
  filled in) and the `append-today` link. Today's note's `⌘Enter`, and a
  pick without the value (`pal run`, a hotkey), ask in a form with the
  same field, prefilled from the clipboard.
- **A new note**: New note (the title and the folder are the row's typed
  arguments, the folder a choice among the vault's; the body is the
  `template` setting with `{{title}}` and `{{date}}` filled, else your
  selection or the clipboard, and the note opens at once), the `new`
  link, and Create the note on a link to nothing in Outgoing Links (a
  `# Title` line). A title that names a note already there is refused,
  with the fields as a form to fix it in.

Nothing is edited or deleted. The note opened or read last is remembered
in pal's storage for Backlinks and Outgoing links.

## What each palette does

**Notes** lists every note, sectioned by folder (`Vault` for the top
level), the description as the subtitle, up to three tags and the change
date on the right; the name, the aliases, the tags and the folder are
keywords, so `#infra` or `the box` finds a note too. Four commands lead:
Today's note (`⌘Enter` appends instead), New note (title and folder typed
in the bar), Search notes (`⌘Enter` opens Obsidian's own search) and
Random note. Pushed from Tags it lists
one tag's notes (a nested tag under its parent too).

On every note row: Open in Obsidian (`obsidian://open`, so Obsidian
switches to the vault and the file) and Open in editor; which is `Enter`
and which `⌘Enter` is the `open_with` setting. The editor is the `editor`
command with the file's absolute path last (`code`, `subl`, `zed`; a
command off PATH is a toast naming the setting); empty, the OS opens the
file with whatever owns `.md`. Copy wikilink (`⌘C`) writes `[[name]]`, or
`[[folder/name]]` when another note shares the name. Read in pal (`⌘⇧R`)
draws the note as a view through the same markdown renderer tela's pages
use: headings, lists, tasks, callouts as tinted cards, quotes and code on
sunken wells, tables as aligned columns, links under their paragraph.
Backlinks (`⌘B`) and Outgoing links (`⌘L`) push those palettes with the
row; Copy path (`⌘⇧C`) is the absolute path. The pane (`⌘I`) is the note
as markdown with the front matter off, callouts as a bold lead, wikilinks
as links into Obsidian (a link to nothing yet says so), then the path,
the modified time, the words, the tags, the aliases, the links (an
unresolved one grey) and the backlinks with their titles.

**Search Notes** searches the text of every note as you type, case-
insensitive, the words as typed: ripgrep when installed, a scan
otherwise (the empty hint says which). Rows are notes sectioned by folder,
the first matching line as the subtitle, how many lines matched on the
right; the pane lists the matching lines (three per note) with the match
bold. A note named or titled like the query comes first, then the ones
with more matches, then the newest; sixty at most.

**Daily Notes** is live: today's note (a Create row when missing, which
asks before writing), yesterday's, the rest of the last seven days under
This week, then Append to today (the line typed in the bar) and New note
(the title and the folder). **Tags** counts every tag
across the vault, most used first; Enter lists the notes, `⌘C` copies the
tag. **Recent Notes** is the twenty changed last. **Backlinks** and
**Outgoing Links** are for the note you opened last, or the row `⌘B` /
`⌘L` came from; a link to a note that does not exist yet offers Create
the note.

## Links

- `pal://obsidian/open?path=infra/theater` (a path with or without `.md`,
  or a name as a wikilink says it) opens the note as Enter would.
- `pal://obsidian/new?title=Trip&body=...&folder=personal` creates the
  note and opens it; `{{title}}` and `{{date}}` in the body are filled.
- `pal://obsidian/append-today?text=...` appends to today's note, created
  when missing; `{selection}`, `{clipboard}`, `{date}`, `{time}` are
  filled.

## Settings

`[extensions.obsidian]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `vault` | path | (none) | The vault folder; empty takes Obsidian's open vault. |
| `open_with` | `obsidian` / `editor` | `obsidian` | What Enter does; `⌘Enter` is the other. |
| `editor` | text | (none) | The editor command; empty is the OS opener. |
| `daily_folder` | text | (none) | Daily notes folder; empty reads the plugin. |
| `daily_format` | text | (none) | The daily note's name format; empty reads the plugin, then `YYYY-MM-DD`. |
| `daily_template` | text | (none) | The daily note's template; empty reads the plugin. |
| `template` | text | (none) | The template New note starts from. |
| `exclude` | list | `[]` | Globs relative to the vault to leave out. |

For the tests, `PAL_OBSIDIAN_CONFIG` names an `obsidian.json` to read and
`PAL_OBSIDIAN_SEARCH=scan` forces the scan.

## Not there

Editing a note's body (that is Obsidian's or the editor's), Obsidian's
search syntax (`tag:`, `path:`; the words are matched as typed), the
Periodic Notes community plugin's weekly and monthly notes, canvases,
attachments.
