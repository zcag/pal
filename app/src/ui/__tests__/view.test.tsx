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

  it("draws a tile from the tokens: size, colour and fill as data, the type scaled to the box and the text, a sub line", () => {
    const html = render({
      type: "stack",
      children: [
        { type: "tile", width: 64, height: 64, text: "2048", color: "accent", fill: "solid" },
        { type: "tile", width: 64, height: 64, text: "2" },
        { type: "tile", width: 32, height: 40, text: "Q", color: "grey", fill: "soft" },
        { type: "tile", width: 56, height: 44, text: "42", sub: "played", color: "neutral", fill: "outline" },
        { type: "tile", width: 48, height: 48, color: "neutral", fill: "outline" },
      ],
    });
    expect(html).toContain('class="pal-view__node pal-view__tile" data-color="accent" data-fill="solid" style="width:64px;height:64px"><span class="pal-view__tile-text" style="font-size:21px;font-weight:800;letter-spacing:-0.02em">2048</span>');
    // The defaults: neutral, soft. A one-character text takes the tall size.
    expect(html).toContain('data-color="neutral" data-fill="soft" style="width:64px;height:64px"><span class="pal-view__tile-text" style="font-size:28px;font-weight:800;letter-spacing:-0.02em">2</span>');
    // A keycap-sized tile is marked small (the control radius) and its type is lighter.
    expect(html).toContain('data-color="grey" data-fill="soft" data-small="true" style="width:32px;height:40px"><span class="pal-view__tile-text" style="font-size:18px;font-weight:700">Q</span>');
    expect(html).toContain('<span class="pal-view__tile-sub">played</span>');
    // An empty tile is a box and nothing else.
    expect(html).toContain('data-color="neutral" data-fill="outline" style="width:48px;height:48px"></div>');
  });

  it("paints a stack's surface and radius, sizes a text, colours a progress bar", () => {
    const html = render({
      type: "stack", surface: "sunken", radius: true, padding: 2,
      children: [
        { type: "stack", surface: "elevated", children: [] },
        { type: "text", value: "6", width: 8, align: "end" },
        { type: "text", value: "label", minWidth: 40 },
        { type: "progress", value: 0.5, color: "grey", width: 96 },
      ],
    });
    expect(html).toContain('data-surface="sunken" data-radius="true" style="padding:var(--pal-space-2)"');
    expect(html).toContain('data-surface="elevated"');
    expect(html).toContain('class="pal-view__node pal-view__text" data-align="end" style="flex:none;width:8px">6<');
    expect(html).toContain('style="min-width:40px">label<');
    expect(html).toContain('role="progressbar" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100" data-color="grey" style="flex:none;width:96px"');
  });

  it("carries the new entrances (the slides, pop) as data-enter; a move node needs no data of its own", () => {
    const html = render({
      type: "stack",
      children: [
        { type: "text", key: "a", value: "a", transition: { enter: "slide-left" } },
        { type: "text", key: "b", value: "b", transition: { enter: "pop", move: true } },
        { type: "text", key: "c", value: "c", transition: { enter: "slide-down" } },
      ],
    });
    expect(html).toContain('data-enter="slide-left"');
    expect(html).toContain('data-enter="pop"');
    expect(html).toContain('data-enter="slide-down"');
    expect(html).not.toContain("move");
  });

  it("stringifies loosely typed values instead of throwing", () => {
    const html = render({ type: "stack", children: [{ type: "text", value: 12 as unknown as string }, { type: "badge", text: undefined as unknown as string }, { type: "stack", children: "no" as unknown as ViewNode[] }] });
    expect(html).toContain(">12<");
    expect(html).toContain('class="pal-tag pal-view__node"></span>');
  });
});
