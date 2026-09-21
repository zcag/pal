# tela

Your [tela](https://telawiki.com) wiki in the panel: full-text search with
the matching passage, a question answered by meaning with its sources laid
out, the pages that changed lately with your favourites first, the spaces,
the decks and sheets, what links to a page, the mentions and replies that
address you. A page opens in tela, or reads inside the panel with its
headings, callouts, lists, code and tables drawn in pal's own tokens. A new
page is a form whose body starts as whatever you had selected or copied.
One bar item counts unread mentions and replies and stays hidden otherwise.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Search tela | `tela-search` | input | opens the page in tela |
| Ask tela | `tela-research` | input | asks; on a source, opens it |
| Pages | `tela-pages` | indexed, 5 min | opens the page in tela |
| Spaces | `tela-spaces` | indexed, 1 h | lists the space's pages |
| New Page | `tela-new-page` | indexed, 1 h | the form, the space chosen |
| Decks | `tela-decks` | indexed, 1 h | opens the deck in tela |
| Sheets | `tela-sheets` | indexed, 1 h | opens the sheet in tela |
| Comments | `tela-comments` | live | marks read and opens the page |
| Backlinks | `tela-backlinks` | indexed, 5 min | opens the linking page |

## Signing in

Two settings, under Settings › Extensions › tela: the **Address** of the
instance (`https://telawiki.com`, or your own) and a **Token**, a personal
access token made under Settings, API Keys on tela (`tela_pat_...`, kept
in the OS keychain). A read-scoped token lists, searches and researches;
writes (a new page, a comment, marking notifications read) need
write scope, and tela says so in the form when they do not have it. A token
pinned to one space sees that space alone. Without either setting every
palette is one hint row naming which; an expired token is one naming the
renewal, with Enter on tela's API Keys page.

Everything goes to the instance's own API: the REST routes under
`/api/` for lists, pages, search and writes, and `/api/mcp`, the MCP
endpoint tela's `tela-mcp` package proxies to, for `research` (the one
call REST has no shape for). The MCP session is opened once per host run
and again when the server forgets it.

## What each palette does

**Search tela** sends what you type to tela's ranked full-text search
(titles above bodies, a phrase in quotes, `-word` excluded), 250 ms after
the last keystroke. Rows are pages, sectioned by space, with the
breadcrumb and the matching passage; a page you can read only because its
space is public is tagged. The pane (rest on a row, or `⌘I`) is the page
itself. Nothing found offers Ask tela.

**Ask tela** is tela's semantic, answer-oriented `research`: the pages
that matter, assembled as a numbered grounding, with the cited sources,
any known disagreements among them and a low-confidence flag. Type a
question and Enter opens the answer as a view: the flags on top (amber
"Low confidence" when nothing strongly relevant was found, red
"Disagreements" with tela's note), the sources as numbered rows with the
space, the heading path and when the page moved, and the selected
source's excerpt from the grounding rendered under its row. `↓`/`j`,
`↑`/`k` or a digit move the selection; Enter opens the source in tela,
`⌘Enter` reads the page in the panel, `⌘C` copies its link, `⌘⇧C` copies
the whole grounding, `⌘⇧O` opens the question on tela's Ask page (the
LLM answer), `+` asks again with twice the sources when the answer was
truncated, `n` opens a text field for the next question. Questions are
remembered (twelve) and listed under the Ask row; `⌘⇧D` forgets one. The
`research` setting hides the palette; an instance with no embedder says
so in a toast.

**Pages** at the root is four commands (New tela page, Search tela, Ask
tela, Quick Notes: tela's per-user scratchpad), then your favourites,
then what changed lately across every space you can see, sectioned by
space, newest first, with who changed it. Pushed from Spaces it is one
space's pages in tree order, sectioned by their top-level page. Every page
row: Open in tela (`Enter`), Read in pal (`⌘Enter`: the page drawn in the
panel), Copy link (`⌘C`), Outline (`⌘⇧O`, the headings), Backlinks
(`⌘B`), Comment on page (`⌘⇧M`).

The Ask tela row takes the question as a typed argument: with the cursor
on it the bar shows a Question field (Tab into it), Enter opens the
answer view (`⌘Enter` takes the question to tela's Ask page instead); a pick without
the value (`pal run`, a hotkey) asks for it in a form. The Ask tela
palette still lists your recent questions.

**Read in pal** draws the page's markdown with the view tree (the SDK's `md`):
headings by level, paragraphs, bullet, numbered and task lists (nested),
`> [!NOTE]` callouts as tinted cards with a badge (Note blue, Tip green,
Important violet, Warning amber, Caution red), quotes and tela's
`:::quote{cite}` on a sunken well, code blocks mono on a sunken well
(forty lines, then a count), tables as aligned columns (thirty rows),
`<details>` as a titled section, `:::tabs` as headed sections, the links
of a paragraph under it as `↗ label` runs, an image as `[image: alt]`. The
view's text node is one run, so bold, italic and code inside a paragraph
are flattened to their words; a paragraph that is one bold or code run
keeps the weight or the mono. Front matter is left out, and a leading `#`
that repeats the title. Past 1200 nodes the view says the rest is in
tela. From the view: Open in tela, Copy link, Backlinks, Outline,
Comment, Copy markdown (`⌘⇧C`).

**Spaces** lists every space the token sees with its page count (one
listing of every page, counted), the description, tags for public,
personal and your default space, the member count and when it moved. Enter
lists its pages, `⌘Enter` opens it in tela, `⌘N` starts a page in it.

**New Page** is one row per space (the default first); Enter opens the
form: title, space (a select), body. The body starts as the front app's
selected text, else the clipboard's text (under 20 KB); the description
says so. The page opens in tela once created.

**Comment on page** anchors on a run of the page's text, as tela's
comments do: the form's second field is that run, the first line of the
page unless you change it. **Backlinks** lists the pages that link to the
one you opened last (or the row `⌘B` came from), with the linking passage.

**Decks** and **Sheets** are the pages flagged as such across every
space, newest first (one tree listing per space, an hour); a deck's pane
leads with its first slide as tela renders it, when the instance's deck
renderer answers. **Comments** is the notifications that address you:
mentions and replies to your comments, unread first, then the last
twenty read ones; Enter marks one read and opens the page, `⌘Enter` reads
the page in pal, `⌘⇧R` marks read, `⌘⇧A` marks everything read.

**The bar item** `tela/inbox` counts unread mentions and replies as the
badge, hidden at zero (tela's other notifications, sign-ups and Atlas
runs among them, are not yours to answer); every 300 s and on show, wake
and network. The popover is a view of its own: the newest five as rows
— the kind's glyph, what happened, the comment's snippet, the time —
with a cursor the arrows move and a click sets. Enter opens the focused
comment in tela, `m` marks it read, `a` marks them all, `o` opens tela,
`p` the Comments palette.

## What it does not do

- No daily or journal page: tela has none; Quick Notes is its scratchpad
  and stands in at the top of Pages.
- No editing of a page's body (no append): that is tela's MCP, not a
  launcher's job; the panel reads, opens, comments and creates.
- No per-space filter on Search: the REST search has no space parameter;
  sections by space do the sorting.
- The research answer is tela's grounding and sources, not an LLM's prose:
  that is tela's Ask page (`⌘⇧O`), which spends model credits.
- A comment's anchor is typed, not picked: the panel has no text
  selection over a page.

## Settings, `[extensions.tela]`

| key | type | default | what |
| --- | --- | --- | --- |
| `base_url` | text | (none) | The instance's origin. |
| `token` | secret | (none) | A personal access token from Settings, API Keys. |
| `default_space` | text | (none) | The space New tela page offers first: name, slug or id. |
| `research` | boolean | `true` | Show Ask tela. |

The bar item is hidden at zero; `show = "always"` under
`[bar.items."tela/inbox"]` keeps the glyph on the strip anyway, muted,
with the same popover (docs/config.md).

For the tests, `PAL_TELA_URL` and `PAL_TELA_TOKEN` replace the two
settings; `host/test/extensions/tela-mock.ts` is a mock instance the tests
and the screenshot fixture (`fixture.ts`) run against.
