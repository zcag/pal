// Writes app/src/gallery/shots/store.json, the store screenshots' fixture:
// the rows as index.ts lists them through the host harness over a store
// state made from the repo's own manifests. The machine it shows has the
// core set (docs/design/distribution.md, "What is bundled") coming with
// pal, Spotify, GitHub and Wordle installed from pal's registry (Spotify
// with an update that waits), and the rest listed, not installed.
// `bun run extensions/store/fixture.ts`, then `make shots EXT=store`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED, Host } from "../../host/test/harness.ts";
import { NOW_S, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { AvailableExtension, StoreState, StoreStatus } from "../../sdk/src/index.ts";
import manifest from "./pal.json" with { type: "json" };

const CORE = new Set("apps files calc clipboard snippets windows window-management system quicklinks emoji store games states scripts bookmarks browser-tabs downloads audio bluetooth displays wifi network media screenshots timer processes power menu-bar shortcuts unicode generate colors shell".split(" "));
const FROM_REGISTRY = ["spotify", "github", "wordle"];
const DAY = 86_400;
/** A build of `name`, `days` before the fixture's clock: its hash made from the name, so the same every run. */
const build = (name: string, days: number) => ({ hash: `${Buffer.from(name).toString("hex")}00000000000000`.slice(0, 16), seq: NOW_S - days * DAY, protocol: 3, commit: name.slice(0, 7) });

pinClock();
const available: AvailableExtension[] = readdirSync(BUNDLED).filter((n) => existsSync(join(BUNDLED, n, "pal.json"))).map((name) => {
  const m = JSON.parse(readFileSync(join(BUNDLED, name, "pal.json"), "utf8"));
  const s = m.store ?? {};
  return {
    name, registry: "pal", installed: CORE.has(name) || FROM_REGISTRY.includes(name), bundled: CORE.has(name), installable: true, build: build(name, 3),
    listing: {
      title: m.title ?? name, description: m.description ?? "", tagline: s.tagline ?? "", features: s.features ?? [], category: s.category ?? "", keywords: m.keywords ?? [], icon: m.icon ?? null, author: m.author ?? "",
      platforms: s.platforms ?? null, play: !!s.play, palettes: Object.entries(m.palettes ?? {}).map(([id, p]: [string, any]) => ({ id, title: p.title ?? m.title ?? id, kind: p.kind ?? "list" })),
      screenshots: (s.screenshots ?? []).filter((x: { kind?: string }) => x.kind !== "bar").map((x: { file: string; caption?: string }) => ({ url: `https://pal.cagdas.io/extensions/${name}/screenshots/${x.file}`, caption: x.caption })),
      requires: m.requires ?? [], suggests: m.suggests ?? [],
    },
  };
});
const statuses: StoreStatus[] = available.filter((a) => a.installed).map((a) => {
  const base = { name: a.name, origin: a.bundled ? "bundled" as const : "store" as const, registry: "pal", installed: build(a.name, 20), auto_update: false };
  return a.name === "spotify" ? { ...base, state: "update", to: { ...build(a.name, 3), url: "", manifest: "", sig: "" } } : { ...base, state: "up_to_date" };
});
const state: StoreState = {
  auto_update: false, usage: true,
  registries: [{ name: "pal", url: "https://pal.cagdas.io/registry/index.json", channel: "stable", auto_update: false, key: "", count: available.length, last_checked: NOW_S - 120, last_ok: NOW_S - 120, ours: true }],
  statuses, available, pending: [], rolled_back: [], unlisted: [], disabled: [], leftovers: [], busy: [],
};

const host = await Host.bundled({ core: { "store.state": () => state, "store.refresh": () => state } });
try {
  const byQuery: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  for (const q of ["", "git", "tim"]) {
    const items = await host.list("store", "store", q);
    byQuery[q] = items;
    for (const i of items.slice(0, 8)) details[i.id] ??= await host.detail("store", "store", i.id);
  }
  const meta = host.loaded().find((l) => l.extension === "store")!.palettes[0];
  writeFixture("store", {
    palettes: { store: { title: manifest.title, icon: manifest.icon, input: true, placeholder: meta.placeholder, filters: meta.filters, byQuery, details } },
    shots: {
      "1-browse": { palette: "store", keys: ["down*2"], caption: "The store as it opens: an update that waits, three featured, then a section per category with how each stands" },
      "2-detail": { palette: "store", keys: ["type:git", "cmd+i"], caption: "cmd+I opens the detail pane: what the extension is and does, its palettes and pictures, where it comes from" },
      "3-actions": { palette: "store", keys: ["down*3", "cmd+k"], caption: "Install on Enter; the store page and the install command a keystroke away" },
    },
  });
  console.log(`wrote app/src/gallery/shots/store.json: ${available.length} listed`);
} finally {
  host.kill();
}
