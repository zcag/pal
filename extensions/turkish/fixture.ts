// Writes app/src/gallery/shots/turkish.json, the store screenshots' fixture:
// the rows index.ts lists through the host harness, for a sentence selected
// in the app in front (what the palette opens on) and for one typed into
// it (Turkish already, for the cases). The texts are made up. `bun run extensions/turkish/fixture.ts`, then
// `make shots EXT=turkish`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";

pinClock();
const SELECTED = "Bugun hava cok guzel, aksam Kadikoy'de bulusalim mi?";
const TYPED = "istanbul'da ılık bir eylül akşamı";
let selection: string | null = SELECTED;
const host = await Host.bundled({ core: { "selection.text": () => selection, "clipboard.current": () => null, "clipboard.list": () => [] } });
try {
  const meta = host.loaded().find((l) => l.extension === "turkish")!.palettes[0];
  const opened = await host.list("turkish", "turkish");
  selection = null;
  const typed = await host.list("turkish", "turkish", TYPED);
  writeFixture("turkish", {
    palettes: { turkish: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, byQuery: { "": opened, [TYPED]: typed } } },
    shots: {
      "1-selection": { palette: "turkish", keys: [], caption: "Opened over a selected sentence: its Turkish letters back, the reverse and the three cases; Enter replaces the selection" },
      "2-detail": { palette: "turkish", keys: ["cmd+i"], caption: "cmd+i shows the result over the source, what changed and where the text came from" },
      "3-cases": { palette: "turkish", keys: [`type:${TYPED}`], caption: "Typed Turkish: the cases keep i and ı apart (İSTANBUL, ILIK) and a suffix after an apostrophe stays down" },
      "4-actions": { palette: "turkish", keys: [`type:${TYPED}`, "down*2", "cmd+k"], caption: "Paste, copy, hand the row to Translate, or copy the source text" },
    },
  });
  console.log("wrote app/src/gallery/shots/turkish.json");
} finally {
  host.kill();
}
