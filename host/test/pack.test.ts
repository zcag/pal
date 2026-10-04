// pal-pack (sdk/pack, sdk/bin/pal-pack.ts; docs/registry.md): the tree hash
// against the shared conformance fixture, reproducible packages and
// tarballs, the listing, statements, the index with its merge and retention
// rules, promotion, the bundled list, and a packaged extension (SDK
// external) loading in the host the way the app's bundled root has it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { addBuild, build, finish, listingOf, promote, readIndex, retain, statement, writeIndex, writeStatements, type Entry, type Index, type IndexBuild } from "../../sdk/pack/pack.ts";
import { tar } from "../../sdk/pack/tar.ts";
import { treeHash } from "../../sdk/pack/treehash.ts";
import { PROTOCOL, type Manifest } from "../../sdk/src/protocol.ts";
import { extensionRepos } from "../../app/scripts/extension-repos.mjs";
import { Host, extDir, extensionsByName, manifest } from "./harness.ts";

const REPO = resolve(import.meta.dir, "../..");
const FIXTURE = join(REPO, "core/tests/fixtures/tree-hash");
const PACK = join(REPO, "sdk/bin/pal-pack.ts");
const tmp = () => mkdtempSync(join(tmpdir(), "pal-pack-"));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** A throwaway extension outside git (so `--seq` is given): a surface with the sibling it imports, a fixture that is not copied. */
function source(dir: string, name: string, extra: Record<string, unknown> = {}, list = `[{ id: "a", name: "A" }]`) {
  const d = join(dir, name);
  mkdirSync(join(d, "surface"), { recursive: true });
  const store = { tagline: "t", features: ["Does one thing", "Does another"], category: "fun", platforms: ["macos"], play: true, screenshots: [{ file: "1-list.png", caption: "The list", kind: "panel" }] };
  writeFileSync(join(d, "pal.json"), manifest(name, { title: "Thing", store, palettes: { [name]: { kind: "view" }, other: { title: "Other", kind: "list" } }, ...extra } as Partial<Manifest>));
  writeFileSync(join(d, "index.ts"), `import { settings } from "@zcag/pal";\nimport { rows } from "./game.ts";\nconst s = settings.get();\nexport default { palettes: { ${name}: { title: "Thing", list: () => rows(String(s.greeting ?? "none")), pick: () => {} }, other: { title: "Other", list: () => ${list}, pick: () => {} } } };\n`);
  writeFileSync(join(d, "game.ts"), `export const rows = (g: string) => [{ id: "g", name: g }];\n`);
  writeFileSync(join(d, "fixture.ts"), `// screenshots only\n`);
  writeFileSync(join(d, "surface", "index.html"), `<script type="module" src="./page.ts"></script>\n`);
  writeFileSync(join(d, "surface", "page.ts"), `import { rows } from "../game.ts";\nrows("x");\n`);
  writeFileSync(join(d, "surface", ".DS_Store"), "junk");
  return d;
}

describe("tree hash", () => {
  test("the conformance fixture hashes to expected.txt", async () => {
    expect(await treeHash(join(FIXTURE, "tree"))).toBe(readFileSync(join(FIXTURE, "expected.txt"), "utf8").trim());
  });
});

describe("build", () => {
  let dir: string;
  beforeAll(() => { dir = tmp(); source(dir, "thing"); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the package: index.js with @zcag/pal external, pal.json stamped, the surface and its sibling sources; the entry and the tarball", async () => {
    const out = join(dir, "dist");
    const e = await build(join(dir, "thing"), { out, cwd: dir, seq: 1790000000, commit: "abc", screenshotsBase: "https://pal.cagdas.io/extensions/" });
    expect(readdirSync(join(out, "thing")).sort()).toEqual(["game.ts", "index.js", "pal.json", "surface"]);
    expect(readdirSync(join(out, "thing", "surface")).sort()).toEqual(["index.html", "page.ts"]);
    const js = readFileSync(join(out, "thing", "index.js"), "utf8");
    expect(js).toContain(`from "@zcag/pal"`);
    expect(js).toContain("// thing/index.ts");
    const stamped = readFileSync(join(out, "thing", "pal.json"), "utf8");
    expect(JSON.parse(stamped).protocol).toBe(PROTOCOL);
    expect(stamped).toBe(JSON.stringify({ ...json(join(dir, "thing", "pal.json")), protocol: PROTOCOL }, null, 2) + "\n");
    expect(e.build).toEqual({ hash: await treeHash(join(out, "thing")), seq: 1790000000, protocol: PROTOCOL, commit: "abc", size: statSync(join(out, "thing.tar.gz")).size });
    expect(json(join(out, "thing.entry.json"))).toEqual(e);
    expect(e.listing).toEqual({
      title: "Thing", tagline: "t", features: ["Does one thing", "Does another"], category: "fun", keywords: [], platforms: ["macos"], play: true,
      palettes: [{ id: "thing", title: "Thing", kind: "view" }, { id: "other", title: "Other", kind: "list" }],
      screenshots: [{ url: "https://pal.cagdas.io/extensions/thing/screenshots/1-list.png", caption: "The list" }],
      requires: [], suggests: [], controls: [],
    });
  });

  test("a page's imports in folders of their own are followed to any depth; one that leaves the extension fails the build", async () => {
    const d = source(dir, "deep");
    mkdirSync(join(d, "game", "sim"), { recursive: true });
    mkdirSync(join(d, "game", "content"), { recursive: true });
    writeFileSync(join(d, "surface", "page.ts"), `import { run } from "../game/sim/core.ts";\nrun();\n`);
    writeFileSync(join(d, "game", "sim", "core.ts"), `import { DATA } from "../content/data.ts";\nimport type { T } from "./types.ts";\nexport const run = (): T => DATA;\n`);
    writeFileSync(join(d, "game", "sim", "types.ts"), `export type T = number;\n`);
    writeFileSync(join(d, "game", "content", "data.ts"), `export const DATA = 1;\n`);
    writeFileSync(join(d, "game", "unused.ts"), `export const NOBODY = 0;\n`);
    const out = join(dir, "dist-deep");
    await build(d, { out, cwd: dir, seq: 1790000000, commit: "abc", dirOnly: true });
    expect(readdirSync(join(out, "deep", "game")).sort()).toEqual(["content", "sim"]);
    expect(readdirSync(join(out, "deep", "game", "sim")).sort()).toEqual(["core.ts", "types.ts"]);
    expect(readdirSync(join(out, "deep", "game", "content"))).toEqual(["data.ts"]);
    writeFileSync(join(d, "game", "content", "data.ts"), `export { DATA } from "../../../outside.ts";\n`);
    await expect(build(d, { out, cwd: dir, seq: 1790000000, commit: "abc", dirOnly: true })).rejects.toThrow("outside the extension");
  });

  test("a manifest whose sync rules or leaderboards are wrong is refused, naming each mistake", async () => {
    const dir = tmp();
    const opts = { out: join(dir, "dist"), cwd: dir, seq: 1790000000, commit: "abc", dirOnly: true };
    const d = source(dir, "boards", { sync: { best: "max", hand: "local", plays: "add" }, leaderboards: [{ id: "daily", title: "Daily", order: "desc", format: "points" }, { id: "Stage", title: "Stage {1}", order: "up", format: "points" }] });
    const err = await build(d, opts).then(() => "", (e: Error) => e.message);
    expect(err).toContain(`sync.plays: "add" is not a rule`);
    expect(err).toContain("leaderboards.Stage: an id is lowercase letters");
    expect(err).toContain(`leaderboards.Stage: the title's {1} names no "*" segment`);
    expect(err).toContain(`leaderboards.Stage: order is "asc"`);
    const good = source(dir, "fine", { sync: { best: "max" }, leaderboards: [{ id: "stage/*", title: "Stage {1}", order: "desc", format: "time", min: 0, max: 3600 }] });
    await build(good, opts);
    expect(json(join(dir, "dist", "fine", "pal.json"))).toMatchObject({ protocol: PROTOCOL, leaderboards: [{ id: "stage/*" }] });
    rmSync(dir, { recursive: true, force: true });
  });

  test("reproducible: the same source twice is the same hash and the same tarball bytes; the header and entries are normalised", async () => {
    const [a, b] = [join(dir, "a"), join(dir, "b")];
    await build(join(dir, "thing"), { out: a, cwd: dir, seq: 5, commit: "" });
    await build(join(dir, "thing"), { out: b, cwd: dir, seq: 5, commit: "" });
    const [ta, tb] = [readFileSync(join(a, "thing.tar.gz")), readFileSync(join(b, "thing.tar.gz"))];
    expect(Buffer.compare(ta, tb)).toBe(0);
    expect(json(join(a, "thing.entry.json")).build.hash).toBe(json(join(b, "thing.entry.json")).build.hash);
    // gzip: no name flag, mtime 0, OS 255.
    expect([...ta.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, ta[8], 255]);
    const raw = gunzipSync(ta);
    expect(Buffer.compare(raw, Buffer.from(await tar(join(a, "thing"), "thing")))).toBe(0);
    const names: string[] = [];
    for (let at = 0; raw[at]; ) {
      const field = (o: number, n: number) => raw.subarray(at + o, at + o + n).toString().replace(/\0.*$/s, "");
      const size = parseInt(field(124, 12), 8);
      names.push(field(0, 100));
      expect([field(108, 8), field(116, 8), field(136, 12), field(265, 32), field(297, 32), field(257, 6)]).toEqual(["0000000", "0000000", "00000000000", "", "", "ustar"]);
      at += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names).toEqual(["thing/", "thing/game.ts", "thing/index.js", "thing/pal.json", "thing/surface/", "thing/surface/index.html", "thing/surface/page.ts"]);
  });

  test("the CLI: the same hash whatever directory it runs from; --dir-only writes .pal-build.json and no tarball; a failing build fails", async () => {
    const run = (cwd: string, ...args: string[]) => Bun.spawnSync(["bun", PACK, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [x, y] = [join(dir, "x"), join(dir, "y")];
    expect(run(dir, "build", "thing", "--out", x, "--cwd", dir, "--seq", "7").exitCode).toBe(0);
    expect(run(tmpdir(), "build", join(dir, "thing"), "--out", y, "--cwd", dir, "--seq", "7").exitCode).toBe(0);
    expect(json(join(x, "thing.entry.json")).build.hash).toBe(json(join(y, "thing.entry.json")).build.hash);
    const d = join(dir, "d");
    const r = run(dir, "build", "thing", "--dir-only", "--out", d, "--cwd", dir, "--seq", "7", "--commit", "c0");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe(`thing\t${json(join(x, "thing.entry.json")).build.hash}\t7\t${PROTOCOL}\n`);
    expect(json(join(d, "thing", ".pal-build.json"))).toEqual({ hash: json(join(x, "thing.entry.json")).build.hash, seq: 7, protocol: PROTOCOL, commit: "c0" });
    expect(existsSync(join(d, "thing.tar.gz")) || existsSync(join(d, "thing.entry.json"))).toBe(false);
    // tree-hash: what build-extensions.sh checks an unpacked registry package with.
    expect(run(dir, "tree-hash", join(d, "thing")).stdout.toString()).toBe(`${json(join(x, "thing.entry.json")).build.hash}\n`);
    source(dir, "broken");
    writeFileSync(join(dir, "broken", "index.ts"), "export default {{{");
    const bad = run(dir, "build", "broken", "--out", join(dir, "bad"), "--cwd", dir, "--seq", "7");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("broken: bun build failed");
    writeFileSync(join(dir, "broken", "pal.json"), manifest("other"));
    expect(run(dir, "build", "broken", "--out", join(dir, "bad"), "--cwd", dir, "--seq", "7").stderr.toString()).toContain(`broken: pal.json names it "other"`);
  });

  // Weather where the extension repos have it (pal-extensions, not pal-games): the path in bun's comments is the one from its repo's root.
  test.skipIf(!extensionsByName().has("weather"))("a repo extension: seq and commit from git; the listing's palette titles from the manifest, the extension's for one named after it", async () => {
    const out = join(dir, "repo");
    const src = extDir("weather");
    const e = await build(src, { out, dirOnly: true });
    const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: src }).stdout.toString().trim();
    expect(e.build.seq).toBe(Number(git("log", "-1", "--format=%ct")));
    expect(e.build.commit).toBe(git("rev-parse", "HEAD"));
    expect(readFileSync(join(out, "weather", "index.js"), "utf8")).toContain(`// ${relative(git("rev-parse", "--show-toplevel"), src)}/index.ts`);
    expect(e.listing.palettes).toEqual([{ id: "weather", title: "Weather", kind: "live" }]);
    expect(e.listing.screenshots).toEqual([]);
  });
});

describe("listing", () => {
  test("absent fields are left out or empty; a palette without a title is its key", () => {
    expect(listingOf({ name: "n", palettes: { list: {}, n: {} } })).toEqual({ title: "n", features: [], keywords: [], platforms: [], play: false, palettes: [{ id: "list", title: "list", kind: "list" }, { id: "n", title: "n", kind: "list" }], screenshots: [], requires: [], suggests: [], controls: [] });
  });
});

const b = (hash: string, seq: number, protocol = 1, yanked = false): IndexBuild => ({ hash, seq, protocol, commit: "", url: `u/${hash}`, manifest: `m/${hash}`, size: 1, sig: "s", yanked });

describe("index", () => {
  test("retention: the newest good build per protocol and the good one before the newest; a yanked one while newer than the oldest kept", () => {
    const hashes = (x: IndexBuild[]) => x.map((y) => y.hash);
    expect(hashes(retain([b("a", 1), b("b", 2), b("c", 3)]))).toEqual(["c", "b"]);
    expect(hashes(retain([b("a", 1, 1), b("b", 2, 1), b("c", 3, 2), b("d", 4, 2)]))).toEqual(["d", "c", "b"]);
    expect(hashes(retain([b("a", 1), b("b", 2), b("y", 3, 1, true), b("c", 4)]))).toEqual(["c", "y", "b"]);
    expect(hashes(retain([b("old", 0, 1, true), b("a", 1), b("b", 2), b("c", 3)]))).toEqual(["c", "b"]);
    expect(hashes(retain([b("y", 1, 1, true)]))).toEqual(["y"]);
  });

  test("addBuild: a listed hash is not added twice; the listing follows the newest build", () => {
    const i: Index = { format: 1, name: "r", generated_at: "", next_key: null, extensions: [] };
    const l = (title: string) => listingOf({ name: "e", title });
    addBuild(i, "e", l("two"), b("h2", 2));
    addBuild(i, "e", l("one"), b("h1", 1));
    addBuild(i, "e", l("again"), b("h2", 9));
    expect(i.extensions[0].listing.title).toBe("two");
    expect(i.extensions[0].builds.map((x) => [x.hash, x.seq])).toEqual([["h2", 2], ["h1", 1]]);
    expect(finish(i, new Date("2026-09-30T12:00:00.123Z")).generated_at).toBe("2026-09-30T12:00:00Z");
  });

  test("statements, then the index: packages copied by hash, merged over the live index, yank, keep, key, next_key; an unsigned entry is refused", async () => {
    const dir = tmp();
    try {
      source(dir, "thing");
      source(dir, "other");
      const dist = join(dir, "dist");
      await build(join(dir, "thing"), { out: dist, cwd: dir, seq: 100, commit: "c1" });
      await build(join(dir, "other"), { out: dist, cwd: dir, seq: 100, commit: "c1" });
      const files = await writeStatements(dist);
      expect(files.map((f) => f.slice(dist.length + 1))).toEqual(["other.statement", "thing.statement"]);
      const thing = json(join(dist, "thing.entry.json")) as Entry;
      expect(readFileSync(join(dist, "thing.statement"), "utf8")).toBe(`pal-build-v1\nthing\n${thing.build.hash}\n100\n${PROTOCOL}\n`);
      expect(statement("thing", thing.build)).toBe(readFileSync(join(dist, "thing.statement"), "utf8"));
      writeFileSync(join(dist, "thing.statement.minisig"), "untrusted comment: t\nSIG\n");
      const out = join(dir, "site");
      await expect(writeIndex(dist, { name: "acme", base: "https://x.test/pal/", out })).rejects.toThrow("no signature for other");
      writeFileSync(join(dist, "other.statement.minisig"), "untrusted comment: o\nSIG\n");

      // The live index: an older thing build, a yanked one, an extension gone from the source, its key, a key being moved to.
      const live = join(dir, "live.json");
      writeFileSync(live, JSON.stringify({ format: 1, name: "acme", generated_at: "2026-01-01T00:00:00Z", key: "RWQold", next_key: "RWQnext", extensions: [
        { name: "thing", listing: listingOf({ name: "thing", title: "Old" }), builds: [b("old", 50), b("older", 40)] },
        { name: "gone", listing: listingOf({ name: "gone" }), builds: [b("g", 10)] },
      ] }));
      const i = await writeIndex(dist, { name: "acme", base: "https://x.test/pal/", out, merge: live, key: "RWQcur" });
      expect(readFileSync(join(out, "pkg", "thing", `${thing.build.hash}.tar.gz`)).equals(readFileSync(join(dist, "thing.tar.gz")))).toBe(true);
      expect(readFileSync(join(out, "pkg", "thing", `${thing.build.hash}.json`), "utf8")).toBe(readFileSync(join(dist, "thing", "pal.json"), "utf8"));
      expect(i.extensions.map((e) => e.name)).toEqual(["gone", "other", "thing"]);
      const t = i.extensions.find((e) => e.name === "thing")!;
      expect(t.listing.title).toBe("Thing");
      expect(t.builds.map((x) => x.hash)).toEqual([thing.build.hash, "old"]);
      expect(t.builds[0]).toEqual({ hash: thing.build.hash, seq: 100, protocol: PROTOCOL, commit: "c1", url: `https://x.test/pal/pkg/thing/${thing.build.hash}.tar.gz`, manifest: `https://x.test/pal/pkg/thing/${thing.build.hash}.json`, size: thing.build.size, sig: "untrusted comment: t\nSIG\n", yanked: false });
      expect([i.key, i.next_key]).toEqual(["RWQcur", "RWQnext"]);
      expect(Object.keys(json(join(out, "index.json")))).toEqual(["format", "name", "generated_at", "key", "next_key", "extensions"]);
      expect(readFileSync(join(out, "index.json"), "utf8")).toBe(JSON.stringify(i, null, 2) + "\n");

      // Again over the result: nothing duplicated; --keep drops what the source no longer has; --yank; the key stays; --next-key "" clears it.
      const again = await writeIndex(dist, { name: "acme", base: "https://x.test/pal", out: join(dir, "site2"), merge: join(out, "index.json"), keep: ["thing"], yank: ["thing@old"], nextKey: "" });
      expect(again.extensions.map((e) => e.name)).toEqual(["other", "thing"]);
      expect(again.extensions.find((e) => e.name === "thing")!.builds.map((x) => [x.hash, x.yanked])).toEqual([[thing.build.hash, false], ["old", true]]);
      expect([again.key, again.next_key]).toEqual(["RWQcur", null]);
      // --key "" drops the field, not writes it as null: it is optional.
      const bare = await writeIndex(dist, { name: "acme", base: "b", out: join(dir, "site4"), merge: join(out, "index.json"), key: "" });
      expect("key" in json(join(dir, "site4", "index.json"))).toBe(false);
      expect(bare.key).toBeUndefined();
      await expect(writeIndex(dist, { name: "acme", base: "b", out: join(dir, "site3"), yank: ["thing@nope"] })).rejects.toThrow("--yank thing@nope: no such build");
      writeFileSync(join(dir, "v2.json"), JSON.stringify({ format: 2, extensions: [] }));
      await expect(readIndex(join(dir, "v2.json"), "x")).rejects.toThrow("index format 2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("promote: the newest good build of each (or each named) extension into the other index, retention kept; a missing target starts empty", async () => {
    const dir = tmp();
    try {
      const edge = join(dir, "edge.json");
      const l = (name: string) => listingOf({ name, title: `${name} edge` });
      writeFileSync(edge, JSON.stringify({ format: 1, name: "pal", generated_at: "2026-09-30T00:00:00Z", next_key: null, extensions: [
        { name: "a", listing: l("a"), builds: [b("a3", 3, 1, true), b("a2", 2), b("a1", 1)] },
        { name: "b", listing: l("b"), builds: [b("b2", 2)] },
      ] }));
      const first = await promote({ from: edge, to: join(dir, "none.json"), out: join(dir, "stable.json"), names: ["a"] });
      expect(first.name).toBe("pal");
      expect(first.extensions.map((e) => [e.name, e.builds.map((x) => x.hash)])).toEqual([["a", ["a2"]]]);
      writeFileSync(join(dir, "stable.json"), JSON.stringify({ ...first, next_key: "RWQk" }));
      const all = await promote({ from: edge, to: join(dir, "stable.json"), out: join(dir, "stable2.json") });
      expect(all.extensions.map((e) => [e.name, e.builds.map((x) => x.hash)])).toEqual([["a", ["a2"]], ["b", ["b2"]]]);
      expect(all.extensions[1].listing.title).toBe("b edge");
      expect(all.next_key).toBe("RWQk");
      expect(json(join(dir, "stable2.json"))).toEqual(all);
      await expect(promote({ from: edge, to: join(dir, "stable.json"), out: join(dir, "x.json"), names: ["zz"] })).rejects.toThrow("not in");
      await expect(promote({ from: join(dir, "nope.json"), to: edge, out: join(dir, "x.json") })).rejects.toThrow("no such index");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// app/bundled.txt (the names the app ships) and each extension repo's registry-only.txt (the rest of its names).
describe("the bundled list", () => {
  const list = (file: string) => readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const bundled = list(join(REPO, "app/bundled.txt"));
  const dirs = extensionsByName();
  const sorted = (names: string[], file: string) => {
    expect(names.length, file).toBeGreaterThan(0);
    expect(names, file).toEqual([...new Set(names)].sort());
  };
  // Every bundled name is pal-extensions'; a run that reads only pal-games has none of them, and checks only its own list.
  test("bundled.txt is sorted, has no duplicates, and every name is an extension (when the repos read have them)", () => {
    sorted(bundled, "app/bundled.txt");
    if (bundled.some((n) => dirs.has(n))) for (const n of bundled) expect(existsSync(join(dirs.get(n) ?? "-", "index.ts")), `app/bundled.txt: ${n}`).toBe(true);
  });
  for (const repo of extensionRepos()) {
    const file = join(repo.dir, "registry-only.txt");
    test(`${repo.dir}: registry-only.txt is sorted, has no duplicates, and every name is an extension there`, () => {
      expect(existsSync(file), `${repo.dir} has no registry-only.txt`).toBe(true);
      const names = list(file);
      sorted(names, file);
      for (const n of names) expect(existsSync(join(repo.dir, n, "index.ts")), `${file}: ${n}`).toBe(true);
    });
    test(`${repo.dir}: every extension is decided, in exactly one of pal's app/bundled.txt and registry-only.txt`, () => {
      const registry = new Set(existsSync(file) ? list(file) : []), shipped = new Set(bundled);
      const here = readdirSync(repo.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(repo.dir, d.name, "pal.json"))).map((d) => d.name);
      expect(here.filter((d) => !shipped.has(d) && !registry.has(d)), "add each to pal's app/bundled.txt or the repo's registry-only.txt (CLAUDE.md)").toEqual([]);
      expect(here.filter((d) => shipped.has(d) && registry.has(d))).toEqual([]);
    });
  }
});

describe("a packaged extension in the host", () => {
  test("built with the SDK external, it loads from a root holding the SDK as real files, and its top-level settings.get names it", async () => {
    const dir = tmp();
    const root = join(dir, "root");
    let host: Host | undefined;
    try {
      source(dir, "thing", { settings: [{ kind: "text", id: "greeting", label: "G", default: "hey" }] });
      await build(join(dir, "thing"), { out: root, cwd: dir, seq: 1, dirOnly: true });
      const sdk = join(root, "node_modules", "@zcag", "pal");
      mkdirSync(sdk, { recursive: true });
      cpSync(join(REPO, "sdk", "package.json"), join(sdk, "package.json"));
      cpSync(join(REPO, "sdk", "src"), join(sdk, "src"), { recursive: true });
      host = await Host.start({ roots: [root] });
      expect(host.loaded().find((l) => l.extension === "thing")?.root).toBe(root);
      expect(await host.list("thing", "thing")).toEqual([{ id: "g", name: "hey" }]);
      expect(host.stderr).toContain(`${sdk} exists and is not a link; leaving it`);
    } finally {
      host?.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
