// otp against a fixture chat.db built here with bun:sqlite (the columns the
// query reads, in Messages' shapes: nanoseconds since 2001, the text in
// `attributedBody` when `text` is NULL) and a fixture Contacts database, so
// the real ~/Library/Messages is never touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

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
  host = await Host.bundled({ settings: { otp: { settings: { db, contacts, senders: ["spamco"], hours: 48 } } } });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("otp", "otp");
const pick = (id: string, action?: string) => host.pick("otp", "otp", id, action);

describe.skipIf(!MAC)("otp", () => {
  test("meta: live, indexed", () => {
    expect(host.loaded().find((l) => l.extension === "otp")!.palettes[0]).toMatchObject({ name: "otp", title: "Verification Codes", live: true, input: false, icon: "✉" });
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
      expect(i.icon).toBe("✉");
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
    expect(await pick("1", "copy")).toEqual({ copy: "483920" });
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
    expect(items[0]).toMatchObject({ id: "missing", name: "No Messages database", actions: [] });
    host.changeSettings("otp", { settings: { db, contacts, senders: ["spamco"], hours: 48 } });
    expect(await pick("fda", "settings")).toEqual({ open: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" });
  });
});

describe.skipIf(MAC)("otp on linux", () => {
  test("one Unavailable row", async () => {
    expect(await list()).toEqual([expect.objectContaining({ id: "unavailable", name: "Unavailable", actions: [] })]);
  });
});
