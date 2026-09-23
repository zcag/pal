// onepassword against a fake `op` put first on PATH before the host spawns:
// a shell script whose sign-in state is a file the tests flip, answering
// `item list`, `item get` and `account list` in the CLI's shapes and logging
// every call, so the cache and the arguments can be checked.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, writeTool } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-op-"));
const state = join(dir, "state");
const log = join(dir, "log");
const items = [
  { id: "gh", title: "GitHub", category: "LOGIN", vault: { id: "v1", name: "Personal" }, additional_information: "zcag", urls: [{ href: "https://github.com/login", primary: true }, { href: "gist.github.com" }], favorite: true, tags: ["dev"], updated_at: "2026-09-01T10:00:00Z" },
  { id: "bank", title: "Akbank", category: "LOGIN", vault: { id: "v1", name: "Personal" }, additional_information: "12345678", urls: [{ href: "https://www.akbank.com" }] },
  { id: "note", title: "Wifi", category: "SECURE_NOTE", vault: { id: "v2", name: "Work" } },
  { id: "card", title: "Visa", category: "CREDIT_CARD", vault: { id: "v2", name: "Work" }, additional_information: "1234" },
  { id: "old", title: "Old thing", category: "LOGIN", vault: { id: "v3", name: "Archive" } },
];
writeFileSync(join(dir, "items.json"), JSON.stringify(items));
writeFileSync(state, "out");
writeFileSync(log, "");
writeTool(join(dir, "op"), `#!/bin/bash
echo "$*" >> "${log}"
if [ "$(cat "${state}")" = out ]; then
  echo "[ERROR] 2026/09/16 12:00:00 You are not currently signed in. Please run \\\`op signin --help\\\` for instructions" >&2
  exit 1
fi
case "$1 $2" in
  "item list") cat "${dir}/items.json" ;;
  "item get")
    id=$3; shift 3
    if [ "$id" = note ]; then echo "[ERROR] 2026/09/16 12:00:00 \\"note\\" isn't a field in the \\"Wifi\\" item" >&2; exit 1; fi
    case "$*" in
      *--otp*) echo "123456" ;;
      *label=password*) echo "s3cret-$id" ;;
      *label=username*) echo "user-$id" ;;
    esac ;;
  "account list") echo '[{"url":"my.1password.com","email":"me@example.com","user_uuid":"USER1","account_uuid":"ACC1","shorthand":"my"}]' ;;
  *) echo "unknown: $*" >&2; exit 2 ;;
esac
`);


const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);

let host: Host;
beforeAll(async () => {
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try { host = await Host.bundled({ settings: { onepassword: { settings: { vaults: ["Personal", "Work"], ttl: 300 } } } }); } finally { process.env.PATH = path; }
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = (filter?: string, refresh?: boolean) => host.list("onepassword", "items", undefined, { filter, refresh });
const pick = (id: string, action?: string) => host.pick("onepassword", "items", id, action);

describe("onepassword", () => {
  test("meta: indexed with the ttl and one filter per configured vault", () => {
    expect(host.loaded().find((l) => l.extension === "onepassword")!.palettes[0]).toMatchObject({
      name: "items", title: "1Password", live: false, input: false, icon: tile("blue", "\u{f0bc4}"), ttl: 300,
      filters: [{ id: "all", title: "All vaults" }, { id: "Personal", title: "Personal" }, { id: "Work", title: "Work" }],
    });
  });

  test("signed out: one hint row with a help link, nothing cached", async () => {
    const rows = await list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "hint:signin", name: "Connect the 1Password CLI to the app", icon: "\u{f0342}", actions: [{ id: "help", title: "Open the setup guide" }] });
    expect(rows[0].subtitle).not.toMatch(/\.$/);
    expect(rows[0].subtitle).toContain("Integrate with 1Password CLI");
    expect(await pick("hint:signin", "help")).toEqual({ open: expect.stringContaining("1password.com") });
    expect(await pick("hint:signin")).toEqual({ keep: true });
    expect(calls()).toEqual(["item list --format json"]);
  });

  test("signed in: items of the configured vaults, favourites first then by title, vault and username as subtitle, icons by category", async () => {
    writeFileSync(state, "in");
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual(["gh", "bank", "card", "note"]);
    expect(rows[0]).toMatchObject({
      name: "GitHub", subtitle: "Personal · zcag", icon: "\u{f030b}",
      keywords: ["github.com", "gist.github.com", "zcag", "login", "Personal", "dev"],
      accessories: [{ tag: "favorite", color: "amber" }, { text: "github.com" }],
      actions: [{ id: "password", title: "Copy password" }, { id: "username", title: "Copy username", shortcut: "cmd+u" }, { id: "otp", title: "Copy one-time code", shortcut: "cmd+t" }, { id: "open", title: "Open in 1Password", shortcut: "cmd+o" }],
    });
    expect(rows[0].detail!.metadata).toEqual(expect.arrayContaining([{ label: "Vault", value: "Personal" }, { label: "Website", link: { text: "https://github.com/login", href: "https://github.com/login" } }, { label: "Tags", tags: [{ text: "dev" }] }]));
    expect(rows[2]).toMatchObject({ name: "Visa", subtitle: "Work · 1234", icon: "\u{f019b}", accessories: [] });
    expect(rows[3]).toMatchObject({ name: "Wifi", subtitle: "Work", icon: "\u{f039e}" });
    // Never a secret in a row.
    expect(JSON.stringify(rows)).not.toContain("s3cret");
  });

  test("the list is cached for the ttl: a filter does not ask op again, refresh does", async () => {
    const before = calls().length;
    expect((await list("Work")).map((r) => r.id)).toEqual(["card", "note"]);
    expect((await list("Personal")).map((r) => r.id)).toEqual(["gh", "bank"]);
    expect(calls().length).toBe(before);
    await list("all", true);
    expect(calls().length).toBe(before + 1);
    expect((await list("Nope"))).toEqual([expect.objectContaining({ id: "hint:none", name: "No items" })]);
  });

  test("copy password on Enter, username and one-time code from the panel, each straight from op item get", async () => {
    // The password and the code are concealed copies that clear after 30 s; the username is a plain one.
    expect(await pick("gh")).toEqual({ copy: { text: "s3cret-gh", concealed: true, clear_after: 30 }, hud: "Copied password, clears in 30 s" });
    expect(await pick("gh", "password")).toEqual({ copy: { text: "s3cret-gh", concealed: true, clear_after: 30 }, hud: "Copied password, clears in 30 s" });
    expect(await pick("gh", "username")).toEqual({ copy: "user-gh", hud: "Copied username" });
    expect(await pick("bank", "otp")).toEqual({ copy: { text: "123456", concealed: true, clear_after: 30 }, hud: "Copied one-time code, clears in 30 s" });
    expect(calls().slice(-4)).toEqual([
      "item get gh --fields label=password --reveal", "item get gh --fields label=password --reveal", "item get gh --fields label=username --reveal", "item get bank --otp",
    ]);
  });

  test("a field op does not have is a failure toast with the CLI's message, the panel kept", async () => {
    expect(await pick("note", "password")).toMatchObject({ keep: true, toast: { title: "Could not copy the password", message: '"note" isn\'t a field in the "Wifi" item', style: "failure" } });
  });

  test("open is the app's view-item link with the item, its vault and the account", async () => {
    expect(await pick("gh", "open")).toEqual({ open: "onepassword://view-item?i=gh&v=v1&a=ACC1" });
    expect(calls()).toContain("account list --format json");
  });

  test("the account setting reaches every op call", async () => {
    host.changeSettings("onepassword", { settings: { vaults: ["Personal", "Work"], ttl: 0, account: "my" } });
    await list();
    expect(calls().at(-1)).toBe("item list --format json --account my");
    expect(await pick("gh", "username")).toEqual({ copy: "user-gh", hud: "Copied username" });
    expect(calls().at(-1)).toBe("item get gh --fields label=username --reveal --account my");
  });

  test("signing out again: the next listing past the ttl is the hint row", async () => {
    writeFileSync(state, "out");
    expect((await list()).map((r) => r.id)).toEqual(["hint:signin"]);
  });
});
