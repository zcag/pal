import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { View } from "../View";
import type { ViewNode } from "../types";

const render = (tree: ViewNode) => renderToStaticMarkup(<View tree={tree} label="Table" />);

describe("View", () => {
  it("renders every primitive with its role or class from the tokens", () => {
    const html = render({
      type: "stack", direction: "row", gap: 2, padding: 4, align: "center", justify: "between", grow: true, minHeight: 80,
      children: [
        { type: "text", value: "Dealer", style: "muted", size: "xs", weight: "medium", color: "amber" },
        { type: "image", src: "data:image/svg+xml,%3Csvg%3E", width: 56, height: 80, mask: "rounded", alt: "AS" },
        { type: "badge", text: "17", color: "blue" },
        { type: "divider" },
        { type: "spacer" },
        { type: "spacer", size: 8 },
        { type: "progress", value: 0.4 },
        { type: "keycap", keys: "cmd+k" },
      ],
    });
    expect(html).toContain('class="pal-view" role="document" aria-label="Table"');
    expect(html).toContain('class="pal-view__node pal-view__stack" data-direction="row" data-align="center" data-justify="between" data-grow="true"');
    expect(html).toContain("gap:var(--pal-space-2);padding:var(--pal-space-4);min-height:80px");
    expect(html).toContain('class="pal-view__node pal-view__text" data-style="muted" data-weight="medium" data-size="xs" data-color="amber">Dealer<');
    expect(html).toContain('<img class="pal-view__node pal-view__image" src="data:image/svg+xml,%3Csvg%3E" width="56" height="80" data-mask="rounded" alt="AS"');
    expect(html).toContain('class="pal-tag pal-view__node" data-color="blue"');
    expect(html).toContain('<hr class="pal-view__node pal-view__divider"/>');
    expect(html).toContain('class="pal-view__node pal-view__spacer" aria-hidden="true"');
    expect(html).toContain("flex:none;width:8px;height:8px");
    expect(html).toContain('role="progressbar" aria-valuenow="40"');
    expect(html).toContain('style="width:40%"');
    // No navigator in node: the non-mac spelling.
    expect(html).toContain('class="pal-kbd pal-view__node" aria-label="cmd+k"><kbd>Ctrl</kbd><kbd>K</kbd>');
  });

  it("skips an unknown node type and an image with a source it may not load, and clamps a progress value", () => {
    const html = render({
      type: "stack",
      children: [
        { type: "hologram" } as unknown as ViewNode,
        { type: "image", src: "https://example.com/x.png" },
        { type: "image", src: "file:///etc/passwd" },
        { type: "progress", value: 7 },
        { type: "text", value: "still here" },
      ],
    });
    expect(html).not.toContain("hologram");
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("still here");
  });

  it("carries a transition as data-enter with a staggered delay in steps of the fast duration, capped", () => {
    const html = render({
      type: "stack",
      children: [
        { type: "image", key: "a", src: "icon://localhost/app?path=x", transition: { enter: "slide-up", delay: 2 } },
        { type: "text", key: "b", value: "flip", transition: { enter: "flip", delay: 40 } },
      ],
    });
    expect(html).toContain('data-enter="slide-up" style="animation-delay:calc(var(--pal-dur-fast, 80ms) * 2)"');
    expect(html).toContain('data-enter="flip" style="animation-delay:calc(var(--pal-dur-fast, 80ms) * 8)"');
    // Keyed children sit under the presence wrapper (box-less), so their exit can run later.
    expect(html.match(/display:contents/g)).toHaveLength(2);
  });

  it("stringifies loosely typed values instead of throwing", () => {
    const html = render({ type: "stack", children: [{ type: "text", value: 12 as unknown as string }, { type: "badge", text: undefined as unknown as string }, { type: "stack", children: "no" as unknown as ViewNode[] }] });
    expect(html).toContain(">12<");
    expect(html).toContain('class="pal-tag pal-view__node"></span>');
  });
});
