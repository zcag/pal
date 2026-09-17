// Snippets: the placeholder expansion (the SDK's placeholders.ts, pure,
// with the clock and the clipboard pinned), then the extension over the wire
// against the harness's in-memory storage and clipboard (its clock pinned
// too, `PAL_NOW` through the harness, snippets/clock.ts): rows with the
// keyword as a row keyword, paste and copy with placeholders filled, the
// create and edit forms, refusal, delete.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asSnippets, badKeyword, fromJson, preview } from "../../../extensions/snippets/placeholders.ts";
import { expand, formatDate, hasPlaceholders, isoDate, isoTime, offsetDate } from "../../../sdk/src/placeholders.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host, fixtures, stored } from "../harness.ts";

process.env.PAL_NOW = "2026-09-16T09:05:00"; // the host's clock, local to its zone
const at = new Date(2026, 8, 16, 9, 5); // local 2026-09-16 09:05
const pinned = { clipboard: () => "from the clipboard", now: () => at, uuid: () => "u-u-i-d" };

describe("create from the clipboard", () => {
  test("a level pushed with args.create is one row whose form comes filled with the text", async () => {
    const rows = await host.list("snippets", "snippets", "", { args: { create: "Best,\nAda" } });
    expect(rows).toEqual([{ id: "create", name: "Create Snippet from the clipboard", subtitle: "Best, Ada", icon: "\u{f0415}", actions: [{ id: "create", title: "Create snippet" }] }]);
    const r = await host.pick("snippets", "snippets", "create", undefined, { args: { create: "Best,\nAda" } });
    expect(r.form!.fields.find((f) => f.id === "text")).toMatchObject({ default: "Best,\nAda" });
    expect((await host.pick("snippets", "snippets", "create")).form!.fields.find((f) => f.id === "text")).not.toHaveProperty("default");
  });
});

describe("placeholders", () => {
  test("date, time, datetime, uuid and clipboard are filled, selection from the clipboard without a selection source; {cursor} goes (a paste cannot place the caret), anything else in braces stays", async () => {
    expect(await expand("On {date} at {time} ({datetime}) id {uuid}: {clipboard} {cursor} {x}", pinned)).toBe("On 2026-09-16 at 09:05 (2026-09-16 09:05) id u-u-i-d: from the clipboard  {x}");
    expect(await expand("<{selection}>", pinned)).toBe("<from the clipboard>");
    expect(isoDate(at)).toBe("2026-09-16");
    expect(isoTime(at)).toBe("09:05");
  });
  test("{selection} is the selected text; the clipboard when nothing is selected or the read fails; each source read once", async () => {
    let sel = 0, clip = 0;
    const s = { ...pinned, clipboard: () => { clip++; return "clip"; }, selection: () => { sel++; return "marked"; } };
    expect(await expand("<{selection}> <{selection}> <{clipboard}>", s)).toBe("<marked> <marked> <clip>");
    expect([sel, clip]).toEqual([1, 1]);
    expect(await expand("<{selection}>", { ...pinned, selection: () => null })).toBe("<from the clipboard>");
    expect(await expand("<{selection}>", { ...pinned, selection: () => "" })).toBe("<from the clipboard>");
    expect(await expand("<{selection}>", { ...pinned, selection: async () => { throw new Error("needs Accessibility"); } })).toBe("<from the clipboard>");
    expect(await expand("<{clipboard}>", { ...pinned, selection: () => { throw new Error("not asked"); } })).toBe("<from the clipboard>");
  });
  test("every {uuid} is a fresh one; the clipboard is read once and only when asked for", async () => {
    let n = 0, reads = 0;
    const s = { clipboard: () => { reads++; return "c"; }, uuid: () => `u${++n}` };
    expect(await expand("{uuid} {uuid}", s)).toBe("u1 u2");
    expect(reads).toBe(0);
    expect(await expand("{clipboard}{clipboard}", s)).toBe("cc");
    expect(reads).toBe(1);
  });
  test("format= writes the date and time with the tokens, the rest as written; offset= moves by days, weeks, hours or minutes first", async () => {
    expect(await expand('{date format=DD.MM.YYYY} {date format="ddd D MMM YY"} {time format=HH:mm:ss} {datetime format=YYYY-MM-DDTHH:mm}', pinned)).toBe("16.09.2026 Wed D Sep 26 09:05:00 2026-09-16T09:05");
    expect(await expand("{date offset=+1d} {date offset=-2w} {time offset=+3h} {time offset=-90m} {datetime offset=+1d format=ddd}", pinned)).toBe("2026-09-17 2026-09-02 12:05 07:35 Thu");
    expect(await expand("{date offset=soon} {date format=MMM}", pinned)).toBe("2026-09-16 Sep");
    expect(formatDate(at, "YYYY/MM/DD HH:mm:ss ddd MMM")).toBe("2026/09/16 09:05:00 Wed Sep");
    expect(isoDate(offsetDate(at, "+1w"))).toBe("2026-09-23");
    expect(offsetDate(at, undefined)).toEqual(at);
  });
  test("{snippet name=...} is another snippet's text with its own placeholders filled, one level deep; unknown or without a source it stays as written", async () => {
    const texts: Record<string, string> = { sig: "Best,\nAda ({date})", nested: "[{snippet name=sig}] {snippet name=x}" };
    const s = { ...pinned, snippet: (name: string) => texts[name] };
    expect(await expand("Hi\n{snippet name=sig}", s)).toBe("Hi\nBest,\nAda (2026-09-16)");
    expect(await expand('{snippet name="sig"}!', s)).toBe("Best,\nAda (2026-09-16)!");
    expect(await expand("{snippet name=nested}", s)).toBe("[{snippet name=sig}] {snippet name=x}");
    expect(await expand("{snippet name=nope} {snippet}", s)).toBe("{snippet name=nope} {snippet}");
    expect(await expand("{snippet name=sig}", pinned)).toBe("{snippet name=sig}");
  });
  test("a text without placeholders comes back as it is, without touching the sources", async () => {
    const s = { clipboard: () => { throw new Error("not asked"); } };
    expect(await expand("plain { } text", s)).toBe("plain { } text");
    expect(hasPlaceholders("{date}")).toBe(true);
    expect(hasPlaceholders("{data}")).toBe(false);
  });
  test("fromJson takes {name, text, keyword?}, drops the rest and a keyword with a space, gives fresh ids; a non-array throws", () => {
    const out = fromJson([{ name: " A ", text: "t", keyword: "a" }, { name: "B", text: "u", keyword: "two words" }, { name: "C" }, { text: "no name" }, null]);
    expect(out.map(({ id, ...s }) => s)).toEqual([{ name: "A", text: "t", keyword: "a" }, { name: "B", text: "u" }]);
    expect(new Set(out.map((s) => s.id)).size).toBe(2);
    expect(() => fromJson("x")).toThrow(/array/);
  });
  test("helpers: keyword is one word, preview is the first non-empty line trimmed, asSnippets drops junk", () => {
    expect(badKeyword("sig")).toBeUndefined();
    expect(badKeyword("my sig")).toBe("One word, no spaces");
    expect(preview("\n\n  Best,\nCagdas")).toBe("  Best,");
    expect(preview("x".repeat(100), 10)).toBe("xxxxxxxxx…");
    expect(asSnippets([{ id: "1", name: "a", text: "t", keyword: "" }, { id: "2", name: "b", text: "t", keyword: "k" }, { id: "3", name: "c" }, 4])).toEqual([{ id: "1", name: "a", text: "t" }, { id: "2", name: "b", text: "t", keyword: "k" }]);
  });
});

const dir = mkdtempSync(join(tmpdir(), "pal-sn-"));
let host: Host;
beforeAll(async () => {
  stored.clear();
  stored.set("snippets\0snippets", [
    { id: "sig", name: "Signature", keyword: "sig", text: "Best,\nCagdas" },
    { id: "stamp", name: "Stamp", text: "Reviewed {date} {time}\n{clipboard}" },
  ]);
  host = await Host.bundled({ core: { "selection.text": () => selected } });
});
/** What the canned `core/selection.text` answers. */
let selected: string | null = "the marked words";
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); delete process.env.PAL_NOW; });

const list = () => host.list("snippets", "snippets");
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("snippets", "snippets", id, action, ctx);

describe("snippets", () => {
  test("rows: the create row first, then the snippets with the keyword as a row keyword and a tag, the text as detail, dynamic ones marked, then Import and Export", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["create", "sig", "stamp", "import", "export"]);
    expect(items[3]).toMatchObject({ name: "Import Snippets", actions: [{ id: "import", title: "Import…" }] });
    expect(items[4]).toMatchObject({ name: "Export Snippets", actions: [{ id: "export", title: "Export…" }] });
    expect(items[0]).toMatchObject({ name: "Create Snippet", actions: [{ id: "create", title: "Create snippet" }], icon: "\u{f0415}" });
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
    expect(text.startsWith("Reviewed 2026-09-16 09:05\n")).toBe(true);
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

  test("export asks for a path and writes the snippets (ids left out); import reads one back, skipping what is already there, refusing a file it cannot read", async () => {
    const out = join(dir, "snippets.json");
    const form = (await pick("export", "export")).form as Form;
    expect(form).toMatchObject({ id: "export", title: "Export Snippets", submit: { id: "save", title: "Export" } });
    expect((form.fields[0] as { default?: string }).default).toBe("~/Downloads/pal-snippets.json");
    const before = stored.get("snippets\0snippets") as { id: string; name: string; text: string; keyword?: string }[];
    expect(await pick("export", "save", { values: { path: out } })).toEqual({ keep: true, toast: { title: `Exported ${before.length} snippets`, message: out } });
    const written = await Bun.file(out).json();
    expect(written).toEqual(before.map(({ id, ...s }) => s));
    expect(await pick("import", "save", { values: { path: out } })).toEqual({ keep: true, toast: { title: "Imported 0 snippets", message: `${before.length} already there` } });
    writeFileSync(out, JSON.stringify([...written, { name: "New", text: "hello", keyword: "hi" }]));
    expect(await pick("import", "save", { values: { path: out } })).toEqual({ keep: true, toast: { title: "Imported 1 snippet", message: `${before.length} already there` } });
    const after = stored.get("snippets\0snippets") as { name: string; text: string; keyword?: string }[];
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ name: "New", text: "hello", keyword: "hi" });
    expect(((await pick("import", "save", { values: { path: join(dir, "missing.json") } })).form as Form).errors!.path).toMatch(/^Could not read/);
    expect(((await pick("import", "import")).form as Form).title).toBe("Import Snippets");
  });

  test("delete drops the snippet and lists again; an unknown id is an error, not a crash", async () => {
    expect(await pick("stamp", "delete")).toEqual({ keep: true, toast: { title: "Deleted", message: "Stamp" } });
    expect((await list()).map((i) => i.id)).not.toContain("stamp");
    expect((await host.call("pick", { extension: "snippets", palette: "snippets", id: "nope" })).error).toMatch(/no snippet nope/);
    expect((await host.hello()).pid).toBe(host.pid);
  });
  test("{snippet name=} reads another snippet by name or keyword through the extension", async () => {
    await pick("create", "save", { values: { name: "Wrap", keyword: "", text: "<{snippet name=shrug}> <{snippet name=sign-off}>" } });
    const wrap = (stored.get("snippets\0snippets") as { id: string; name: string }[]).find((x) => x.name === "Wrap")!;
    expect(await pick(wrap.id, "copy")).toEqual({ copy: "<¯\\_(ツ)_/¯> <Cheers>" });
    await pick(wrap.id, "delete");
  });
  test("{selection} asks the core for the app in front's selected text, and takes the clipboard when nothing is selected", async () => {
    await pick("create", "save", { values: { name: "Quote", keyword: "", text: "> {selection}" } });
    const quote = (stored.get("snippets\0snippets") as { id: string; name: string }[]).find((x) => x.name === "Quote")!;
    expect(await pick(quote.id, "copy")).toEqual({ copy: "> the marked words" });
    expect(host.coreCalls.filter((c) => c.method === "selection.text")).toHaveLength(1);
    selected = null;
    expect(await pick(quote.id, "copy")).toEqual({ copy: `> ${fixtures.clipboard[0].text}` });
    await pick(quote.id, "delete");
  });
});
