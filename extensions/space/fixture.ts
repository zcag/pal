// Writes app/src/gallery/shots/space.json: the store screenshots' fixture,
// a made-up home folder (never the owner's) as a tree, rendered by
// render.ts into the map, a zoomed map with two boxes marked, and the
// lists. `bun run extensions/space/fixture.ts`, then
// `node app/scripts/shots.mjs space`.
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json";
import type { MapState } from "./render.ts";
import type { Node } from "./scan.ts";

// The sdk reads PAL_NOW once, when it loads: pin it before the extension's modules (and so the sdk) come in, so a row's "Modified 3 d ago" is the strip's.
pinClock();
const { render } = await import("./render.ts");
const { fileRow, folderRow, suggestionRow } = await import("./rows.ts");
const { KINDS, kindOf, largestDirs, largestFiles } = await import("./scan.ts");

const MB = 1024 ** 2, GB = 1024 ** 3;
const DAY = 86400e3;

type Spec = { name: string; size?: number; kids?: Spec[]; age?: number };
const d = (name: string, kids: Spec[], age = 3): Spec => ({ name, kids, age });
const f = (name: string, size: number, age = 20): Spec => ({ name, size, age });

/** Nodes with `up` links and the totals summed bottom-up. */
function build(spec: Spec, up?: Node): Node {
  const dir = !!spec.kids;
  const n: Node = { name: spec.name, dir, alloc: 0, size: 0, files: 0, mtime: NOW - (spec.age ?? 3) * DAY, up };
  if (dir) {
    n.kids = spec.kids!.map((k) => build(k, n));
    n.kinds = new Array(KINDS.length).fill(0);
    for (const k of n.kids) {
      n.alloc += k.alloc; n.size += k.size; n.files += k.files;
      if (k.dir) k.kinds!.forEach((b, i) => (n.kinds![i] += b)); else n.kinds[KINDS.indexOf(kindOf(k))] += k.alloc;
    }
    n.done = NOW - 2 * 3600e3;
  } else {
    n.size = spec.size!;
    n.alloc = Math.ceil(spec.size! / 4096) * 4096;
    n.files = 1;
  }
  return n;
}

const home = build(d("/Users/sam", [
  d("Library", [
    d("Caches", [d("com.apple.Safari", [f("Cache.db", 1.2 * GB)]), d("Homebrew", [f("node-22.pkg", 900 * MB), f("ffmpeg.tar.gz", 300 * MB)]), d("pip", [f("wheels.bin", 400 * MB)]), d("com.google.Chrome", [f("Cache", 2.1 * GB)])]),
    d("Developer", [d("Xcode", [d("DerivedData", [d("Pocket-abc", [f("Pocket.build", 3.4 * GB)]), d("Fieldnotes-def", [f("Fieldnotes.build", 2.2 * GB)])])])]),
    d("Application Support", [d("Slack", [f("Cache.db", 1.1 * GB)]), d("Code", [f("state.vscdb", 240 * MB)]), d("Spotify", [f("PersistentCache", 1.9 * GB)])]),
    d("Mail", [f("Envelope Index", 600 * MB), f("MessageData.db", 2.4 * GB)]),
    d("Containers", [d("com.utmapp.UTM", [f("Ubuntu Server.qcow2", 14 * GB)])]),
  ]),
  d("proj", [
    d("atlas", [d("target", [d("debug", [f("libatlas.a", 909 * MB), f("atlas", 210 * MB), f("deps.rlib", 3.1 * GB)]), d("release", [f("atlas", 48 * MB)])], 40), d("node_modules", [f("esbuild.node", 1.2 * GB)], 35), d(".git", [f("pack-845e.pack", 2.6 * GB)]), d("app", [f("bundle.js", 12 * MB)]), f("README.md", 24 * 1024)]),
    d("storefront", [d("node_modules", [f("next-swc.node", 2.3 * GB)], 50), d(".next", [f("webpack.pack", 1.4 * GB)]), d("src", [f("index.ts", 90 * 1024)])]),
    d("research", [d("data", [f("rides-2026-08.parquet", 6.2 * GB), f("rides-2026-09.parquet", 7.8 * GB)]), d("venv", [f("torch.dylib", 800 * MB)])]),
    d("promo", [f("launch-teaser.mp4", 1.4 * GB), f("render.blend", 820 * MB)]),
    d("old-site", [d("node_modules", [f("sharp.node", 640 * MB)], 400)]),
  ]),
  d("Movies", [f("Istanbul trip.mov", 9.6 * GB), f("Screen Recording 2026-09-12.mov", 2.2 * GB), f("wedding-raw.mkv", 18 * GB)]),
  d("Pictures", [d("Photos Library.photoslibrary", [f("Photos.sqlite", 1.1 * GB), f("originals.heic", 11.4 * GB)]), f("IMG_4021.HEIC", 3.2 * MB), f("scan.png", 12 * MB)]),
  d("Downloads", [f("ubuntu-26.04-desktop-arm64.iso", 4.7 * GB, 45), f("Xcode_17.xip", 3.2 * GB, 60), f("invoice-0911.pdf", 240 * 1024, 5), f("dataset.zip", 1.9 * GB, 12), f("Slack-4.41.dmg", 190 * MB, 90)]),
  d("Music", [d("Logic", [f("Set 1.logicx", 2.1 * GB), f("Set 2.logicx", 1.7 * GB)]), f("mix.flac", 320 * MB)]),
  d("Documents", [f("Thesis.pdf", 48 * MB), f("Notes.md", 120 * 1024), f("Slides.key", 210 * MB)]),
  d(".cache", [d("pip", [f("http.cache", 260 * MB)]), d("bun", [f("registry.tgz", 420 * MB)])]),
  d(".Trash", [f("old-backup.zip", 3.1 * GB), f("draft.mov", 1.2 * GB)]),
  d("Desktop", [f("Screenshot 2026-09-15.png", 4.1 * MB), f("todo.txt", 2 * 1024)]),
  f(".zshrc", 6 * 1024),
]));

const state = (dir: Node, extra: Partial<MapState> = {}): MapState => ({ root: home, dir, focus: 0, marked: new Set(), sizes: "allocated", colour: "kind", scannedAt: NOW - 2 * 3600e3, denied: 3, mac: true, now: NOW, ...extra });
const proj = home.kids!.find((k) => k.name === "proj")!;
const atlas = proj.kids!.find((k) => k.name === "atlas")!;
const pathOf = (n: Node): string => (n.up ? `${pathOf(n.up)}/${n.name}` : n.name);
const marked = new Set([pathOf(atlas.kids!.find((k) => k.name === "target")!), pathOf(atlas.kids!.find((k) => k.name === "node_modules")!)]);

const root = home.name;
const map = render(state(home));
const suggestions = [
  { id: "caches", name: "User caches", path: `${root}/Library/Caches`, note: "Apps rebuild what they need; a few may sign you out", size: 4.9 * GB, files: 5, action: "trash-contents" as const, section: "Caches" },
  { id: "derived", name: "Xcode DerivedData", path: `${root}/Library/Developer/Xcode/DerivedData`, note: "Build products; Xcode rebuilds them", size: 5.6 * GB, files: 2, action: "trash-contents" as const, section: "Caches" },
  { id: "xdg-cache", name: "Cache folder (~/.cache)", path: `${root}/.cache`, note: "Tools rebuild what they need", size: 680 * MB, files: 2, action: "trash-contents" as const, section: "Caches" },
  { id: "bun", name: "Bun install cache", path: `${root}/.bun/install/cache`, note: "Refilled on install", size: 1.3 * GB, files: 812, action: "trash-contents" as const, section: "Package caches" },
  { id: "cargo", name: "Cargo registry", path: `${root}/.cargo/registry`, note: "Crate sources and indexes; refetched on build", size: 2.4 * GB, files: 41_203, action: "trash-contents" as const, section: "Package caches" },
  { id: "trash", name: "Trash", path: `${root}/.Trash`, note: "Emptying it is final", size: 4.3 * GB, files: 2, action: "empty-trash" as const, section: "Trash and downloads" },
  { id: "downloads", name: "Downloads older than 30 days", path: `${root}/Downloads`, note: "By modification date", size: 8.1 * GB, files: 3, action: "trash-old" as const, section: "Trash and downloads" },
  { id: "stale:old-site", name: "~/proj/old-site/node_modules", path: `${root}/proj/old-site/node_modules`, note: "Untouched 1 y ago; the next install or build recreates it", size: 640 * MB, files: 1, action: "trash" as const, section: "Stale build folders" },
  { id: "stale:storefront", name: "~/proj/storefront/node_modules", path: `${root}/proj/storefront/node_modules`, note: "Untouched 2 mo ago; the next install or build recreates it", size: 2.3 * GB, files: 1, action: "trash" as const, section: "Stale build folders" },
  { id: "stale:atlas", name: "~/proj/atlas/target", path: `${root}/proj/atlas/target`, note: "Untouched 1 mo ago; the next install or build recreates it", size: 4.3 * GB, files: 4, action: "trash" as const, section: "Stale build folders" },
];

const fixture = {
  palettes: {
    map: { title: "Disk Map", icon: manifest.icon, view: "view", tree: map },
    largest: { title: "Largest Files", icon: manifest.icon, live: true, placeholder: "Search files", filters: [{ id: "all", title: "All kinds" }, { id: "video", title: "Videos" }, { id: "disk", title: "Disk images" }], items: largestFiles(home, 40).map((n) => fileRow(n, root, "allocated", true)) },
    folders: { title: "Largest Folders", icon: manifest.icon, live: true, placeholder: "Search folders", items: largestDirs(home, 40).map((n) => folderRow(n, home, "allocated", true)) },
    // The zoomed shot opens on its own tree (atlas, two boxes marked) rather than keys through effects: a view pick in the gallery lost to a reload now and then.
    zoomed: { title: "Disk Map", icon: manifest.icon, view: "view", tree: render(state(atlas, { marked, focus: 2 })) },
    cleanup: { title: "Cleanup Suggestions", icon: manifest.icon, live: true, placeholder: "Search suggestions", items: suggestions.map((g) => suggestionRow(g, 30, true)) },
  },
  shots: {
    "1-map": { palette: "map", keys: ["wait:500"], caption: "A home folder as a map: every folder a box sized by what it holds and coloured by kind, the list of the biggest beside it" },
    "2-zoomed": { palette: "zoomed", keys: ["wait:600"], caption: "Zoomed into a project, its build output and node_modules marked: one keystroke sends both to the Trash" },
    "3-largest": { palette: "largest", keys: ["wait:300", "down*2"], caption: "The largest files anywhere under the root, each with its folder, kind and size; filter to videos or disk images" },
    "4-cleanup": { palette: "cleanup", keys: ["wait:300", "down*4"], caption: "Cleanup suggestions: caches, package stores, the Trash, old downloads and stale build folders, each with what it frees and what to know" },
    "5-detail": { palette: "largest", keys: ["wait:300", "cmd+i", "wait:400"], caption: "A file's detail (cmd+I): its folder and kind, the size on disk and the apparent size large, when it changed" },
  },
};
writeFixture("space", fixture);
console.log(`home ${(home.alloc / GB).toFixed(1)} GB in ${home.files} files; map ${JSON.stringify(map).length} bytes`);
