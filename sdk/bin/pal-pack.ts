#!/usr/bin/env bun
// pal-pack: builds pal extensions into packages and writes a registry's
// index (docs/registry.md). The work is in ../pack/pack.ts.
import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildAll, promote, writeIndex, writeStatements } from "../pack/pack.ts";
import { treeHash } from "../pack/treehash.ts";

const USAGE = `pal-pack build <dir>... [--out dist] [--cwd <root>] [--prefix P] [--seq N] [--commit SHA] [--screenshots-base URL] [--dir-only]
    each extension directory into <out>/<name>/, <out>/<name>.tar.gz and <out>/<name>.entry.json;
    --dir-only writes the directory alone, with .pal-build.json in it (the bundled form);
    --prefix builds a copy staged at P/<name>, so the output's source paths read P/<name>/...
pal-pack statements <dist>
    <dist>/<name>.statement per entry, for minisign -S -m
pal-pack index <dist> --name <registry> --base <url> --out <dir> [--merge index.json] [--yank name@hash]... [--keep a,b] [--drop a,b] [--key KEY] [--next-key KEY]
    <out>/index.json and <out>/pkg/<name>/<hash>.{tar.gz,json} from the signed entries
pal-pack promote --from <index.json> --to <index.json> --out <index.json> [--names a,b] [--yank name@hash]...
    the newest good build of each (or each named) extension in --from added to --to
pal-pack tree-hash <dir>...
    each package directory's tree hash (pal-tree-v1), one a line`;

const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      out: { type: "string" }, cwd: { type: "string" }, prefix: { type: "string" }, seq: { type: "string" }, commit: { type: "string" },
      "screenshots-base": { type: "string" }, "dir-only": { type: "boolean" },
      name: { type: "string" }, base: { type: "string" }, merge: { type: "string" }, yank: { type: "string", multiple: true },
      keep: { type: "string" }, drop: { type: "string" }, key: { type: "string" }, "next-key": { type: "string" },
      from: { type: "string" }, to: { type: "string" }, names: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const need = (k: string, x: string | undefined) => { if (!x) throw new Error(`${cmd}: --${k} is required\n\n${USAGE}`); return x; };
  if (v.help || !cmd) return console.log(USAGE);
  switch (cmd) {
    case "build": {
      // A glob like `*/` or `extensions/*` also matches what sits beside the extensions (test/, a README): those are skipped, said on stderr.
      const dirs = pos.filter((p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? true);
      for (const p of pos) if (!dirs.includes(p)) console.error(`pal-pack: ${p}: not a directory, skipped`);
      if (!dirs.length) throw new Error(`build: no extension directory given\n\n${USAGE}`);
      const seq = v.seq === undefined ? undefined : Number(v.seq);
      if (seq !== undefined && !(Number.isInteger(seq) && seq > 0)) throw new Error(`build: --seq ${v.seq} is not a positive integer`);
      await buildAll(dirs, { out: v.out ?? "dist", cwd: v.cwd, prefix: v.prefix, seq, commit: v.commit, screenshotsBase: v["screenshots-base"], dirOnly: v["dir-only"] }, (e) =>
        console.log(`${e.name}\t${e.build.hash}\t${e.build.seq}\t${e.build.protocol}${v["dir-only"] ? "" : `\t${e.build.size}`}`),
      );
      return;
    }
    case "statements":
      if (pos.length !== 1) throw new Error(`statements: one dist directory\n\n${USAGE}`);
      for (const f of await writeStatements(pos[0])) console.log(f);
      return;
    case "index": {
      if (pos.length !== 1) throw new Error(`index: one dist directory\n\n${USAGE}`);
      const i = await writeIndex(pos[0], { name: need("name", v.name), base: need("base", v.base), out: need("out", v.out), merge: v.merge, yank: v.yank, keep: list(v.keep), drop: list(v.drop), key: v.key, nextKey: v["next-key"] });
      console.log(`${v.out}/index.json: ${i.extensions.length} extensions, ${i.extensions.reduce((n, e) => n + e.builds.length, 0)} builds`);
      return;
    }
    case "promote": {
      const i = await promote({ from: need("from", v.from), to: need("to", v.to), out: need("out", v.out), names: list(v.names), yank: v.yank });
      console.log(`${v.out}: ${i.extensions.length} extensions, ${i.extensions.reduce((n, e) => n + e.builds.length, 0)} builds`);
      return;
    }
    case "tree-hash":
      if (!pos.length) throw new Error(`tree-hash: a package directory\n\n${USAGE}`);
      for (const p of pos) console.log(await treeHash(p));
      return;
    default:
      throw new Error(`unknown command ${cmd}\n\n${USAGE}`);
  }
}

await main(process.argv.slice(2)).catch((e) => {
  console.error(`pal-pack: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
