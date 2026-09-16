// Snippets: the placeholder expansion (placeholders.ts, pure, with the
// clock and the clipboard pinned), then the extension over the wire
// against the harness's in-memory storage and clipboard: rows with the
// keyword as a row keyword, paste and copy with placeholders filled, the
// create and edit forms, refusal, delete.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asSnippets, badKeyword, expand, hasPlaceholders, isoDate, isoTime, preview } from "../../../extensions/snippets/placeholders.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host, fixtures, stored } from "../harness.ts";

const at = new Date(2026, 8, 16, 9, 5); // local 2026-09-16 09:05
const pinned = { clipboard: () => "from the clipboard", now: () => at, uuid: () => "u-u-i-d" };

describe("placeholders", () => {
  test("date, time, datetime, uuid and clipboard are filled; anything else in braces stays", async () => {
    expect(await expand("On {date} at {time} ({datetime}) id {uuid}: {clipboard} {cursor} {x}", pinned)).toBe("On 2026-09-16 at 09:05 (2026-09-16 09:05) id u-u-i-d: from the clipboard {cursor} {x}");
    expect(isoDate(at)).toBe("2026-09-16");
    expect(isoTime(at)).toBe("09:05");
  });
  test("every {uuid} is a fresh one; the clipboard is read once and only when asked for", async () => {
    let n = 0, reads = 0;
    const s = { clipboard: () => { reads++; return "c"; }, uuid: () => `u${++n}` };
    expect(await expand("{uuid} {uuid}", s)).toBe("u1 u2");
    expect(reads).toBe(0);
    expect(await expand("{clipboard}{clipboard}", s)).toBe("cc");
    expect(reads).toBe(1);
  });
  test("a text without placeholders comes back as it is, without touching the sources", async () => {
    const s = { clipboard: () => { throw new Error("not asked"); } };
    expect(await expand("plain { } text", s)).toBe("plain { } text");
    expect(hasPlaceholders("{date}")).toBe(true);
    expect(hasPlaceholders("{data}")).toBe(false);
  });
  test("helpers: keyword is one word, preview is the first non-empty line trimmed, asSnippets drops junk", () => {
    expect(badKeyword("sig")).toBeUndefined();
    expect(badKeyword("my sig")).toBe("One word, no spaces");
    expect(preview("\n\n  Best,\nCagdas")).toBe("  Best,");
    expect(preview("x".repeat(100), 10)).toBe("xxxxxxxxx…");
    expect(asSnippets([{ id: "1", name: "a", text: "t", keyword: "" }, { id: "2", name: "b", text: "t", keyword: "k" }, { id: "3", name: "c" }, 4])).toEqual([{ id: "1", name: "a", text: "t" }, { id: "2", name: "b", text: "t", keyword: "k" }]);
  });
});

let host: Host;
beforeAll(async () => {
  stored.clear();
  stored.set("snippets\0snippets", [
    { id: "sig", name: "Signature", keyword: "sig", text: "Best,\nCagdas" },
    { id: "stamp", name: "Stamp", text: "Reviewed {date} {time}\n{clipboard}" },
  ]);
  host = await Host.bundled();
});
afterAll(() => host.kill());

const list = () => host.list("snippets", "snippets");
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("snippets", "snippets", id, action, ctx);

describe("snippets", () => {
  test("rows: the create row first, then the snippets with the keyword as a row keyword and a tag, the text as detail, dynamic ones marked", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["create", "sig", "stamp"]);
    expect(items[0]).toMatchObject({ name: "Create Snippet", actions: [{ id: "create", title: "Create Snippet" }] });
    expect(items[1]).toMatchObject({ name: "Signature", subtitle: "Best,", keywords: ["sig"], accessories: [{ tag: "sig" }] });
    expect(items[1].detail!.markdown).toContain("Best,\nCagdas");
    expect(items[1].actions!.map((a) => a.id)).toEqual(["paste", "copy", "edit", "delete"]);
    expect(items[1].actions![3]).toMatchObject({ style: "destructive", confirm: "Delete this snippet?" });
    expect(items[2].keywords).toBeUndefined();
    expect(items[2].accessories).toEqual([{ text: "dynamic" }]);
  });

  test("Enter pastes the text, cmd+c copies it; placeholders filled from the clock and the newest clipboard text", async () => {
    expect(await pick("sig")).toEqual({ paste: { text: "Best,\nCagdas" } });
    expect(await pick("sig", "copy")).toEqual({ copy: "Best,\nCagdas" });
    const r = await pick("stamp", "paste");
    const text = (r.paste as { text: string }).text;
    const today = isoDate(new Date());
    expect(text).toMatch(new RegExp(`^Reviewed ${today} \\d\\d:\\d\\d\\n`));
    // The harness lists the fixtures in order; the first text entry is the clipboard's newest.
    expect(text.endsWith(`\n${fixtures.clipboard[0].text}`)).toBe(true);
    expect(host.coreCalls.filter((c) => c.method === "clipboard.list").pop()!.params).toEqual({ kind: "text", limit: 1 });
  });

  test("the create row answers a form; its submit stores the snippet and lists again", async () => {
    const form = (await pick("create", "create")).form as Form;
    expect(form).toMatchObject({ id: "create", title: "Create Snippet", submit: { id: "save", title: "Create" } });
    expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["name", "text", true], ["keyword", "text", false], ["text", "textarea", true]]);
    expect(await pick("create", "save", { values: { name: "Shrug", keyword: "shrug", text: "¯\\_(ツ)_/¯" } })).toEqual({ keep: true, toast: { title: "Created", message: "Shrug" } });
    const all = stored.get("snippets\0snippets") as { id: string; name: string; keyword?: string; text: string }[];
    expect(all).toHaveLength(3);
    expect(all[2]).toMatchObject({ name: "Shrug", keyword: "shrug", text: "¯\\_(ツ)_/¯" });
    expect((await list()).map((i) => i.name)).toContain("Shrug");
  });

  test("a keyword with a space, or an empty text, is refused with the form again", async () => {
    const before = JSON.stringify(stored.get("snippets\0snippets"));
    const r = await pick("create", "save", { values: { name: "Bad", keyword: "two words", text: "  " } });
    expect((r.form as Form).errors).toEqual({ keyword: "One word, no spaces", text: "Required" });
    expect(JSON.stringify(stored.get("snippets\0snippets"))).toBe(before);
  });

  test("edit answers the form filled in; its submit replaces the snippet in place, an emptied keyword is dropped", async () => {
    const form = (await pick("sig", "edit")).form as Form;
    expect(form).toMatchObject({ id: "sig", title: "Edit Signature", submit: { id: "save", title: "Save" } });
    expect(form.fields.map((f) => (f as { default?: unknown }).default)).toEqual(["Signature", "sig", "Best,\nCagdas"]);
    expect(await pick("sig", "save", { values: { name: "Sign-off", keyword: "", text: "Cheers" } })).toEqual({ keep: true, toast: { title: "Saved", message: "Sign-off" } });
    const all = stored.get("snippets\0snippets") as { id: string; name: string; text: string }[];
    expect(all.map((s) => s.id)).toEqual(["sig", "stamp", all[2].id]);
    expect(all[0]).toEqual({ id: "sig", name: "Sign-off", text: "Cheers" });
  });

  test("delete drops the snippet and lists again; an unknown id is an error, not a crash", async () => {
    expect(await pick("stamp", "delete")).toEqual({ keep: true, toast: { title: "Deleted", message: "Stamp" } });
    expect((await list()).map((i) => i.id)).not.toContain("stamp");
    expect((await host.call("pick", { extension: "snippets", palette: "snippets", id: "nope" })).error).toMatch(/no snippet nope/);
    expect((await host.hello()).pid).toBe(host.pid);
  });
});
