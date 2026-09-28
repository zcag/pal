// @vitest-environment happy-dom
// The strips the gallery and the Settings preview draw against the real
// renderers: `bar-parity.json` is what menubar.rs and sketchybar.rs draw for
// every fixture item and manifest mock (app/src-tauri/src/bar/parity.rs
// writes it), and bar-model.ts must say the same (docs/design/screenshots.md,
// "Parity"). A failure here after a renderer change: make bar-model.ts (and
// BarStrip.tsx) draw what the Rust now does.
import { describe, expect, test } from "vitest";
import snapshot from "./bar-parity.json";
import { defaultLook, type BarStripItem } from "../BarStrip";
import { describeMenubar, describeSketchy, shapeItem } from "../bar-model";
import { lookOf, resolveLook } from "../SettingsTypes";

type Case = { name: string; look: string; look_file: Record<string, unknown>; item: BarStripItem; dark: { menubar: unknown; sketchybar: unknown }; light: { menubar: unknown; sketchybar: unknown } };
const cases = (snapshot as { cases: Case[] }).cases;

describe("strip parity with the renderers", () => {
  test("the snapshot covers the fixtures and the mocks", () => {
    expect(cases.length).toBeGreaterThan(100);
  });
  for (const c of cases) {
    test(`${c.name} (${c.look})`, () => {
      const look = resolveLook(defaultLook, lookOf(c.look_file));
      const item = shapeItem(c.item, look);
      for (const theme of ["dark", "light"] as const) {
        expect({ theme, menubar: describeMenubar(item, look, theme === "dark") }).toEqual({ theme, menubar: c[theme].menubar });
        expect({ theme, sketchybar: describeSketchy(item, look, theme === "dark") }).toEqual({ theme, sketchybar: c[theme].sketchybar });
      }
    });
  }
});
