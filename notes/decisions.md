# Decisions so far

Working notes for the `pali` iteration. Short, dated, appended as things settle.
Not the contract: the contract evolves during development and gets written
down as it stabilises.

## 2026-09-16

- **Clean rewrite** on the orphan branch `pali`; v1 stays on `main`, checked
  out at `~/proj/pal-v1` for reference. `pali` takes over `main` when done.
- **Name is `pal`**. `pali` is the iteration, not the product.
- **Product**: a standalone app people download and use. macOS and Linux.
  Raycast and Spotlight are the behaviour references throughout; the visual
  identity is ours.
- **Bar**: high polish everywhere. No corners cut, no rushing, minute UX
  details thought through.
- **Shell**: Tauri v2 (Rust core, React UI in the system webview), the same
  shape as Raycast 2.0. Go/no-go passed on hornet, dev build: hotkey to paint
  ~30 ms steady (706 ms first show, to fix by pre-painting), keystroke to
  filtered list 14-42 ms over 14.7k rows, 14.7k rows streamed from a child
  process in ~70 ms. Linux numbers still to take on marko.
- **Root search**: one search box across everything, palettes are sections
  and drill-downs (Spotlight/Raycast model), not a root that lists palettes.
- **Extensibility, one way**: every palette, including every default one, is
  an extension against the same API. No native palette tier. In-app code is
  shell (root search, action panel, settings, store, first run) and OS
  capabilities exposed to extensions as APIs (clipboard, windows, apps,
  files, hotkeys).
- **Extensions are TypeScript**, run in one long-lived extension host (Bun as
  a sidecar), and describe UI as a render tree from a fixed component set,
  never HTML. Scripts and data files remain as the zero-code tier, run by one
  built-in extension. Raycast API compatibility: nice to have, not required;
  keep the component set close enough that a shim stays plausible.
- **Settings**: an extensive settings view where a user sets up everything.
  Extensions declare their own settings; palette extensions additionally get
  a set of pal-provided per-palette defaults (hotkey, alias, enabled, ranking
  behaviour and the like) without declaring them.
- **Hotkey on hornet**: Ctrl+Space for now (Alt+Space is taken).
- **Order of work**: lock the UI first (design brief, component set, keyboard
  grammar), then the protocol and extension host.
- **Config is declarative and file-first.** Everything the settings view can
  set lives in a config file the user can edit and version-control; the UI
  is a front for the file, never the only path. Extension settings and the
  per-palette defaults are part of the same file. The two directions stay in
  sync: a UI change writes the file, a file change is picked up live (watch),
  and the file keeps the user's formatting and comments where the format
  allows. Whichever format we pick, pal ships a schema so an editor can
  validate and complete it.
- **The pit board for pal** (pit.cagdas.io) collects findings from a research
  pass on how Raycast does things. Its `in` lane is "relevant", not "we will
  build this": a card there is input to a decision here, never a commitment.
  Decisions still get made in this file, one at a time.

## Open for Cagdas

Things an agent could not decide alone; each waits for a call.

- **HUD after copy.** The panel is the only window and goes to alpha 0 on
  hide, so a Raycast-style "Copied" HUD needs a second small NSPanel. Worth
  one, or is the hide itself enough feedback?
- **Exact-name priority vs frecency.** A frecency-boosted item (a picked
  emoji) can outrank a bookmark named exactly what was typed (`ha`). Raycast
  gives exact alias/name matches priority over history. Same here?
- **Font, match highlight, selection shape** from the brief (bundled Plex vs
  system stack; amber highlighter vs coloured glyphs; inset pill vs full-bleed
  row). Unchanged until you have used the panel.
