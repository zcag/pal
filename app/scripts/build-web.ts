#!/usr/bin/env bun
// The web build: the panel as a static site in app/dist-web (vite.web.config.ts),
// the SDK as `ext/sdk.js` for the page's import map, and each extension built
// for the browser into `ext/<name>/` with `@zcag/pal` left to that map.
//
//   bun app/scripts/build-web.ts [name...]
import { $ } from "bun";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = `${root}/app/dist-web`;
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["calc", "wordle", "2048", "weather", "emoji", "colors", "unicode", "sudoku", "minesweeper", "blackjack", "home-assistant"];

const nodeShim: import("bun").BunPlugin = {
  name: "node-shim",
  setup(b) { b.onResolve({ filter: /^node:(fs|fs\/promises|path|os|async_hooks)$/ }, () => ({ path: `${root}/app/src/web/node.ts` })); },
};
const build = async (entry: string, outdir: string, external: string[] = []) => {
  const r = await Bun.build({ entrypoints: [entry], outdir, target: "browser", format: "esm", splitting: true, external, plugins: [nodeShim], naming: { entry: "[name].js", chunk: "[name]-[hash].js" } });
  if (!r.success) throw new AggregateError(r.logs, `build of ${entry} failed`);
};

await $`npx vite build -c vite.web.config.ts`.cwd(`${root}/app`).quiet();
await mkdir(`${out}/ext`, { recursive: true });
await build(`${root}/sdk/src/index.ts`, `${out}/ext`);
await $`mv ${out}/ext/index.js ${out}/ext/sdk.js`;
for (const name of names) {
  const dir = `${root}/extensions/${name}`;
  if (existsSync(`${dir}/package.json`) && !existsSync(`${dir}/node_modules`)) await $`bun install`.cwd(dir).quiet();
  await build(`${dir}/index.ts`, `${out}/ext/${name}`, ["@zcag/pal"]);
  await cp(`${dir}/pal.json`, `${out}/ext/${name}/pal.json`);
}
await $`mv ${out}/web.html ${out}/index.html`;
await Bun.write(`${out}/ext/index.json`, JSON.stringify(names));
console.log(`${out}: ${names.length} extensions`);
