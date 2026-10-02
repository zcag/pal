import { describe, expect, it, vi } from "vitest";

// Glance pulls in Icon, whose icons.ts reads `window` at import; no DOM is needed here.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { glanceText } from "../Glance";

describe("a glance card's words", () => {
  it("leads with the item's title, else its count, else its tooltip's first line; the tooltip under it when it says more", () => {
    expect(glanceText({ title: "Weekly sync in 13m", tooltip: "Weekly sync, 14:45 – 15:15\nWork" })).toEqual({ value: "Weekly sync in 13m", sub: "Weekly sync, 14:45 – 15:15" });
    expect(glanceText({ count: 31, tooltip: "31 unread" })).toEqual({ value: "31", sub: "31 unread" });
    expect(glanceText({ tooltip: "Partly cloudy" })).toEqual({ value: "Partly cloudy", sub: undefined });
    expect(glanceText({})).toEqual({ value: "", sub: undefined });
  });
});
