// icons.ts: freedesktop icon names to the bundled symbols font.
import { describe, expect, test } from "bun:test";
import { XDG_ICONS, xdg } from "../src/icons.ts";

describe("xdg", () => {
  test("a standard name maps to one private-use codepoint", () => {
    const g = xdg("dialog-error")!;
    expect(g).toBe("\u{f0029}");
    expect([...g]).toHaveLength(1);
    expect(g.codePointAt(0)!).toBeGreaterThanOrEqual(0xf0000);
  });
  test("case and the -symbolic suffix do not matter", () => {
    expect(xdg("Dialog-Error")).toBe(xdg("dialog-error"));
    expect(xdg("folder-symbolic")).toBe(xdg("folder"));
    expect(xdg("  home ")).toBe(xdg("home"));
  });
  test("unknown or non-string names give undefined", () => {
    expect(xdg("no-such-icon")).toBeUndefined();
    expect(xdg(undefined)).toBeUndefined();
    expect(xdg(3)).toBeUndefined();
  });
  test("every entry is a single supplementary private-use glyph", () => {
    for (const [name, g] of Object.entries(XDG_ICONS)) {
      expect([...g], name).toHaveLength(1);
      const cp = g.codePointAt(0)!;
      expect(cp >= 0xf0000 && cp <= 0x10fffd, name).toBe(true);
    }
  });
});
