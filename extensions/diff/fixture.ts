// Writes app/src/gallery/shots/diff.json, the store screenshots' fixture:
// the view and the pick palette through the host harness over a made-up
// clipboard history (a CI workflow copied before and after an edit, a few
// other texts), so every tree is what index.ts and view.ts draw for it.
// `bun run extensions/diff/fixture.ts`, then `make shots EXT=diff`.
import { Host } from "../../host/test/harness.ts";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { View } from "../../sdk/src/protocol.ts";
pinClock();
const BEFORE = `name: release
on:
  push:
    tags: ["v*"]
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
  publish:
    needs: build
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
const AFTER = BEFORE
  .replace(`    tags: ["v*"]\n`, `    tags: ["v*"]\n  workflow_dispatch:\n`)
  .replaceAll("ubuntu-22.04", "ubuntu-24.04")
  .replace("      - run: npm publish\n", "      - run: npm publish --provenance\n");

const min = 60_000;
const entry = (id: number, text: string, ago: number, app: string, name: string | null = null) => ({ id, kind: "text", text, image: null, files: null, source_app: app, at: NOW - ago, bytes: text.length, pinned: false, width: null, height: null, name });
const HISTORY = [
  entry(41, AFTER, 2 * min, "com.microsoft.VSCode", "release.yml, edited"),
  entry(40, BEFORE, 9 * min, "com.google.Chrome", "release.yml"),
  entry(39, "Thanks, the staging deploy is green. I'll cut v2.4.0 after lunch.", 26 * min, "com.tinyspeck.slackmacgap"),
  entry(38, "SELECT id, email, created_at\nFROM users\nWHERE created_at > now() - interval '7 days'\nORDER BY created_at DESC;", 48 * min, "net.kovidgoyal.kitty"),
  entry(37, "https://docs.example.com/actions/security/provenance", 71 * min, "com.google.Chrome"),
  entry(36, "Release checklist\n- bump the version\n- tag and push\n- watch the workflow\n- announce in #releases", 3 * 60 * min, "com.apple.Notes"),
];
const text = HISTORY.filter((e) => e.kind === "text");

const host = await Host.bundled({
  core: {
    "clipboard.list": ({ query = "", offset = 0, limit = 50 }: { query?: string; offset?: number; limit?: number }) => text.filter((e) => !query || e.text.toLowerCase().includes(query.toLowerCase())).slice(offset, offset + limit),
    "clipboard.get": ({ id }: { id: number }) => HISTORY.find((e) => e.id === id) ?? null,
    "clipboard.current": () => HISTORY[0],
    "selection.text": () => null,
  },
});
try {
  const [diff, pick] = host.loaded().find((l) => l.extension === "diff")!.palettes;
  const unified = await host.request<View>("view", { extension: "diff", palette: "diff" });
  const side = (await host.pick("diff", "diff", unified.id!, "side")).view as View;

  const rows = await host.list("diff", "pick", "");
  const meta = { title: diff.title, icon: diff.icon, view: "view" };
  writeFixture("diff", {
    palettes: {
      diff: { ...meta, tree: unified },
      side: { ...meta, tree: side },
      pick: { title: pick.title, icon: diff.icon, input: true, placeholder: pick.placeholder, byQuery: { "": rows } },
    },
    shots: {
      "1-unified": { palette: "diff", keys: ["wait:300"], caption: "The two newest copies diffed: the older on the left, the words that changed marked, unchanged runs folded" },
      "2-side": { palette: "side", keys: ["wait:300"], caption: "s puts the sides next to each other" },
      "3-actions": { palette: "diff", keys: ["wait:300", "cmd+k"], caption: "Every key on ⌘K: copy the unified diff or either side, open both in your diff tool, other sources" },
      "4-history": { palette: "pick", keys: [], caption: "Any two from the clipboard history: pick the left, then the right, or mark two and press Enter" },
    },
  });
  console.log("wrote app/src/gallery/shots/diff.json");
} finally {
  host.kill();
}
