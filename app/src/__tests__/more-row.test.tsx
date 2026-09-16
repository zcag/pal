import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Row pulls in icons.ts, which reads `window` at import; no DOM is needed here.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Row } from "../ui/Row";
import { toItem, type WireHit } from "../items";

// The core's row after a capped section (`more_row` in src-tauri/src/index.rs).
const more: WireHit = { source: { extension: "emoji", palette: "emoji" }, id: "pal:more", score: 0, name_positions: [], item: { id: "pal:more", name: "12 more in Emoji", icon: "›", more: true } };

describe("the N more row", () => {
  it("is muted, addressed to its palette, and a plain row otherwise", () => {
    const item = toItem(more, { title: "Emoji" });
    expect(item.muted).toBe(true);
    expect(item.palette).toBe("emoji/emoji");
    expect(item.disabled).toBeUndefined();
    expect(toItem({ ...more, item: { id: "x", name: "x" } }, { title: "Emoji" }).muted).toBeUndefined();
    const html = renderToStaticMarkup(<Row item={item} />);
    expect(html).toContain('data-muted="true"');
    expect(html).not.toContain("data-disabled");
    expect(html).toContain("12 more in Emoji");
  });
});
