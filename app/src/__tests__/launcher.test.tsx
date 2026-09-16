import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The UI kit reads `window` at import; static markup needs no DOM beyond that.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Launcher } from "../Launcher";
import type { SourceInfo } from "../items";

const source = (extension: string, palette: string, stale: boolean, input = false): SourceInfo =>
  ({ extension, palette, title: palette, live: false, input, count: input ? 0 : 3, stale });

const markup = (sources: SourceInfo[]) =>
  renderToStaticMarkup(<Launcher sources={sources} search={async () => []} onPick={() => {}} onHide={() => {}} onRefresh={() => {}} />);

describe("Launcher staleness", () => {
  it("says updating and runs the sweep while a listing is pending at the root", () => {
    const html = markup([source("pal", "palettes", false), source("apps", "apps", false), source("scripts", "prs", true)]);
    expect(html).toContain('class="pal-footer__note"');
    expect(html).toContain("updating…");
    expect(html).toContain("data-loading");
  });
  it("is quiet once every indexed palette has a fresh listing", () => {
    // An input palette (its rows come per keystroke) never counts.
    const html = markup([source("pal", "palettes", false), source("apps", "apps", false), source("calc", "calc", true, true)]);
    expect(html).not.toContain("updating…");
    expect(html).not.toContain("data-loading");
  });
});

describe("Launcher welcome source", () => {
  it("keeps the tips out of the count, and the root has no scope dropdown", () => {
    const html = markup([source("pal", "welcome", false), source("pal", "palettes", false), source("apps", "apps", false)]);
    expect(html).not.toContain("<select");
    expect(html).toContain("0 of 3");
  });
});
