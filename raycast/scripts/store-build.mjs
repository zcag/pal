#!/usr/bin/env node
/**
 * Assemble the Raycast Store copy of the extension in dist-store/.
 *
 * The checked-in extension is baked against whoever's config was last synced -
 * one command per local palette, plus a command that rewrites package.json.
 * Neither can ship: a store install is a read-only bundle, and nobody else has
 * these palettes. So the store copy keeps only what is true on any machine -
 * the dynamic palette browser and the item-script sync, which writes to
 * ~/.config/raycast/generated/pal rather than into the bundle.
 *
 *   node scripts/store-build.mjs        # then: cd ../dist-store && npx ray lint
 *
 * Both copies are named "pal", so `ray build`/`ray develop` in dist-store
 * installs over the local extension and takes its palette commands with it -
 * Raycast then errors "Missing executable" on any of them that root search
 * still remembers. Rebuild raycast/ afterwards to put them back.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Outside the extension dir: cpSync refuses to copy a tree into itself.
const out = join(root, "..", "dist-store");

const PREFIX = "palette-";
const LOCAL_ONLY = new Set(["sync-palette-commands"]);
// Only the command that rewrites package.json needs to know where the source is.
const LOCAL_ONLY_PREFS = new Set(["extensionPath"]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const skip = new Set(["node_modules", ".git"]);
cpSync(root, out, {
  recursive: true,
  filter: (src) => {
    const name = src.slice(root.length + 1);
    if (!name) return true;
    const [top] = name.split("/");
    if (skip.has(top)) return false;
    const file = name.split("/").pop();
    if (file.startsWith(PREFIX) && file.endsWith(".tsx")) return false;
    return !LOCAL_ONLY.has(file.replace(/\.tsx$/, ""));
  },
});

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dropped = pkg.commands.filter((c) => c.name.startsWith(PREFIX) || LOCAL_ONLY.has(c.name));
pkg.commands = pkg.commands.filter((c) => !dropped.includes(c));
pkg.preferences = (pkg.preferences ?? []).filter((p) => !LOCAL_ONLY_PREFS.has(p.name));
delete pkg.scripts.sync;
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

// ray needs the toolchain; share the one that's already installed.
if (!existsSync(join(out, "node_modules"))) {
  symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
}

console.log(
  `dist-store: ${pkg.commands.length} commands (${dropped.length} local-only dropped: ` +
    `${dropped.map((c) => c.name).join(", ")})`,
);
console.log(
  "note: building dist-store into Raycast replaces the local install - " +
    "run `npx ray build` here again to get the palette commands back.",
);
