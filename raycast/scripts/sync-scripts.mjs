#!/usr/bin/env node
/**
 * Materialise palette *items* as Raycast script commands.
 *
 * The extension puts items inside a command; Raycast's root search only
 * indexes commands, so an item like a bookmark is never reachable by typing
 * its name into Raycast itself. Script commands are - each one is a root
 * search entry. Every generated script runs the real `pal pick`, so behaviour
 * matches the terminal exactly.
 *
 * Only makes sense for palettes whose items are stable (bookmarks, commands,
 * power). Anything live - otp, tabs, ha-states - belongs in the extension,
 * where it's listed fresh on every open.
 *
 *   node scripts/sync-scripts.mjs bookmarks cmds power
 *   node scripts/sync-scripts.mjs --list        # what's currently generated
 *
 * One-time setup: add the printed directory in
 * Raycast Settings -> Extensions -> Script Commands -> Add Directory.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OUT = join(homedir(), ".config", "raycast", "generated", "pal");

const shellPath = execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", 'printf %s "$PATH"'], {
  encoding: "utf8",
  env: { ...process.env, TERM: "dumb" },
}).trim();
const env = { ...process.env, PATH: shellPath };
const pal = (args) => execFileSync("pal", args, { encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024 });

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const files = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".sh")) : [];
  console.log(`${files.length} script commands in ${OUT}`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

const palettes = args.filter((a) => !a.startsWith("--"));
if (!palettes.length) {
  console.error("usage: sync-scripts.mjs <palette>... (e.g. bookmarks cmds power)");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
// Regenerate wholesale so removed items don't linger as dead entries.
for (const file of readdirSync(OUT)) {
  if (file.endsWith(".sh")) rmSync(join(OUT, file));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
// Raycast script command icons take an emoji, not an icon name.
const isEmoji = (s) =>
  s && !/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFD}]/u.test(s) && /\p{Extended_Pictographic}/u.test(s);

let count = 0;
for (const palette of palettes) {
  const meta = JSON.parse(pal(["meta", palette]));
  const items = pal(["list", palette])
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));

  const paletteIcon = [meta.icon, meta.icon_utf].find(isEmoji);

  for (const item of items) {
    const name = `${slug(palette)}-${slug(item.id ?? item.name)}`;
    const icon = [item.icon, item.icon_utf].find(isEmoji) ?? paletteIcon ?? "⚡";

    // `pal pick` wants the item on stdin; embed it rather than re-listing, so
    // the script stays a single fast exec.
    const json = JSON.stringify(item);
    const lines = [
      "#!/bin/bash",
      "",
      "# @raycast.schemaVersion 1",
      `# @raycast.title ${item.name.replace(/\n/g, " ")}`,
      "# @raycast.mode silent",
      `# @raycast.icon ${icon}`,
      `# @raycast.packageName ${palette}`,
      `# @raycast.description ${(meta.desc ?? palette).replace(/\n/g, " ")}`,
      "",
      `# generated from pal palette "${palette}" - do not edit`,
      `exec pal pick ${palette} <<'PAL_ITEM'`,
      json,
      "PAL_ITEM",
      "",
    ];
    writeFileSync(join(OUT, `${name}.sh`), lines.join("\n"), { mode: 0o755 });
    count++;
  }
  console.log(`  ${palette}: ${items.length}`);
}

console.log(`\nwrote ${count} script commands to ${OUT}`);
console.log("Register that folder once: Raycast Settings -> Extensions -> Script Commands -> Add Directory");
try {
  execFileSync("open", ["raycast://extensions/raycast/raycast/refresh-script-directories"], { env });
} catch {
  // Raycast may not be running; the directory is picked up on next launch.
}
