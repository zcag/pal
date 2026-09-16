// otp against a fixture chat.db built here with bun:sqlite (the columns the
// query reads, in Messages' shapes: nanoseconds since 2001, the text in
// `attributedBody` when `text` is NULL) and a fixture Contacts database, so
// the real ~/Library/Messages is never touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";
import { ago, groups, render } from "../../../extensions/otp/view.ts";
import { checkView } from "../../../sdk/src/view.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";

const MAC = process.platform === "darwin";
const dir = mkdtempSync(join(tmpdir(), "pal-otp-"));
const db = join(dir, "chat.db");
const contacts = join(dir, "AddressBook-v22.abcddb");
const APPLE = 978_307_200_000;
const NOW = Date.now();
const MIN = 60_000, HOUR = 3600_000;
/** `message.date` for a unix-ms time. */
const at = (ms: number) => (ms - APPLE) * 1e6;

/** An `attributedBody` as Messages writes it: the string after `NSString`, five framing bytes, and a length. */
function typedstream(text: string): Uint8Array {
  const bytes = Buffer.from(text, "utf8");
  const len = bytes.length < 128 ? Buffer.from([bytes.length]) : Buffer.from([0x81, bytes.length & 0xff, bytes.length >> 8]);
  return Buffer.concat([Buffer.from("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+", "latin1"), len, bytes, Buffer.from("\x86\x84\x02iI\x01", "latin1")]);
}

const messages: [id: number, sender: string, when: number, text: string | null, body?: string, fromMe?: number][] = [
  [1, "AKBANK", NOW - 1 * MIN, "Akbank Internet Sifreniz: 483920. Kimseyle paylasmayin. Bakiye 1.250,00 TL, 16.09.2026 19:13"],
  [2, "22000", NOW - 5 * MIN, null, "G-712345 is your Google verification code."],
  [3, "SPAMCO", NOW - 2 * MIN, "Kod: 555555 ile giris yapin"],
  [4, "+905551112233", NOW - 30 * HOUR, "Your verification code is 1234"],
  [5, "AKBANK", NOW - 3 * MIN, "Kargonuz 1234567 takip numarasi ile yola cikti"],
  [6, "AKBANK", NOW - 4 * MIN, "my code is 999999", undefined, 1],
  [7, "*Enpara", NOW - 40 * HOUR, "Enpara.com sifreniz 246810"],
  [8, "info@shop.example", NOW - 6 * MIN, "Your one-time passcode is 8765. It expires in 10 minutes"],
];

let host: Host;
beforeAll(async () => {
  const c = new Database(db);
  c.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER, date INTEGER, is_from_me INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  `);
  const handles = new Map<string, number>();
  for (const [id, sender, when, text, body, fromMe] of messages) {
    if (!handles.has(sender)) {
      handles.set(sender, handles.size + 1);
      c.run("INSERT INTO handle (ROWID, id, service) VALUES (?, ?, 'SMS')", [handles.size, sender]);
      c.run("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, '')", [handles.size, sender]);
    }
    c.run("INSERT INTO message (ROWID, guid, text, attributedBody, handle_id, date, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, `g${id}`, text, body ? typedstream(body) : null, handles.get(sender)!, at(when), fromMe ?? 0]);
    c.run("INSERT INTO chat_message_join VALUES (?, ?)", [handles.get(sender)!, id]);
  }
  // Message 1 also in a second chat: the join must not list it twice.
  c.run("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (99, 'chat99', 'Group')");
  c.run("INSERT INTO chat_message_join VALUES (99, 1)");
  c.close();
  const a = new Database(contacts);
  a.exec(`
    CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT);
    CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESS TEXT);
    INSERT INTO ZABCDRECORD VALUES (1, 'Ayşe', 'Yılmaz', NULL), (2, NULL, NULL, 'Shop');
    INSERT INTO ZABCDPHONENUMBER VALUES (1, 1, '+90 (555) 111 22 33');
    INSERT INTO ZABCDEMAILADDRESS VALUES (1, 2, 'info@shop.example');
  `);
  a.close();
  process.env.PAL_OTP_TICK_MS = "100";
  host = await Host.bundled({ settings: { otp: { settings: { db, contacts, senders: ["spamco"], hours: 48 } } } }).finally(() => delete process.env.PAL_OTP_TICK_MS);
});
/** The popover's tree of an item, checked as the host does. */
const viewOf = (item: { menu?: unknown }): View => checkView((item.menu as { view: View }).view);
const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).filter((n) => n.type === "text").map((n) => (n as { value: string }).value);
const tiles = (v: View) => nodes(v.tree).filter((n) => n.type === "tile").map((n) => (n as { text?: string }).text);
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("otp", "otp");
const pick = (id: string, action?: string) => host.pick("otp", "otp", id, action);

describe.skipIf(!MAC)("otp", () => {
  test("meta: live, indexed", () => {
    expect(host.loaded().find((l) => l.extension === "otp")!.palettes[0]).toMatchObject({ name: "otp", title: "Verification Codes", live: true, input: false, icon: tile("green", "\u{f0369}") });
  });

  test("codes newest first, one row per message, Today then Earlier; no row for a sent message, a denied sender or a text without a code", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["1", "2", "8", "4", "7"]);
    expect(items.map((i) => i.section)).toEqual(["Today", "Today", "Today", "Earlier", "Earlier"]);
    expect(items.map((i) => i.accessories![0])).toEqual([
      { tag: "483920", color: "green" }, { tag: "712345", color: "green" }, { tag: "8765", color: "green" }, { tag: "1234", color: "green" }, { tag: "246810", color: "green" },
    ]);
    for (const i of items) {
      expect(i.accessories![1]).toEqual({ date: expect.any(Number) });
      expect(i.actions!.map((a) => a.id)).toEqual(["paste", "copy", "copy-sender"]);
      expect(i.icon).toBe("\u{f0369}");
    }
  });

  test("the sender is the row: a shortcode as is, a number by its contact, an email by its contact; the text is the subtitle", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by["1"]).toMatchObject({ name: "AKBANK", subtitle: "Akbank Internet Sifreniz: 483920. Kimseyle paylasmayin. Bakiye 1.250,00 TL, 16.09.2026 19:13", keywords: ["483920", "AKBANK"] });
    expect(by["2"]).toMatchObject({ name: "22000", subtitle: "G-712345 is your Google verification code." });
    expect(by["4"]).toMatchObject({ name: "Ayşe Yılmaz", keywords: ["1234", "+905551112233", "Ayşe Yılmaz"] });
    expect(by["4"].detail).toMatchObject({ metadata: expect.arrayContaining([{ label: "From", value: "Ayşe Yılmaz (+905551112233)" }]) });
    expect(by["8"].name).toBe("Shop");
    expect(by["7"].name).toBe("*Enpara");
  });

  test("Enter pastes the code, the other actions copy the code or the raw sender", async () => {
    await list();
    expect(await pick("1")).toEqual({ paste: { text: "483920" } });
    expect(await pick("2", "paste")).toEqual({ paste: { text: "712345" } });
    // Concealed: out of every clipboard history and cleared after 30 s.
    expect(await pick("1", "copy")).toEqual({ copy: { text: "483920", concealed: true, clear_after: 30 }, hud: "Copied code, clears in 30 s" });
    expect(await pick("4", "copy-sender")).toEqual({ copy: "+905551112233" });
    expect(await pick("no-such", "copy")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });

  test("hours bounds the window; the default 24 h drops the day-old ones", async () => {
    host.changeSettings("otp", { settings: { db, contacts, senders: ["spamco"] } });
    expect((await list()).map((i) => i.id)).toEqual(["1", "2", "8"]);
    host.changeSettings("otp", { settings: { db, contacts, senders: [], hours: 48 } });
    expect((await list()).map((i) => i.id)).toEqual(["1", "3", "2", "8", "4", "7"]);
    host.changeSettings("otp", { settings: { db, contacts, senders: ["spamco"], hours: 48 } });
  });

  test("a missing database is one hint row; the Full Disk Access row opens the Privacy pane", async () => {
    host.changeSettings("otp", { settings: { db: join(dir, "nope.db"), contacts, hours: 48 } });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "missing", name: "No Messages database", icon: "\u{f164d}", actions: [] });
    expect(items[0].subtitle).not.toMatch(/\.$/);
    host.changeSettings("otp", { settings: { db, contacts, senders: ["spamco"], hours: 48 } });
    expect(await pick("fda", "settings")).toEqual({ open: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" });
  });
});

describe.skipIf(!MAC)("otp bar: latest-code", () => {
  /** A code `ageMs` old, as the newest message, from the fixture's handle `from` (1 is AKBANK, 3 SPAMCO); removed after. */
  const arrive = (id: number, text: string, ageMs: number, from = 1) => {
    const c = new Database(db);
    c.run("INSERT INTO message (ROWID, guid, text, attributedBody, handle_id, date, is_from_me) VALUES (?, ?, ?, NULL, ?, ?, 0)", [id, `g${id}`, text, from, at(Date.now() - ageMs)]);
    c.run("INSERT INTO chat_message_join VALUES (?, ?)", [from, id]);
    c.close();
  };
  const remove = (id: number) => { const c = new Database(db); c.run("DELETE FROM message WHERE ROWID = ?", [id]); c.run("DELETE FROM chat_message_join WHERE message_id = ?", [id]); c.close(); };

  test("meta: the manifest entry with a 10 s refresh and the popover's keys", () => {
    expect(host.loaded().find((l) => l.extension === "otp")!.bar).toEqual([{ id: "latest-code", title: "Latest code", description: expect.any(String), refresh: { every: 10 }, keys: expect.any(Array), source: true }]);
  });

  test("the newest code of the fixture is a minute old: hidden; open says there is none, so does a popover key", async () => {
    expect(await host.render("otp", "latest-code")).toEqual({ hidden: true });
    expect(await host.barOpen("otp", "latest-code")).toEqual({ hud: "No recent code" });
    expect(await host.barAction("otp", "latest-code", "copy", { reason: "open", compact: true })).toEqual({ keep: true, hud: "No recent code" });
  });

  test("a code that just arrived is the title, green, with the sender in the tooltip and a refresh that lands at the minute; the popover has the digits, the sender, the countdown and the two before it; a click copies", async () => {
    arrive(50, "Your verification code is 424242", 20_000);
    try {
      const item = await host.render("otp", "latest-code", { reason: "every" });
      expect(item).toMatchObject({ icon: "\u{f084}", title: "424242", color: "green", tooltip: "AKBANK: Your verification code is 424242" });
      expect(item.refresh).toBeGreaterThanOrEqual(39);
      expect(item.refresh).toBeLessThanOrEqual(40);
      const v = viewOf(item);
      expect(v).toMatchObject({ id: "latest", keys: "actions", title: "424242 from AKBANK" });
      expect(tiles(v)).toEqual(["4", "2", "4", "2", "4", "2"]);
      // The digits row copies on a click; the sender, when, the text, the seconds left, the hints, then the two codes of the last hour before it (the fixture's newest two: AKBANK's and SPAMCO is denied, so Google's).
      expect(nodes(v.tree).find((n) => n.key === "digits-424242")).toMatchObject({ action: "copy" });
      const t = texts(v);
      expect(t.slice(0, 3)).toEqual(["AKBANK", "20 s ago", "Your verification code is 424242"]);
      expect(t[3]).toMatch(/^(39|40)s$/);
      expect(t.slice(4, 8)).toEqual(["copy", "paste", "copy sender", "all codes"]);
      expect(t.slice(8)).toEqual(["Earlier", "483920", "AKBANK", "1 min ago", "712345", "22000", "5 min ago"]);
      expect(v.actions.map((a) => a.id)).toEqual(["copy", "paste", "copy-sender", "open", "copy:1", "copy:2"]);
      const bar = nodes(v.tree).find((n) => n.type === "progress") as Extract<ViewNode, { type: "progress" }>;
      expect(bar.color).toBe("amber");
      expect(bar.value).toBeGreaterThan(0.6);
      expect(bar.value).toBeLessThan(0.7);
      // The strip's click without a menu, and the popover's keys: Enter copies concealed, p pastes, s the raw sender, o pushes the palette, an earlier row's click copies that code.
      expect(await host.barOpen("otp", "latest-code", { reason: "open", anchor: "menubar" })).toEqual({ copy: { text: "424242", concealed: true, clear_after: 30 }, hud: "Copied code, clears in 30 s" });
      const ctx = { reason: "open" as const, compact: true as const };
      expect(await host.barAction("otp", "latest-code", "copy", ctx)).toEqual({ copy: { text: "424242", concealed: true, clear_after: 30 }, hud: "Copied code, clears in 30 s" });
      expect(await host.barAction("otp", "latest-code", "paste", ctx)).toEqual({ paste: { text: "424242" } });
      expect(await host.barAction("otp", "latest-code", "copy-sender", ctx)).toEqual({ copy: "AKBANK" });
      expect(await host.barAction("otp", "latest-code", "open", ctx)).toEqual({ push: { extension: "otp", palette: "otp" } });
      expect(await host.barAction("otp", "latest-code", "copy:2", ctx)).toEqual({ copy: { text: "712345", concealed: true, clear_after: 30 }, hud: "Copied code, clears in 30 s" });
      expect(await host.barAction("otp", "latest-code", "copy:404", ctx)).toEqual({ keep: true, hud: "That code is no longer listed" });
    } finally { remove(50); }
  });

  test("the popover's tick: while its level shows, the tree is pushed every tick with the seconds counted down, no read; hidden stops it", async () => {
    arrive(53, "Your verification code is 606060", 30_000);
    try {
      await host.render("otp", "latest-code", { reason: "every" });
      host.viewShown("otp", { bar: "latest-code" }, "latest", true);
      const u = await host.nextViewUpdate("otp", { bar: "latest-code" });
      expect(u).toMatchObject({ extension: "otp", bar: "latest-code", spec: { id: "latest", keys: "actions" } });
      expect(texts(u.spec as View)[3]).toMatch(/^(29|30)s$/);
      await Bun.sleep(1100);
      const all = host.viewUpdates("otp", { bar: "latest-code" });
      expect(all.length).toBeGreaterThan(5);
      expect(texts(all[all.length - 1].spec as View)[3]).toMatch(/^(28|29)s$/);
      host.viewHidden("otp", { bar: "latest-code" }, "latest", true);
      await Bun.sleep(150);
      const n = host.viewUpdates("otp", { bar: "latest-code" }).length;
      await Bun.sleep(300);
      expect(host.viewUpdates("otp", { bar: "latest-code" }).length).toBe(n);
    } finally { remove(53); }
  });

  test("older than a minute is hidden; a denied sender never shows; a missing database is hidden, not an error", async () => {
    arrive(51, "Your verification code is 131313", 61_000);
    arrive(52, "Kod: 777777", 5_000, 3);
    try {
      expect(await host.render("otp", "latest-code")).toEqual({ hidden: true });
    } finally { remove(51); remove(52); }
    host.changeSettings("otp", { settings: { db: join(dir, "nope.db"), contacts, hours: 48 } });
    expect(await host.render("otp", "latest-code")).toEqual({ hidden: true });
    host.changeSettings("otp", { settings: { db, contacts, senders: ["spamco"], hours: 48 } });
  });
});

describe("the popover's tree (view.ts)", () => {
  const c = { id: "1", code: "482913", name: "Akbank", sender: "AKBANK", text: "Kodunuz: 482913", at: 1000 };
  test("digits in groups: threes, fours, halves, letters whole; the earlier rows are optional; the seconds count down to the window; nothing is one message", () => {
    expect(groups("482913")).toEqual(["482", "913"]);
    expect(groups("12345678")).toEqual(["1234", "5678"]);
    expect(groups("8765")).toEqual(["8765"]);
    expect(groups("12345")).toEqual(["123", "45"]);
    expect(groups("A1B2C3")).toEqual(["A1B2C3"]);
    const v = checkView(render({ latest: c, previous: [], now: 41_000, window: 60_000 }));
    expect(tiles(v)).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(texts(v)).toEqual(["Akbank", "40 s ago", "Kodunuz: 482913", "20s", "copy", "paste", "copy sender", "all codes"]);
    expect(v.actions.map((a) => a.id)).toEqual(["copy", "paste", "copy-sender", "open"]);
    // Eight digits take narrower tiles so the row fits 396.
    const eight = checkView(render({ latest: { ...c, code: "12345678" }, previous: [], now: 1000, window: 60_000 }));
    expect((nodes(eight.tree).find((n) => n.type === "tile") as { width: number }).width).toBe(40);
    const none = checkView(render({ previous: [], now: 0, window: 60_000 }));
    expect(texts(none)[0]).toBe("No recent code");
    expect(none.actions.map((a) => a.id)).toEqual(["open"]);
  });
  test("ago: just now, seconds, minutes, hours", () => {
    expect(ago(1000, 3000)).toBe("just now");
    expect(ago(0, 23_000)).toBe("23 s ago");
    expect(ago(0, 5 * 60_000)).toBe("5 min ago");
    expect(ago(0, 2 * 3600_000)).toBe("2 h ago");
  });
});

describe.skipIf(MAC)("otp on linux", () => {
  test("one Unavailable row; the bar item is hidden", async () => {
    expect(await list()).toEqual([expect.objectContaining({ id: "unavailable", name: "Unavailable", actions: [] })]);
    expect(await host.render("otp", "latest-code")).toEqual({ hidden: true });
  });
});
