// pal-pack's work (docs/registry.md): build an extension into a package
// and its index entry, write the statements a key signs, and write or
// promote a registry index. The CLI is ../bin/pal-pack.ts; build-extensions.sh,
// our CI and third parties all run this one implementation.
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { PROTOCOL } from "../src/protocol.ts";
import { tarball } from "./tar.ts";
import { treeHash, walk } from "./treehash.ts";

/** What the Store, root search and Games show without fetching anything else (docs/registry.md, "Index"). */
export type Listing = {
  title: string;
  description?: string;
  tagline?: string;
  category?: string;
  keywords: string[];
  icon?: unknown;
  author?: string;
  /** Empty: every platform. */
  platforms: string[];
  play: boolean;
  palettes: { id: string; title: string; kind: string; icon?: unknown }[];
  screenshots: { url: string; caption: string }[];
  requires: string[];
  suggests: string[];
};
export type BuildInfo = { hash: string; seq: number; protocol: number; commit: string };
/** `<name>.entry.json`: one built extension, before signing. */
export type Entry = { name: string; listing: Listing; build: BuildInfo & { size: number } };
export type IndexBuild = BuildInfo & { url: string; manifest: string; size: number; sig: string; yanked: boolean };
export type IndexExtension = { name: string; listing: Listing; builds: IndexBuild[] };
/** `key` is optional (docs/registry.md "Index"): absent, not null, when unset. */
export type Index = { format: 1; name: string; generated_at: string; key?: string; next_key: string | null; extensions: IndexExtension[] };

type Json = Record<string, any>;
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const readJson = async (file: string): Promise<Json> => JSON.parse(await readFile(file, "utf8"));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const exists = (p: string) => stat(p).then(() => true, () => false);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function git(cwd: string, ...args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

// ---- build -------------------------------------------------------------------

export type BuildOptions = {
  /** Where `<name>/`, `<name>.tar.gz` and `<name>.entry.json` go. */
  out: string;
  /** The directory `bun build` runs in, which the source-path comments in the output are relative to: the git toplevel of the extension by default. */
  cwd?: string;
  seq?: number;
  commit?: string;
  /** `https://pal.cagdas.io/extensions`: screenshot urls become `<base>/<name>/screenshots/<file>`; without it the listing has none. */
  screenshotsBase?: string;
  /** The directory alone, with `.pal-build.json` in it (the bundled form, build-extensions.sh): no tarball, no entry. */
  dirOnly?: boolean;
  /** The bun that builds; this one by default. */
  bun?: string;
};

/**
 * The listing from the manifest: the store block's shelf fields, the
 * palettes as the manifest declares them (a title the manifest leaves to
 * the code is the extension's for a palette named after it, else the
 * key), absolute screenshot urls.
 */
export function listingOf(m: Json, screenshotsBase?: string): Listing {
  const store: Json = m.store && typeof m.store === "object" ? m.store : {};
  const palettes = Object.entries((m.palettes && typeof m.palettes === "object" ? m.palettes : {}) as Record<string, Json>).map(([id, p]) => ({
    id,
    title: str(p?.title) ?? (id === m.name ? str(m.title) ?? id : id),
    kind: str(p?.kind) ?? "list",
    ...(p?.icon !== undefined && { icon: p.icon }),
  }));
  const shots = Array.isArray(store.screenshots) ? (store.screenshots as Json[]) : [];
  const base = screenshotsBase?.replace(/\/+$/, "");
  const drop = <T extends Json>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return drop({
    title: str(m.title) ?? m.name,
    description: str(m.description),
    tagline: str(store.tagline),
    category: str(store.category),
    keywords: strs(m.keywords),
    icon: m.icon,
    author: str(m.author),
    platforms: strs(store.platforms),
    play: store.play === true,
    palettes,
    screenshots: base ? shots.filter((s) => str(s?.file)).map((s) => ({ url: `${base}/${m.name}/screenshots/${s.file}`, caption: str(s.caption) ?? "" })) : [],
    requires: strs(m.requires),
    suggests: strs(m.suggests),
  });
}

/** Files and directories copied as they are, the exec bit kept and every other mode bit normalised. */
async function copyTree(from: string, to: string) {
  const { files, dirs } = await walk(from);
  for (const d of dirs) await mkdir(join(to, d.path), { recursive: true });
  for (const f of files) {
    await mkdir(dirname(join(to, f.path)), { recursive: true });
    await copyFile(f.abs, join(to, f.path));
    await chmod(join(to, f.path), f.exec ? 0o755 : 0o644);
  }
}

/**
 * One extension directory built into `<out>/<name>/`: `bun build` of its
 * index.ts with `@zcag/pal` external, its pal.json with `protocol` stamped,
 * and for a game its `surface/` with the sources beside index.ts the page
 * imports. Then the tree hash, and unless `dirOnly` the tarball and entry.
 */
export async function build(dir: string, o: BuildOptions): Promise<Entry> {
  dir = resolve(dir);
  const name = basename(dir);
  const manifest = await readJson(join(dir, "pal.json")).catch((e) => { throw new Error(`${name}: pal.json: ${e instanceof Error ? e.message : e}`); });
  if (manifest.name !== name) throw new Error(`${name}: pal.json names it ${JSON.stringify(manifest.name)}; the directory and the manifest must agree`);
  const cwd = resolve(o.cwd ?? git(dir, "rev-parse", "--show-toplevel") ?? process.cwd());
  const seq = o.seq ?? Number(git(dir, "log", "-1", "--format=%ct"));
  if (!Number.isInteger(seq) || seq <= 0) throw new Error(`${name}: no commit time to use as seq (not in a git checkout?): pass --seq`);
  const commit = o.commit ?? git(dir, "rev-parse", "HEAD") ?? "";
  const out = resolve(o.out);
  const pkg = join(out, name);
  await rm(pkg, { recursive: true, force: true });
  await mkdir(pkg, { recursive: true });
  // Async, so `buildAll` runs several at once.
  const p = Bun.spawn([o.bun ?? process.execPath, "build", join(dir, "index.ts"), "--target", "bun", "--splitting", "--external", "@zcag/pal", "--outdir", pkg], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code !== 0) throw new Error(`${name}: bun build failed\n${(stderr || stdout).trim()}`);
  for (const f of (await walk(pkg)).files) await chmod(f.abs, 0o644);
  await writeFile(join(pkg, "pal.json"), json({ ...manifest, protocol: PROTOCOL }));
  // A game surface's page loads its files by URL (`ext://`, surface.rs): the
  // page as is, and the sources beside index.ts it imports (`../game.ts`).
  // Never index.ts, which the host would load over index.js; never the
  // screenshot fixture, which no page imports.
  if (await exists(join(dir, "surface", "."))) {
    await copyTree(join(dir, "surface"), join(pkg, "surface"));
    for (const f of await readdir(dir)) {
      if (f.endsWith(".ts") && !["index.ts", "fixture.ts"].includes(f) && !f.endsWith(".test.ts") && !f.startsWith(".")) {
        await copyFile(join(dir, f), join(pkg, f));
        await chmod(join(pkg, f), 0o644);
      }
    }
  }
  const info: BuildInfo = { hash: await treeHash(pkg), seq, protocol: PROTOCOL, commit };
  if (o.dirOnly) {
    // Beside the manifest, a dotfile so the hash never covers it (docs/design/distribution.md, "Packages").
    await writeFile(join(pkg, ".pal-build.json"), json(info));
    return { name, listing: listingOf(manifest, o.screenshotsBase), build: { ...info, size: 0 } };
  }
  const gz = await tarball(pkg, name);
  await writeFile(join(out, `${name}.tar.gz`), gz);
  const entry: Entry = { name, listing: listingOf(manifest, o.screenshotsBase), build: { ...info, size: gz.length } };
  await writeFile(join(out, `${name}.entry.json`), json(entry));
  return entry;
}

/** Every extension in `dirs` built, a few at a time; the first failure fails the whole (after the others finished, so each one's error is printed). */
export async function buildAll(dirs: string[], o: BuildOptions, onEntry: (e: Entry) => void = () => {}): Promise<Entry[]> {
  const names = dirs.map((d) => basename(resolve(d)));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`${dup}: given twice`);
  const results: Entry[] = new Array(dirs.length);
  const errors: string[] = [];
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < dirs.length; i = next++) {
      try {
        results[i] = await build(dirs[i], o);
        onEntry(results[i]);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, dirs.length) }, lane));
  if (errors.length) throw new Error(errors.join("\n"));
  return results;
}

// ---- statements --------------------------------------------------------------

/** What a key signs for one build (docs/registry.md, "Statement and signature"). */
export const statement = (name: string, b: Pick<BuildInfo, "hash" | "seq" | "protocol">) => `pal-build-v1\n${name}\n${b.hash}\n${b.seq}\n${b.protocol}\n`;

/** Every `<name>.entry.json` in `dist`, by name. */
export async function readEntries(dist: string): Promise<Entry[]> {
  const files = (await readdir(dist)).filter((f) => f.endsWith(".entry.json")).sort();
  return Promise.all(files.map((f) => readJson(join(dist, f)) as Promise<Entry>));
}

/** `<dist>/<name>.statement` per entry; the paths written. */
export async function writeStatements(dist: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readEntries(dist)) {
    const file = join(dist, `${e.name}.statement`);
    await writeFile(file, statement(e.name, e.build));
    out.push(file);
  }
  return out;
}

// ---- index -------------------------------------------------------------------

const byBuild = (a: IndexBuild, b: IndexBuild) => b.seq - a.seq || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);

/**
 * The builds a registry keeps (docs/registry.md, "Index"): the newest good
 * build per protocol and the good one before the newest overall (the
 * rollback target). A yanked build stays listed while it is newer than the
 * oldest kept one, so an app that has it installed learns it was pulled.
 */
export function retain(builds: IndexBuild[]): IndexBuild[] {
  const sorted = [...builds].sort(byBuild);
  const good = sorted.filter((b) => !b.yanked);
  if (!good.length) return sorted;
  const keep = new Set<string>();
  const protocols = new Set<number>();
  for (const b of good) if (!protocols.has(b.protocol)) { protocols.add(b.protocol); keep.add(b.hash); }
  if (good[1]) keep.add(good[1].hash);
  const floor = Math.min(...good.filter((b) => keep.has(b.hash)).map((b) => b.seq));
  return sorted.filter((b) => keep.has(b.hash) || (b.yanked && b.seq >= floor));
}

/** One build in the index's key order. */
const normBuild = (b: IndexBuild): IndexBuild => ({ hash: b.hash, seq: b.seq, protocol: b.protocol, commit: b.commit ?? "", url: b.url, manifest: b.manifest, size: b.size, sig: b.sig, yanked: !!b.yanked });

/** `index` with one more build of `name`: not duplicated when its hash is listed already; the listing follows the newest build. */
export function addBuild(index: Index, name: string, listing: Listing, build: IndexBuild): void {
  let ext = index.extensions.find((e) => e.name === name);
  if (!ext) index.extensions.push((ext = { name, listing, builds: [] }));
  if (ext.builds.some((b) => b.hash === build.hash)) return;
  const newest = ext.builds.reduce((m, b) => Math.max(m, b.seq), -Infinity);
  if (build.seq >= newest) ext.listing = listing;
  ext.builds = retain([...ext.builds, build]);
}

/** `name@hash` marked yanked; a spec that names no listed build throws. */
export function yank(index: Index, spec: string): void {
  const [name, hash] = spec.split("@");
  const b = index.extensions.find((e) => e.name === name)?.builds.find((b) => b.hash === hash);
  if (!b) throw new Error(`--yank ${spec}: no such build in the index`);
  b.yanked = true;
}

/** An index parsed and checked, or a fresh one when there is none. */
export async function readIndex(file: string | undefined, name: string): Promise<Index> {
  if (!file || !(await exists(file))) return { format: 1, name, generated_at: "", next_key: null, extensions: [] };
  const i = (await readJson(file)) as Index;
  if (i.format !== 1) throw new Error(`${file}: index format ${i.format}, this pal-pack writes 1`);
  if (!Array.isArray(i.extensions)) throw new Error(`${file}: no extensions list`);
  return i;
}

/** The index as written: stable key order, extensions by name, builds newest first, `generated_at` now (RFC 3339, UTC, whole seconds). */
export function finish(index: Index, now = new Date()): Index {
  return {
    format: 1,
    name: index.name,
    generated_at: now.toISOString().replace(/\.\d+Z$/, "Z"),
    ...(index.key ? { key: index.key } : {}),
    next_key: index.next_key ?? null,
    extensions: [...index.extensions]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((e) => ({ name: e.name, listing: e.listing, builds: [...e.builds].sort(byBuild).map(normBuild) })),
  };
}

export type IndexOptions = {
  /** The registry's name (`[[store.registries]] name`). */
  name: string;
  /** Where `<out>` is served: packages are listed at `<base>/pkg/<name>/<hash>.tar.gz` and `.json`. */
  base: string;
  out: string;
  /** An index to build on (the live one): its builds are kept under the retention rule, its `key` and `next_key` too. */
  merge?: string;
  /** `name@hash` builds to mark yanked. */
  yank?: string[];
  /** When given, the index holds only these extensions and the ones in `dist`: an extension gone from the source leaves the index. */
  keep?: string[];
  /** The registry's current public key, which `pal registry add` shows and pins; `""` clears it. */
  key?: string;
  /** Announces the key the registry is moving to; `""` clears it. */
  nextKey?: string;
};

/**
 * `<out>/index.json` from the signed entries in `dist` (each needs its
 * `<name>.statement.minisig`), merged over `merge`; the packages and their
 * manifests copied to `<out>/pkg/<name>/<hash>.{tar.gz,json}`.
 */
export async function writeIndex(dist: string, o: IndexOptions): Promise<Index> {
  const index = await readIndex(o.merge, o.name);
  index.name = o.name;
  const base = o.base.replace(/\/+$/, "");
  const entries = await readEntries(dist);
  const missing = [];
  for (const e of entries) {
    const sig = await readFile(join(dist, `${e.name}.statement.minisig`), "utf8").catch(() => undefined);
    if (sig === undefined) { missing.push(e.name); continue; }
    const pkg = join(o.out, "pkg", e.name);
    await mkdir(pkg, { recursive: true });
    await copyFile(join(dist, `${e.name}.tar.gz`), join(pkg, `${e.build.hash}.tar.gz`));
    await copyFile(join(dist, e.name, "pal.json"), join(pkg, `${e.build.hash}.json`));
    const { hash, seq, protocol, commit, size } = e.build;
    addBuild(index, e.name, e.listing, { hash, seq, protocol, commit, url: `${base}/pkg/${e.name}/${hash}.tar.gz`, manifest: `${base}/pkg/${e.name}/${hash}.json`, size, sig, yanked: false });
  }
  if (missing.length) throw new Error(`no signature for ${missing.join(", ")}: sign ${missing.map((n) => `${n}.statement`).join(", ")} with minisign first`);
  if (o.keep) {
    const keep = new Set([...o.keep, ...entries.map((e) => e.name)]);
    index.extensions = index.extensions.filter((e) => keep.has(e.name));
  }
  for (const s of o.yank ?? []) yank(index, s);
  if (o.key !== undefined) index.key = o.key || undefined;
  if (o.nextKey !== undefined) index.next_key = o.nextKey || null;
  const done = finish(index);
  await mkdir(o.out, { recursive: true });
  await writeFile(join(o.out, "index.json"), json(done));
  return done;
}

export type PromoteOptions = { from: string; to: string; out: string; names?: string[]; yank?: string[] };

/**
 * `to` with the newest good build of each extension in `from` (or of the
 * named ones) added under the same retention rule: edge promoted to
 * stable. Nothing is copied: the packages are where both indexes point.
 * A missing `to` starts empty, named as `from`.
 */
export async function promote(o: PromoteOptions): Promise<Index> {
  if (!(await exists(o.from))) throw new Error(`${o.from}: no such index`);
  const from = await readIndex(o.from, "");
  const to = await readIndex(o.to, from.name);
  const unknown = (o.names ?? []).filter((n) => !from.extensions.some((e) => e.name === n));
  if (unknown.length) throw new Error(`not in ${o.from}: ${unknown.join(", ")}`);
  for (const e of from.extensions) {
    if (o.names && !o.names.includes(e.name)) continue;
    const newest = [...e.builds].sort(byBuild).find((b) => !b.yanked);
    if (newest) addBuild(to, e.name, e.listing, normBuild(newest));
  }
  for (const s of o.yank ?? []) yank(to, s);
  const done = finish(to);
  await mkdir(dirname(resolve(o.out)), { recursive: true });
  await writeFile(o.out, json(done));
  return done;
}
