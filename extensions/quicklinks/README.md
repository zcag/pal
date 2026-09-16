# Quicklinks

Your own links, kept in the extension's storage and edited in the panel.
Enter on a link opens it. A link whose url has a `{query}` placeholder
(`https://github.com/search?q={query}`; Raycast's `{argument}` and
`{argument name="Repo"}` are read the same way) drills in instead: the
input fills the placeholder as you type, percent-encoded, and Enter opens
the filled url (`cmd+c` copies it). The row shows the placeholder as a tag
and the url as its subtitle; the icon is the site's favicon; keywords are
extra words the search matches.

The palette is indexed, so a quicklink's name and keywords find it from
the root, and the rows after the list are its tools:

| row | what |
| --- | --- |
| Create Quicklink | a form: name, url, keywords (space or comma separated) |
| Import Quicklinks | a form with one path field; reads a JSON array of `{name, url, keywords?}` (Raycast's `{name, link}` export too), skips the urls you already have, says how many came in |
| Export Quicklinks | writes your own links as a JSON array (no ids) to the path, `~/Downloads/pal-quicklinks.json` by default, replacing the file |

A url the opener could not take (no scheme, not a path) is refused with
the message under the field; a path that cannot be read or written, the
same. The detail pane (`cmd+i`) shows the url in a code block, what the
link asks for, its keywords and where it came from.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open the url, or drill in to fill its `{query}` first |
| `cmd+c` | Copy URL, as stored (placeholder included); inside the drill-in, the filled url |
| `cmd+e` | Edit: the form, filled in |
| `ctrl+x` | Delete, after a confirm |
| `cmd+i` | The detail pane |

An imported link (from the `import` file) has Open and Copy URL only.

## Setup

Nothing to install and no permission: the links live in
`<data dir>/pal/storage/quicklinks.json` (Storage in the Extensions guide),
shared by every config profile.

Settings, `[extensions.quicklinks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `import` | path | (none) | A JSON array of `{name, url, keywords?}` listed alongside your own links, read-only, read on every listing. `~` is expanded. A file that cannot be read lists nothing and says so in the log. |

A quicklink file for `import` looks like this:

```json
[
  { "name": "GitHub search", "url": "https://github.com/search?q={query}", "keywords": ["gh", "code"] },
  { "name": "Wikipedia", "url": "https://en.wikipedia.org/wiki/{query}" }
]
```

## What it does not do

- No `{query}` at the root: a search link needs its drill-in, so `gh
  rust` at the root does not open a GitHub search. Open the link's row
  first, then type.
- No browser choice: the url goes to the system opener. The Bookmarks
  palette has "Open in Chrome/Safari" for a browser's own bookmarks.
- Two different placeholders in one url: every one is filled with the
  same text, since the drill-in has one input.
- Import does not merge edits: a link whose url you already have is
  skipped, whatever its name or keywords in the file.

## Platforms

macOS and Linux, the same on both.
