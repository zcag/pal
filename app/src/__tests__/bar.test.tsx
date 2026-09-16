import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Launcher, menuLevel } from "../Launcher";
import { SUBMENU, menuKind, menuRows, type BarMenuNode } from "../bar";

const nodes: BarMenuNode[] = [
  { type: "section", title: "Unread", children: [{ type: "item", id: "t1", title: "Fix the build", subtitle: "zcag/pal", icon: "\u{f09b}" }, { type: "item", id: "t2", title: "Review", disabled: true }] },
  { type: "separator" },
  { type: "item", id: "open", title: "Open Notifications" },
  { type: "item", id: "read-all", title: "Mark all as read", shortcut: "cmd+shift+r", checked: true, action: "read", style: "destructive" },
  { type: "submenu", title: "More", children: [{ type: "item", id: "settings", title: "Settings" }] },
];

describe("menu level rows", () => {
  it("flattens sections, keeps shortcuts, ticks, disabled and submenus, drops separators", () => {
    const { rows, submenus } = menuRows("github/notifications", nodes);
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "open", "read-all", "submenu:0"]);
    expect(rows[0].section).toBe("Unread");
    expect(rows[0].palette).toBe("github/notifications");
    expect(rows[0].source).toBeUndefined();
    expect(rows[0].actions).toEqual([{ id: "t1", title: "Fix the build", shortcut: undefined, style: undefined }]);
    expect(rows[1].disabled).toBe(true);
    expect(rows[2].section).toBeUndefined();
    expect(rows[3].actions![0]).toEqual({ id: "read", title: "Mark all as read", shortcut: "cmd+shift+r", style: "destructive" });
    expect(rows[3].accessories).toEqual([{ text: "✓" }, { keys: "cmd+shift+r" }]);
    expect(rows[4].actions![0].id).toBe(SUBMENU);
    expect(submenus["submenu:0"]).toHaveLength(1);
  });
  it("tells the three menu forms apart", () => {
    expect(menuKind(nodes)).toBe("nodes");
    expect(menuKind({ palette: "apps" })).toBe("palette");
    expect(menuKind({ view: { tree: { type: "text", value: "x" }, actions: [] } })).toBe("view");
    expect(menuKind(null)).toBe("none");
    expect(menuKind(undefined)).toBe("none");
  });
});

describe("Launcher on a menu level", () => {
  it("starts on the item's rows with a static crumb and no back button at the bottom level", () => {
    // Static markup has no scroll element, so the virtualised list draws no rows; the footer shows the first row is under the cursor.
    const html = renderToStaticMarkup(<Launcher sources={[]} search={async () => []} start={menuLevel("github/notifications", "Notifications", nodes)} onPick={() => {}} onHide={() => {}} />);
    expect(html).toContain('class="pal-footer__title">Fix the build<');
    expect(html).toContain('class="pal-search__back" data-static=""');
    expect(html).not.toContain("Back from");
    expect(html).toContain("Search Notifications…");
    expect(html).toContain('style="height:');
  });
});
