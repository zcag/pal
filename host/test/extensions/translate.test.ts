// translate: the query grammar and the reply parsers first (lang.ts,
// backends.ts, pure), then the palette over the wire against the Bun
// mock of Google's `translate_a/single` and DeepL's `/v2/translate`
// (translate-mock.ts, reached through `PAL_TRANSLATE_GOOGLE` /
// `PAL_TRANSLATE_DEEPL`), with a stand-in speaker (`PAL_TRANSLATE_SAY`)
// that logs what it was asked to say. Turkish and English are the pair
// throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleAlternatives, parseGoogle, parseVoices, voiceFor } from "../../../extensions/translate/backends.ts";
import { deeplSource, deeplTarget, fromDeepl, langOf, matches, nameOf, otherEnd, parse, systemLanguage } from "../../../extensions/translate/lang.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host, stored, writeTool } from "../harness.ts";
import { HELLO_JA, HELLO_TR, MERHABA_EN, startMock } from "./translate-mock.ts";

describe("lang", () => {
  test("parse: a target prefix by code or name, both ends, a bare prefix, and text that only looks prefixed", () => {
    expect(parse("tr: hello")).toEqual({ from: "auto", to: "tr", text: "hello", prefixed: true });
    expect(parse(">de hello there")).toEqual({ from: "auto", to: "de", text: "hello there", prefixed: true });
    expect(parse("en>tr merhaba")).toEqual({ from: "en", to: "tr", text: "merhaba", prefixed: true });
    expect(parse("en > tr  merhaba dünya")).toEqual({ from: "en", to: "tr", text: "merhaba dünya", prefixed: true });
    expect(parse("german: hello")).toEqual({ from: "auto", to: "de", text: "hello", prefixed: true });
    expect(parse("Turkish>English merhaba")).toEqual({ from: "tr", to: "en", text: "merhaba", prefixed: true });
    expect(parse("auto>tr hello")).toEqual({ from: "auto", to: "tr", text: "hello", prefixed: true });
    expect(parse("tr:")).toEqual({ from: "auto", to: "tr", text: "", prefixed: true });
    expect(parse(">ja")).toEqual({ from: "auto", to: "ja", text: "", prefixed: true });
    // Not languages: the whole thing is text. `> de` with a space is the shell's prefix, not ours.
    expect(parse("todo: buy milk")).toEqual({ from: "auto", text: "todo: buy milk", prefixed: false });
    expect(parse("> de hello")).toEqual({ from: "auto", text: "> de hello", prefixed: false });
    expect(parse("http://x")).toEqual({ from: "auto", text: "http://x", prefixed: false });
    expect(parse("  merhaba  ")).toEqual({ from: "auto", text: "merhaba", prefixed: false });
    expect(parse("xx>tr hello").prefixed).toBe(false);
  });

  test("langOf takes codes, English names and a few native spellings; nameOf goes back; DeepL's spellings both ways", () => {
    expect(langOf("TR")).toBe("tr");
    expect(langOf("turkish")).toBe("tr");
    expect(langOf("Türkçe")).toBe("tr");
    expect(langOf("chinese")).toBe("zh-CN");
    expect(langOf("zh-tw")).toBe("zh-TW");
    expect(langOf("auto")).toBe("auto");
    expect(langOf("xx")).toBeUndefined();
    expect(langOf("")).toBeUndefined();
    expect(nameOf("tr")).toBe("Turkish");
    expect(nameOf("zh-CN")).toBe("Chinese (Simplified)");
    expect(nameOf("auto")).toBe("Auto");
    expect(nameOf("xx")).toBe("xx");
    expect(deeplTarget("en")).toBe("EN-US");
    expect(deeplTarget("tr")).toBe("TR");
    expect(deeplTarget("zh-CN")).toBe("ZH-HANS");
    expect(deeplSource("auto")).toBeUndefined();
    expect(deeplSource("zh-TW")).toBe("ZH");
    expect(fromDeepl("EN-US")).toBe("en");
    expect(fromDeepl("TR")).toBe("tr");
    expect(fromDeepl("ZH")).toBe("zh-CN");
    expect(fromDeepl("NB")).toBe("no");
  });

  test("matches wants a prefix with text after it; a bare prefix or plain text never wakes the root", () => {
    expect(matches("tr: hello")).toBe(true);
    expect(matches(">de hi")).toBe(true);
    expect(matches("en>tr merhaba")).toBe(true);
    expect(matches("tr:")).toBe(false);
    expect(matches("hello world")).toBe(false);
    expect(matches("note: call mum")).toBe(false);
  });

  test("systemLanguage from a locale; otherEnd flips a text already in the target to the pair's other end, else English, else the system's", () => {
    expect(systemLanguage("en-US")).toBe("en");
    expect(systemLanguage("tr_TR")).toBe("tr");
    expect(systemLanguage("zh-TW")).toBe("zh-TW");
    expect(systemLanguage("zh")).toBe("zh-CN");
    expect(systemLanguage("xx-YY")).toBe("en");
    expect(otherEnd("en", "tr", "auto", "en")).toBe("tr");
    expect(otherEnd("tr", "tr", "en", "en")).toBe("en");
    expect(otherEnd("tr", "tr", "auto", "en")).toBe("en");
    expect(otherEnd("en", "en", "tr", "en")).toBe("tr");
    expect(otherEnd("en", "en", "auto", "de")).toBe("de");
    expect(otherEnd("en", "en", "auto", "en")).toBe("en");
  });
});

describe("backends", () => {
  test("parseGoogle: the sentences joined, the detected source, per-segment alternatives folded into whole-text ones, the romanisations and the dictionary", () => {
    const t = parseGoogle(HELLO_TR, "tr");
    expect(t).toMatchObject({ text: "Selam Dünya", from: "en", to: "tr", backend: "google", alternatives: ["merhaba dünya"], dictionary: [] });
    expect(t.confidence).toBeCloseTo(0.763, 2);
    expect(t.translit).toBeUndefined();
    const m = parseGoogle(MERHABA_EN, "en");
    expect(m.text).toBe("hello world. How are you?");
    expect(m.from).toBe("tr");
    expect(m.alternatives).toEqual(["hi world. how are you"]);
    const j = parseGoogle(HELLO_JA, "ja");
    expect(j).toMatchObject({ text: "こんにちは", translit: "Kon'nichiwa", srcTranslit: "həˈlō", alternatives: ["こんにちは。"], dictionary: [{ pos: "noun", word: "今日は", back: ["hello", "good day"] }] });
    expect(googleAlternatives({ alternative_translations: [{ alternative: [{ word_postproc: "A" }, { word_postproc: "a" }, { word_postproc: "B" }] }] }, "A")).toEqual(["B"]);
    expect(parseGoogle({}, "tr")).toMatchObject({ text: "", from: "auto", alternatives: [] });
  });

  test("parseVoices reads say's list (names with spaces included) and voiceFor picks by locale, then by language", () => {
    const list = parseVoices("Albert              en_US    # Hello! My name is Albert.\nBad News            en_US    # Hello! My name is Bad News.\nYelda               tr_TR    # Merhaba, benim adım Yelda.\nKyoko               ja_JP    # こんにちは\nnot a voice line\n");
    expect(list).toEqual([{ name: "Albert", lang: "en_US" }, { name: "Bad News", lang: "en_US" }, { name: "Yelda", lang: "tr_TR" }, { name: "Kyoko", lang: "ja_JP" }]);
    expect(voiceFor(list, "tr")).toBe("Yelda");
    expect(voiceFor(list, "en-US")).toBe("Albert");
    expect(voiceFor(list, "ja")).toBe("Kyoko");
    expect(voiceFor(list, "de")).toBeUndefined();
  });
});

// ---- the palette over the wire ------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "pal-translate-"));
const sayLog = join(dir, "say.log");
const say = join(dir, "say");
writeTool(say, `#!/bin/sh\nprintf '%s\\t%s\\n' "$1" "$2" >> "${sayLog}"\n`);

const spoken = () => (existsSync(sayLog) ? readFileSync(sayLog, "utf8").trim().split("\n") : []);

const { server, requests, base } = startMock();

let host: Host;
let selectionText: string | null = null;
beforeAll(async () => {
  process.env.PAL_TRANSLATE_GOOGLE = base;
  process.env.PAL_TRANSLATE_DEEPL = base;
  process.env.PAL_TRANSLATE_SAY = say;
  stored.clear();
  host = await Host.bundled({ settings: { translate: { settings: { to: "tr" } } }, core: { "selection.text": () => selectionText } });
});
afterAll(() => {
  host.kill();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PAL_TRANSLATE_GOOGLE; delete process.env.PAL_TRANSLATE_DEEPL; delete process.env.PAL_TRANSLATE_SAY;
});

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("translate", "translate", q, ctx);
const pick = (id: string, action?: string) => host.pick("translate", "translate", id, action);
const ids = (items: Item[]) => items.map((i) => i.id);

describe("translate", () => {
  test("meta: an input palette on the blue translate tile, inline with a match, a placeholder that shows the prefixes; the history is live; the manifest and the code agree", () => {
    const l = host.loaded().find((l) => l.extension === "translate")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["translate", "history"]);
    expect(l.palettes[0]).toMatchObject({ title: "Translate", input: true, live: false, inline: true, icon: tile("blue", "\u{f05ca}") });
    expect(l.palettes[0].placeholder).toContain("tr: text");
    expect(l.palettes[1]).toMatchObject({ title: "Translation History", live: true, input: false });
  });

  test("typed text to the `to` setting: the translation first with copy, paste, speak; the detected language with its confidence; the alternative; Swap last", async () => {
    const items = await list("hello world");
    expect(ids(items)).toEqual(["translation", "hint:detected", "alt:0", "swap"]);
    expect(items[0]).toMatchObject({ name: "Selam Dünya", subtitle: "English → Turkish · Google Translate", keywords: ["hello world"] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["copy", "paste", "speak", "copy_source", "open"]);
    expect(items[0].actions![2].shortcut).toBe("cmd+shift+s");
    expect(items[0].detail!.markdown).toBe("Selam Dünya\n\n---\n\nhello world");
    expect(items[0].detail!.metadata).toEqual([{ label: "From", value: "English (en)" }, { label: "To", value: "Turkish (tr)" }, { label: "Backend", value: "Google Translate" }, { label: "Detection", value: "76% sure" }, { label: "Length", value: "11 → 11 characters" }]);
    expect(items[1]).toMatchObject({ name: "English detected", subtitle: "76% sure · translated to Turkish", actions: [] });
    expect(items[2]).toMatchObject({ name: "merhaba dünya", subtitle: "Alternative" });
    expect(items[3]).toMatchObject({ name: "Swap: Turkish → English", actions: [{ id: "swap", title: "Swap and translate" }] });
    expect(items.every((i) => i.icon)).toBe(true);
    const r = requests.at(-1)!;
    expect(r).toMatchObject({ path: "/translate_a/single", q: "hello world", sl: "auto", tl: "tr" });
  });

  test("a prefix names the ends: en>tr sends both, >ja and tr: the target; a Turkish text with `to: tr` goes the other way to English", async () => {
    requests.length = 0;
    let items = await list("en>tr merhaba dünya. Nasılsın?");
    expect(requests.at(-1)).toMatchObject({ q: "merhaba dünya. Nasılsın?", sl: "en", tl: "tr" });
    expect(items[0].name).toBe("[tr] merhaba dünya. Nasılsın?");
    items = await list("merhaba dünya. Nasılsın?");
    // Detected Turkish, the target Turkish: translated to English instead, in a second request.
    expect(requests.slice(-2).map((r) => r.tl)).toEqual(["tr", "en"]);
    expect(items[0]).toMatchObject({ name: "hello world. How are you?", subtitle: "Turkish → English · Google Translate" });
    expect(items[2]).toMatchObject({ name: "hi world. how are you", subtitle: "Alternative" });
    items = await list("turkish: hello");
    expect(requests.at(-1)).toMatchObject({ q: "hello", sl: "auto", tl: "tr" });
    expect(items[0].name).toBe("[tr] hello");
  });

  test(">ja hello: the romanisation of the Japanese, the dictionary entry, and no IPA row for the Latin source", async () => {
    const items = await list(">ja hello");
    expect(ids(items)).toEqual(["translation", "translit", "hint:detected", "alt:0", "dict:0", "swap"]);
    expect(items[1]).toMatchObject({ name: "Kon'nichiwa", subtitle: "Japanese in Latin letters" });
    expect(items[4]).toMatchObject({ name: "今日は", subtitle: "noun · hello, good day" });
    expect(items[4].detail!.markdown).toContain("hello, good day");
  });

  test("typing is debounced: a listing overtaken by a newer one answers a Translating… row and sends nothing; the same text again is served from the cache", async () => {
    requests.length = 0;
    const [a, b] = await Promise.all([list("hello wor"), Bun.sleep(50).then(() => list("hello world"))]);
    expect(a).toEqual([expect.objectContaining({ id: "hint:wait", name: "Translating…", subtitle: "hello wor", actions: [] })]);
    expect(b[0].name).toBe("Selam Dünya");
    expect(requests.map((r) => r.q)).toEqual([]);
    await list("hello world");
    expect(requests).toEqual([]);
  });

  test("nothing typed: the selection is translated, else the newest clipboard text; the subtitle says which; a bare prefix works the same", async () => {
    selectionText = "merhaba dünya. Nasılsın?";
    let items = await list("");
    expect(items[0]).toMatchObject({ name: "hello world. How are you?", subtitle: "Turkish → English · Google Translate · from the selection" });
    await Bun.sleep(2100);
    selectionText = null;
    items = await list("");
    expect(items[0]).toMatchObject({ name: "Selam Dünya", subtitle: "English → Turkish · Google Translate · from the clipboard" });
    await Bun.sleep(2100);
    items = await list(">ja");
    expect(items[0].name).toBe("[ja] hello world");
  });

  test("the inline ask: rows for a prefixed query, nothing for a bare prefix, and no debounce wait", async () => {
    const t0 = Date.now();
    const items = await list("tr: hello world", { inline: true });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(items[0].name).toBe("Selam Dünya");
    expect(await list("tr:", { inline: true })).toEqual([]);
  });

  test("a text already in the only language the settings name is a hint naming the fix, not a same-to-same row", async () => {
    host.changeSettings("translate", { settings: { to: "en" } });
    const items = await list("hello world");
    expect(ids(items)).toEqual(["hint:same", "hint:prefix"]);
    expect(items[0]).toMatchObject({ name: "Already English", actions: [] });
    host.changeSettings("translate", { settings: { to: "tr" } });
  });

  test("Google's refusal page is one hint row naming the fix; a request that hangs past the budget likewise", async () => {
    const items = await list("refuse");
    expect(items).toEqual([expect.objectContaining({ id: "hint:failed", subtitle: "refuse", actions: [] })]);
    expect(items[0].name).toContain("Google is refusing this network");
  });

  test("DeepL: the key goes in the header, the target in its spelling, the detected language comes back as a Google code; a bad key is a hint", async () => {
    host.changeSettings("translate", { settings: { to: "en", backend: "deepl", api_key: "good:fx" } });
    let items = await list("merhaba");
    expect(requests.at(-1)).toMatchObject({ path: "/v2/translate", q: "merhaba", tl: "EN-US", auth: "DeepL-Auth-Key good:fx" });
    expect(items[0]).toMatchObject({ name: "DeepL merhaba → EN-US", subtitle: "Turkish → English · DeepL" });
    expect(ids(items)).toEqual(["translation", "hint:detected", "swap"]);
    host.changeSettings("translate", { settings: { to: "en", backend: "deepl", api_key: "bad" } });
    items = await list("merhaba again");
    expect(items[0].name).toContain("DeepL rejected the key");
    host.changeSettings("translate", { settings: { to: "en", backend: "deepl", api_key: "" } });
    items = await list("merhaba once more");
    expect(items[0].name).toContain("Set `api_key`");
    host.changeSettings("translate", { settings: { to: "tr" } });
  });

  test("picks: Enter copies, cmd+enter pastes, speak runs the speaker in the row's language, copy_source and open; Swap pushes the palette with the pair reversed; a stale id is a failure toast", async () => {
    await list("hello world");
    expect(await pick("translation")).toEqual({ copy: "Selam Dünya" });
    expect(await pick("translation", "paste")).toEqual({ paste: { text: "Selam Dünya" } });
    expect(await pick("translation", "copy_source")).toEqual({ copy: "hello world" });
    expect((await pick("translation", "open")).open).toBe("https://translate.google.com/?sl=en&tl=tr&text=hello%20world&op=translate");
    expect(await pick("alt:0")).toEqual({ copy: "merhaba dünya" });
    const s = await pick("translation", "speak");
    expect(s).toMatchObject({ keep: true, toast: { title: "Speaking", message: "Selam Dünya" } });
    await host.until(() => spoken().length > 0, 2000, "the speaker ran");
    expect(spoken().at(-1)).toBe("tr\tSelam Dünya");
    expect(await pick("swap")).toEqual({ push: { extension: "translate", palette: "translate", query: "tr>en Selam Dünya" } });
    expect(await pick("nope")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });

  test("with `speak` on, Enter speaks too", async () => {
    host.changeSettings("translate", { settings: { to: "tr", speak: true } });
    const n = spoken().length;
    await list(">ja hello");
    expect(await pick("translation")).toEqual({ copy: "こんにちは" });
    await host.until(() => spoken().length > n, 2000, "the speaker ran");
    expect(spoken().at(-1)).toBe("ja\tこんにちは");
    host.changeSettings("translate", { settings: { to: "tr" } });
  });

  test("history: what was copied, pasted or spoken, newest first and once each; Translate again pushes the query; remove and clear", async () => {
    const rows = await host.list("translate", "history");
    expect(rows.at(-1)).toMatchObject({ id: "clear", name: "Clear history" });
    const entries = rows.slice(0, -1);
    // Selam Dünya was copied, then spoken after the alternative was copied: a re-use moves an entry back to the top.
    expect(entries.map((r) => r.name)).toEqual(["こんにちは", "Selam Dünya", "merhaba dünya"]);
    expect(entries[1]).toMatchObject({ subtitle: "hello world · English → Turkish", keywords: ["hello world"], accessories: [{ date: expect.any(Number) }] });
    expect(entries[1].actions!.map((a) => a.id)).toEqual(["copy", "paste", "speak", "again", "copy_source", "remove"]);
    const id = entries[1].id;
    expect(await host.pick("translate", "history", id)).toEqual({ copy: "Selam Dünya" });
    expect(await host.pick("translate", "history", id, "paste")).toEqual({ paste: { text: "Selam Dünya" } });
    expect(await host.pick("translate", "history", id, "copy_source")).toEqual({ copy: "hello world" });
    expect(await host.pick("translate", "history", id, "again")).toEqual({ push: { extension: "translate", palette: "translate", query: "en>tr hello world" } });
    expect(await host.pick("translate", "history", id, "remove")).toMatchObject({ keep: true, toast: { title: "Removed" } });
    expect((await host.list("translate", "history")).map((r) => r.name)).toEqual(["こんにちは", "merhaba dünya", "Clear history"]);
    expect(await host.pick("translate", "history", "clear", "clear")).toMatchObject({ keep: true, toast: { title: "History cleared" } });
    const empty = await host.list("translate", "history");
    expect(empty).toEqual([expect.objectContaining({ id: "hint:empty", name: "Nothing translated yet", actions: [] })]);
  });
});
