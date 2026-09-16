// Writes app/src/gallery/shots/translate.json, the store screenshots'
// fixture: the palette listed through the host harness against the
// translate mock (host/test/extensions/translate-mock.ts, the real
// endpoint's answers of 2026-09-17), with `to = tr` so the shots show the
// Turkish and English pair, and a history of what the shots picked.
// Nothing is the owner's. `bun run extensions/translate/fixture.ts`,
// then `node app/scripts/shots.mjs translate`.
import { writeFileSync } from "node:fs";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock } from "../../host/test/extensions/translate-mock.ts";

const QUERIES = ["hello world", "tr>en merhaba dünya. Nasılsın?", ">ja hello"];

const { server, base } = startMock();
process.env.PAL_TRANSLATE_GOOGLE = base;
process.env.PAL_TRANSLATE_DEEPL = base;
process.env.PAL_TRANSLATE_SAY = "/usr/bin/true";
stored.clear();
const host = await Host.bundled({ settings: { translate: { settings: { to: "tr" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "translate")!;
  const [translate, history] = l.palettes;
  const byQuery: Record<string, unknown> = {};
  for (const q of QUERIES) byQuery[q] = await host.list("translate", "translate", q);
  // What a person would have copied: a history with the three, the newest first.
  await host.list("translate", "translate", ">ja hello");
  await host.pick("translate", "translate", "translation");
  await host.list("translate", "translate", "tr>en merhaba dünya. Nasılsın?");
  await host.pick("translate", "translate", "translation");
  await host.list("translate", "translate", "hello world");
  await host.pick("translate", "translate", "translation");
  // Spread the entries over the day, as a used history reads.
  const ages = [2 * 60e3, 3 * 3600e3, 26 * 3600e3];
  const rows = (await host.list("translate", "history")).map((r, i) => (i < ages.length ? { ...r, accessories: [{ date: Date.now() - ages[i] }] } : r));
  const fixture = {
    palettes: {
      translate: { title: translate.title, icon: translate.icon, input: true, placeholder: translate.placeholder, byQuery },
      history: { title: history.title, icon: history.icon, live: true, placeholder: history.placeholder, items: rows },
    },
    shots: {
      "1-translate": { palette: "translate", keys: ["type:hello world", "wait:500"] },
      "2-prefix": { palette: "translate", keys: ["type:tr>en merhaba dünya. Nasılsın?", "wait:500", "cmd+i"] },
      "3-romanisation": { palette: "translate", keys: ["type:>ja hello", "wait:500", "down"] },
      "4-actions": { palette: "translate", keys: ["type:hello world", "wait:500", "cmd+k"] },
      "5-history": { palette: "history", keys: ["down"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/translate.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/translate.json");
} finally {
  host.kill();
  server.stop(true);
}
