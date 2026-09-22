// turkish: the conversions first (turkish.ts: the deasciifier on sentences
// and on the classic ambiguous words the pattern table decides by context,
// asciify, the Turkish cases with their dotted and dotless i, title case
// over apostrophes), then the palette over the wire: five rows for a typed
// text with their changes counted, the selection then the clipboard when
// nothing is typed, Enter pasting and cmd+c copying, the links with and
// without a text.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asciify, changed, CONVERSIONS, convert, deasciify, lower, title, upper } from "../../../extensions/turkish/turkish.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Effect } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";

describe("turkish.ts", () => {
  test("deasciify restores the letters from context: sentences", async () => {
    for (const [ascii, tr] of [
      ["Turkce yazilmis bir cumle", "Türkçe yazılmış bir cümle"],
      ["Bugun hava cok guzel, disari cikip yuruyus yapalim mi?", "Bugün hava çok güzel, dışarı çıkıp yürüyüş yapalım mı?"],
      ["Istanbul'da yasiyorum ve Kadikoy'de calisiyorum", "İstanbul'da yaşıyorum ve Kadıköy'de çalışıyorum"],
      ["Ogretmen ogrencilere odev verdi", "Öğretmen öğrencilere ödev verdi"],
      ["Gunaydin! Nasilsin? Iyi misin?", "Günaydın! Nasılsın? İyi misin?"],
      ["Dun gece ruzgar cok siddetliydi", "Dün gece rüzgar çok şiddetliydi"],
      ["Ilk once suyu kaynatin, sonra caylari ekleyin.", "İlk önce suyu kaynatın, sonra çayları ekleyin."],
    ]) expect(await deasciify(ascii)).toBe(tr);
    expect(await deasciify("")).toBe("");
    // Already Turkish stays as it is.
    expect(await deasciify("Türkçe yazılmış bir cümle")).toBe("Türkçe yazılmış bir cümle");
  });

  test("the classic ambiguous words the table decides: sik, kus, acik, yas, and their sentences", async () => {
    expect(await deasciify("sik")).toBe("sık");
    expect(await deasciify("Sik sik gorusuruz")).toBe("Sık sık görüşürüz");
    expect(await deasciify("sikinti")).toBe("sıkıntı");
    expect(await deasciify("kus")).toBe("kuş");
    expect(await deasciify("Kus ucar, kis gelir")).toBe("Kuş uçar, kış gelir");
    expect(await deasciify("kuslar")).toBe("kuşlar");
    expect(await deasciify("acik")).toBe("açık");
    expect(await deasciify("Acik kapi, acik hava, acik sozlu")).toBe("Açık kapı, açık hava, açık sözlü");
    expect(await deasciify("yas")).toBe("yaş");
    expect(await deasciify("Yas otuz bes, yolun yarisi eder")).toBe("Yaş otuz beş, yolun yarısı eder");
    expect(await deasciify("yasli adam")).toBe("yaşlı adam");
  });

  test("asciify is the reverse table; the cases keep i and ı apart; title case capitalises words and leaves a suffix after an apostrophe down", () => {
    expect(asciify("Türkçe yazılmış bir cümle, İstanbul'da ÇĞIÖŞÜ")).toBe("Turkce yazilmis bir cumle, Istanbul'da CGIOSU");
    expect(upper("istanbul ılık")).toBe("İSTANBUL ILIK");
    expect(lower("İSTANBUL ILIK")).toBe("istanbul ılık");
    expect(title("İSTANBUL'DA yaşıyorum, kadıköy'de çalışıyorum")).toBe("İstanbul'da Yaşıyorum, Kadıköy'de Çalışıyorum");
    expect(title("ılık bir gün (öğlen) “merhaba”")).toBe("Ilık Bir Gün (Öğlen) “Merhaba”");
    expect(changed("Turkce", "Türkçe")).toBe(2);
    expect(changed("abc", "abc")).toBe(0);
    expect(changed("ab", "abc")).toBe(3);
    expect(CONVERSIONS).toEqual(["deasciify", "asciify", "upper", "lower", "title"]);
  });

  test("convert by name", async () => {
    expect(await convert("deasciify", "cok guzel")).toBe("çok güzel");
    expect(await convert("asciify", "çok güzel")).toBe("cok guzel");
    expect(await convert("upper", "çok güzel")).toBe("ÇOK GÜZEL");
    expect(await convert("lower", "ÇOK GÜZEL")).toBe("çok güzel");
    expect(await convert("title", "çok güzel")).toBe("Çok Güzel");
  });
});

// ---- the palette over the wire ------------------------------------------------------

let host: Host;
let selectionText: string | null = null;
beforeAll(async () => {
  stored.clear();
  host = await Host.bundled({ core: { "selection.text": () => selectionText } });
});
afterAll(() => host.kill());

const list = (q?: string) => host.list("turkish", "turkish", q);
const pick = (id: string, action?: string) => host.pick("turkish", "turkish", id, action);
const link = (route: string, params: Record<string, unknown> = {}) => host.request<Effect>("link", { extension: "turkish", route, params });

describe("turkish", () => {
  test("meta: an input palette on the red tile, five links, no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "turkish")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "turkish", title: "Turkish", input: true, live: false, icon: tile("red", "\u{f0b34}"), keywords: ["deasciify", "asciify", "türkçe", "turkce"] });
    expect(Object.keys(l.manifest.links!)).toEqual(["deasciify", "asciify", "upper", "lower", "title"]);
  });

  test("a typed text: the five conversions as rows with what changed, Enter pastes, cmd+c copies, the source copies, Translate takes the row", async () => {
    const rows = await list("Turkce yazilmis bir cumle");
    expect(rows.map((r) => [r.id, r.name])).toEqual([
      ["deasciify", "Türkçe yazılmış bir cümle"],
      ["asciify", "Turkce yazilmis bir cumle"],
      ["upper", "TURKCE YAZİLMİS BİR CUMLE"],
      ["lower", "turkce yazilmis bir cumle"],
      ["title", "Turkce Yazilmis Bir Cumle"],
    ]);
    expect(rows[0].subtitle).toBe("Deasciified · Turkish letters restored: Turkce → Türkçe");
    expect(rows[0].accessories).toEqual([{ text: "6 changed" }]);
    expect(rows[1].accessories).toEqual([{ tag: "unchanged", color: "grey" }]);
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["paste", "copy", "translate", "copy-source"]);
    expect(rows[0].detail!.metadata).toEqual(expect.arrayContaining([{ label: "Changed", value: "6 characters" }, { label: "Source", value: "Typed" }]));
    expect(await pick("deasciify")).toEqual({ paste: { text: "Türkçe yazılmış bir cümle" } });
    expect(await pick("deasciify", "copy")).toEqual({ copy: "Türkçe yazılmış bir cümle" });
    expect(await pick("upper", "copy-source")).toEqual({ copy: "Turkce yazilmis bir cumle" });
    expect(await pick("deasciify", "translate")).toEqual({ push: { extension: "translate", palette: "translate", query: "Türkçe yazılmış bir cümle" } });
    expect(await pick("nope")).toMatchObject({ keep: true, toast: { title: "The rows changed" } });
  });

  test("nothing typed: the selection when there is one (Enter replaces it), else the clipboard's newest text, else three hints", async () => {
    selectionText = "cok sicak";
    let rows = await list("");
    expect(rows[0].name).toBe("çok sıcak");
    expect(rows[0].subtitle).toContain("from the selection, Enter replaces it");
    expect(rows[0].detail!.metadata).toContainEqual({ label: "Source", value: "The selection in the app in front" });
    expect(await pick("deasciify")).toEqual({ paste: { text: "çok sıcak" } });
    selectionText = null;
    await Bun.sleep(2100);
    rows = await list("");
    expect(rows[0].name).toBe("hello world");
    expect(rows[0].subtitle).toContain("from the clipboard");
    expect(rows[2].name).toBe("HELLO WORLD");
    host.changeSettings("turkish", { settings: { primary_action: "copy" } });
    rows = await list("kus");
    expect(rows[0].actions![0].id).toBe("copy");
    expect(await pick("deasciify")).toEqual({ copy: "kuş" });
    host.changeSettings("turkish", { settings: {} });
  });

  test("the links: a given text is copied (or pasted on request), no text takes the selection and pastes over it, a route that is not a conversion is refused", async () => {
    expect(await link("deasciify", { text: "Turkce" })).toEqual({ copy: "Türkçe", hud: "Deasciified, copied" });
    expect(await link("asciify", { text: "Türkçe", paste: true })).toEqual({ paste: { text: "Turkce" } });
    expect(await link("upper", { text: "istanbul" })).toEqual({ copy: "İSTANBUL", hud: "UPPERCASE, copied" });
    expect(await link("lower", { text: "ISTANBUL" })).toEqual({ copy: "ıstanbul", hud: "lowercase, copied" });
    expect(await link("title", { text: "istanbul'da" })).toEqual({ copy: "İstanbul'da", hud: "Title Case, copied" });
    await Bun.sleep(2100);
    selectionText = "acik kapi";
    expect(await link("deasciify")).toEqual({ paste: { text: "açık kapı" } });
    expect(await link("deasciify", { paste: false })).toEqual({ copy: "açık kapı", hud: "Deasciified, copied" });
    await expect(link("nope", {})).rejects.toThrow("no route turkish/nope");
  });
});
