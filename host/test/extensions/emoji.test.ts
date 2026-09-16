// emoji: the bundled data.json as a grid.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

describe("emoji", () => {
  test("meta: a grid with the palette setting's columns", () => {
    const l = host.loaded().find((l) => l.extension === "emoji")!;
    expect(l.palettes).toEqual([{ name: "emoji", title: "Emoji", live: false, input: false, icon: "😀", view: "grid", columns: 10 }]);
  });

  test("1906 rows; the grinning face has its shortcode name and keywords", async () => {
    const items = await host.list("emoji", "emoji");
    expect(items).toHaveLength(1906);
    const grin = items.find((i) => i.id === "😀")!;
    expect(grin.name).toBe("grinning face");
    expect(grin.icon).toBe("😀");
    expect(grin.keywords).toContain("smile");
    expect(grin.keywords![0]).toBe("grinning_face");
    expect(grin.actions).toEqual([{ id: "copy", title: "Copy emoji" }, { id: "shortcode", title: "Copy shortcode", shortcut: "cmd+shift+c" }]);
    expect(new Set(items.map((i) => i.id)).size).toBe(1906);
  });

  test("pick copies the glyph, or its :shortcode:", async () => {
    expect(await host.pick("emoji", "emoji", "😀")).toEqual({ copy: "😀" });
    expect(await host.pick("emoji", "emoji", "😀", "copy")).toEqual({ copy: "😀" });
    expect(await host.pick("emoji", "emoji", "😀", "shortcode")).toEqual({ copy: ":grinning_face:" });
    expect(await host.pick("emoji", "emoji", "not-an-emoji", "shortcode")).toEqual({ copy: "not-an-emoji" });
  });
});

describe("emoji columns setting", () => {
  test("is read at load from [palettes.emoji]", async () => {
    const h = await Host.bundled({ settings: { emoji: { palettes: { emoji: { columns: 6 } } } } });
    expect(h.loaded().find((l) => l.extension === "emoji")!.palettes[0].columns).toBe(6);
    h.kill();
  });
});
