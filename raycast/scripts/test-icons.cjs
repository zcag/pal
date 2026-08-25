#!/usr/bin/env node
/**
 * Icon resolution is the fiddliest part of the bridge - it decides what every
 * row looks like, and it silently degrades to a grey dot when it's wrong
 * (which is exactly how the default-parameter bug it now guards got in).
 *
 * @raycast/api only exists inside Raycast's runtime, so stub it and exercise
 * the module directly.
 */
const { execFileSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert");
const Module = require("module");

const root = join(__dirname, "..");
const out = mkdtempSync(join(tmpdir(), "pal-icon-test-"));

execFileSync(
  "npx",
  ["tsc", "src/lib/icon.ts", "--outDir", out, "--module", "commonjs",
   "--target", "ES2022", "--skipLibCheck", "--esModuleInterop", "--strict", "false"],
  { cwd: root, stdio: "inherit" },
);

// Only the icon names the module actually references exist, so a bogus name
// resolves to nothing - the way the real enum behaves.
const source = require("node:fs").readFileSync(join(root, "src/lib/icon.ts"), "utf8");
const known = new Set([...source.matchAll(/Icon\.([A-Za-z0-9]+)/g)].map((m) => m[1]));
// Real enum members the module doesn't happen to name itself.
for (const extra of ["Rocket", "Star", "Bolt"]) known.add(extra);
const Icon = Object.fromEntries([...known].map((name) => [name, `Icon.${name}`]));
const load = Module._load;
Module._load = function (request) {
  if (request === "@raycast/api") {
    return {
      Icon,
      Color: { Blue: "blue", Green: "green", Red: "red", Yellow: "yellow", Purple: "purple",
               Magenta: "magenta", Orange: "orange", PrimaryText: "pt", SecondaryText: "st" },
      Image: { Mask: {} },
    };
  }
  if (request === "@raycast/utils") return { getFavicon: (url) => `favicon(${url})` };
  return load.apply(this, arguments);
};

const { iconFor, itemIcon, resolveIcon, toColor } = require(join(out, "icon.js"));

const tabs = { name: "tabs", icon: null, icon_xdg: "google-chrome", icon_utf: null };
const otp = { name: "otp", icon: "✉️", icon_xdg: "mail-unread", icon_utf: null };

const cases = [
  // Most plugins set one icon on the palette, not on every item.
  ["item inherits the palette icon", itemIcon({ id: "1", name: "raycast.com/" }, tabs), "Icon.Globe"],
  ["palette emoji resolves too", itemIcon({ id: "1", name: "AXESS" }, otp), "Icon.Envelope"],
  ["a url item gets its favicon", itemIcon({ id: "1", name: "x", url: "https://tela.com/a" }, tabs), "favicon(https://tela.com/a)"],
  ["an explicit item icon wins", itemIcon({ id: "1", name: "x", icon_xdg: "utilities-terminal" }, tabs), "Icon.Terminal"],
  ["icon_rc names a Raycast icon directly", itemIcon({ id: "1", name: "x", icon_rc: "Rocket" }, tabs), "Icon.Rocket"],
  ["nothing anywhere falls back to a dot", itemIcon({ id: "1", name: "x" }, null), "Icon.Dot"],
  ["unresolvable source resolves to nothing", resolveIcon({ icon: "not-a-real-icon-name" }), undefined],
  ["dashed names camel-case into the enum", iconFor({ icon: "arrow-clockwise" }), "Icon.ArrowClockwise"],
  ["named colours map", toColor("green"), "green"],
  ["hex colours pass through", toColor("#ff0055"), "#ff0055"],
  ["unknown colours are dropped", toColor("chartreuse"), undefined],
];

let failed = 0;
for (const [label, got, want] of cases) {
  try {
    assert.deepStrictEqual(got, want);
    console.log(`ok   ${label}`);
  } catch {
    failed++;
    console.log(`FAIL ${label}\n       got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Emoji have no Raycast icon, so they're inlined as SVG data URIs.
const emoji = String(itemIcon({ id: "1", name: "x", icon: "🔨" }, null));
if (emoji.startsWith("data:image/svg+xml")) console.log("ok   emoji renders as an inline svg");
else {
  failed++;
  console.log(`FAIL emoji renders as an inline svg\n       got ${emoji.slice(0, 40)}`);
}

console.log(failed ? `\n${failed} failed` : `\nall ${cases.length + 1} passed`);
process.exit(failed ? 1 : 0);
