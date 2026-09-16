// emoji: the bundled data.json as a grid, sections by category after the
// recents the harness's storage holds, the skin tone and paste settings.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { withSkinTone } from "../../../extensions/emoji/skin.ts";
import { Host, stored } from "../harness.ts";

let host: Host;
beforeAll(async () => {
  stored.clear();
  stored.set("emoji\0recent", ["🍕", "👍", "not-an-emoji"]);
  host = await Host.bundled();
});
afterAll(() => host.kill());

const list = () => host.list("emoji", "emoji");
const pick = (id: string, action?: string) => host.pick("emoji", "emoji", id, action);

describe("skin tone", () => {
  test("the modifier after the first code point, a text-style selector dropped; none or an unmodifiable emoji unchanged", () => {
    expect(withSkinTone("👍", "medium", true)).toBe("👍🏽");
    expect(withSkinTone("✌️", "dark", true)).toBe("✌🏿");
    expect(withSkinTone("👨‍💻", "light", true)).toBe("👨🏻‍💻");
    expect(withSkinTone("👍", "none", true)).toBe("👍");
    expect(withSkinTone("🍕", "medium", false)).toBe("🍕");
  });
});

describe("emoji", () => {
  test("meta: a live grid with a ttl and the palette setting's columns", () => {
    const l = host.loaded().find((l) => l.extension === "emoji")!;
    expect(l.palettes).toEqual([{ name: "emoji", title: "Emoji", live: true, input: false, icon: tile("amber", "\u{f0c71}"), view: "grid", placeholder: "Name, keyword or :shortcode:", columns: 10, ttl: 30, tier: "catalog" }]);
    expect(l.manifest.settings?.map((s) => s.id)).toEqual(["skin_tone", "paste_by_default"]);
  });

  test("1906 rows: the recents first in their own section (unknown ones dropped), then Unicode's categories in order; shortcode name, :shortcode: and keywords", async () => {
    const items = await list();
    expect(items).toHaveLength(1906);
    expect(items.slice(0, 2).map((i) => [i.id, i.section])).toEqual([["🍕", "Recently used"], ["👍", "Recently used"]]);
    expect(items[2].section).toBe("Smileys & Emotion");
    expect([...new Set(items.map((i) => i.section))]).toEqual(["Recently used", "Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"]);
    const grin = items.find((i) => i.id === "😀")!;
    expect(grin.name).toBe("grinning face");
    expect(grin.icon).toBe("😀");
    expect(grin.keywords!.slice(0, 2)).toEqual(["grinning_face", ":grinning_face:"]);
    expect(grin.keywords).toContain("smile");
    expect(grin.actions).toEqual([{ id: "copy", title: "Copy emoji" }, { id: "paste", title: "Paste emoji" }, { id: "shortcode", title: "Copy shortcode", shortcut: "cmd+shift+c" }]);
    expect(new Set(items.map((i) => i.id)).size).toBe(1906);
  });

  test("pick copies the glyph, or its :shortcode:; a copy or paste moves the emoji to the front of the recents", async () => {
    expect(await pick("😀")).toEqual({ copy: "😀" });
    expect(stored.get("emoji\0recent")).toEqual(["😀", "🍕", "👍"]);
    expect(await pick("👍", "copy")).toEqual({ copy: "👍" });
    expect(stored.get("emoji\0recent")).toEqual(["👍", "😀", "🍕"]);
    expect(await pick("😀", "paste")).toEqual({ paste: { text: "😀" } });
    expect(await pick("😀", "shortcode")).toEqual({ copy: ":grinning_face:" });
    expect(await pick("not-an-emoji", "shortcode")).toEqual({ copy: "not-an-emoji" });
    expect((await list()).slice(0, 3).map((i) => i.id)).toEqual(["😀", "👍", "🍕"]);
  });

  test("skin_tone tones the tile and what is copied for the emoji that take one; paste_by_default puts Paste first", async () => {
    host.changeSettings("emoji", { settings: { skin_tone: "medium", paste_by_default: true } });
    const items = await list();
    const thumbs = items.find((i) => i.id === "👍")!;
    expect(thumbs.icon).toBe("👍🏽");
    expect(thumbs.actions!.map((a) => a.id)).toEqual(["paste", "copy", "shortcode"]);
    expect(items.find((i) => i.id === "🍕")!.icon).toBe("🍕");
    expect(await pick("👍", "paste")).toEqual({ paste: { text: "👍🏽" } });
    expect(await pick("👍", "copy")).toEqual({ copy: "👍🏽" });
    expect(await pick("👍", "shortcode")).toEqual({ copy: ":thumbs_up:" });
    host.changeSettings("emoji", {});
    expect((await list()).find((i) => i.id === "👍")!.icon).toBe("👍");
  });
});

describe("emoji columns setting", () => {
  test("is read at load from [palettes.emoji]", async () => {
    const h = await Host.bundled({ settings: { emoji: { palettes: { emoji: { columns: 6 } } } } });
    expect(h.loaded().find((l) => l.extension === "emoji")!.palettes[0].columns).toBe(6);
    h.kill();
  });
});
