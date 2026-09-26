# Google Search

Google from the panel. Suggestions need no key; web results and instant
answers come from a provider you pick. An input palette, plus a few rows
at the root when nothing on the machine matched.

## What you see

| where | rows |
| --- | --- |
| nothing typed | a one-line tip, then your recent searches |
| `kadıköy` | Search Google for “kadıköy”, then up to eight suggestions; one Google recognises (a person, place, thing) has its line and thumbnail, and its Wikipedia card in the pane |
| with a provider | the pane previews the answer and the first five results for the row under the cursor; cmd+Enter lists them as rows |
| the root, nothing matched | up to three suggestions under Search the web |

Suggestions come from Google's homepage suggest endpoint on every
keystroke (70-100 ms warm); a newer keystroke cancels the older request
and answers are kept ten minutes. When that endpoint fails, the
documented `suggestqueries` one answers, decoded from the charset it names
(ISO-8859-9 for Turkish).

The root rows are asked for only once the "Use “q” with" section shows,
so it paints at once and a query pal answered itself (an app, a file, a
snippet) is never sent to Google. `root = false` turns them off.
`google ` jumps into the palette; `[palettes.google] alias = "g"` makes
it `g `.

## Results

| `provider` | what | needs |
| --- | --- | --- |
| `none` | suggestions only (the default) | nothing |
| `serpapi` | Google's own results, the answer box (weather, a conversion, a calculation, a definition), the knowledge panel | `serpapi_key`; the free plan is 250 searches a month, so pair it with `results = "ask"` |
| `brave` | Brave's index, its infobox | `brave_key` (Brave Search API) |
| `searxng` | your instance's engines, its answers and infoboxes | `searxng_url`, with `json` among its search formats |

There is no keyless option: on 2026-09-26 DuckDuckGo, Bing's RSS feed,
Qwant, Ecosia, Mojeek, Startpage and Yahoo all refused a program or
answered badly, and Google's page needs JavaScript. The pane's preview
and the results level share one cached request per query.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Search Google; on a result, open it; on the answer, its source |
| `tab` | Put the suggestion in the box |
| `cmd+enter` | Results here (with a provider); on a result, open it in the background; at the root, open this palette |
| `cmd+b` | Search in the background |
| `cmd+c` | Copy the text; on a result, the link; on the answer, the answer |
| `cmd+l` | Copy the search link |
| `cmd+shift+c` | On a result: copy as a Markdown link |
| `ctrl+x` | Remove a recent search |

## Settings

`provider`, the keys above, `results` (`typing` or `ask`), `language`
(auto follows the system), `region`, `safe_search`, `browser` (where
searches and results open), `root`, `history`. The full table is in
[docs/palettes.md](../../docs/palettes.md#google-search-google).
