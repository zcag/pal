// Lists one bundled palette through the host harness and prints its meta and
// rows as JSON, the raw material of a screenshot fixture (src/gallery/shots).
// The core's capabilities answer from the harness's canned tables, so the
// clipboard, windows and system rows are fixture data; anything an extension
// reads from this machine itself (apps, bookmarks, ssh hosts) is real and is
// trimmed or replaced by hand before it goes into a fixture.
//
//   bun app/scripts/shot-list.ts <extension> <palette> [query] [filter]
//   SHOT_SETTINGS='{"config":"/tmp/x.toml"}'   an overlay on the extension's settings
//   SHOT_DETAIL=1                              also asks detail(id) for every row
//   SHOT_STORAGE='{"rates":{...}}'             the extension's storage, pre-seeded
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";

const [ext, palette, query, filter] = process.argv.slice(2);
if (!ext || !palette) { console.error("usage: shot-list <extension> <palette> [query] [filter]"); process.exit(2); }
for (const [k, v] of Object.entries(process.env.SHOT_STORAGE ? JSON.parse(process.env.SHOT_STORAGE) : {})) stored.set(`${ext}\0${k}`, v);
const overlay = process.env.SHOT_SETTINGS ? { [ext]: { settings: JSON.parse(process.env.SHOT_SETTINGS) } } : {};
const host = await Host.bundled({ roots: [BUNDLED], settings: overlay, timeout: 20000 });
try {
  const hello = await host.hello();
  const e = hello.extensions.find((x) => x.name === ext);
  if (!e) throw new Error(`no extension ${ext}; loaded: ${hello.extensions.map((x) => x.name).join(", ")}`);
  if (!e.loaded) throw new Error(`${ext} failed to load: ${hello.errors[ext]}`);
  const meta = e.palettes.find((p) => p.name === palette);
  if (!meta) throw new Error(`no palette ${palette}; has ${e.palettes.map((p) => p.name).join(", ")}`);
  const items = await host.list(ext, palette, query, filter ? { filter } : undefined);
  const details: Record<string, unknown> = {};
  if (process.env.SHOT_DETAIL && meta.detail === "lazy") for (const i of items) details[i.id] = await host.detail(ext, palette, i.id).catch((err) => ({ error: String(err) }));
  console.log(JSON.stringify({ meta, items, ...(Object.keys(details).length ? { details } : {}) }, null, 2));
} finally {
  await host.close();
}
