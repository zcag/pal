// Writes app/src/gallery/shots/generate.json, the store screenshots'
// fixture: the palette listed through the host harness for the four
// queries the shots type, so the rows are what the code draws today.
// Secrets and identifiers are whatever this run made; nothing is the
// owner's. `bun run extensions/generate/fixture.ts`, then
// `node app/scripts/shots.mjs generate`.
import { writeFileSync } from "node:fs";
import { Host } from "../../host/test/harness.ts";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE5MDAwMDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const QUERIES = ["", "hash pal", "qr https://pal.cagdas.io", `jwt ${JWT}`];

const host = await Host.bundled();
try {
  const meta = host.loaded().find((l) => l.extension === "generate")!.palettes[0];
  const byQuery: Record<string, unknown> = {};
  for (const q of QUERIES) byQuery[q] = await host.list("generate", "generate", q);
  const fixture = {
    palettes: { generate: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, byQuery } },
    shots: {
      "1-everything": { palette: "generate", keys: ["down*4"] },
      "2-hash": { palette: "generate", keys: ["type:hash pal", "cmd+k"] },
      "3-qr": { palette: "generate", keys: ["type:qr https://pal.cagdas.io", "cmd+i"] },
      "4-jwt": { palette: "generate", keys: [`type:jwt ${JWT}`, "down"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/generate.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/generate.json");
} finally {
  host.kill();
}
