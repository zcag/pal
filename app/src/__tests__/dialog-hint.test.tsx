// @vitest-environment happy-dom
// The empty root's "Dialog" hint (Launcher `dialogHit`): shown while the
// `dialog` prop answers a panel and Files is loaded, first among the
// suggestions, Enter opens Files with nothing picked; gone with no panel.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, dialogHit, type DialogInfo, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Hit } from "../ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (extension: string, palette: string, title: string, more: Partial<SourceInfo> = {}): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 1, stale: false, ...more });
const SOURCES = [src("pal", "palettes", "Palettes"), src("files", "files", "Files", { input: true, dialog: true }), src("apps", "apps", "Applications")];
let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: string[] = [];
let panel: DialogInfo | null = null;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const search = async (q: string, scope?: SourceInfo): Promise<Hit[]> => (scope || q ? [] : [{ item: { id: "slack", name: "Slack", palette: "apps/apps", source: { extension: "apps", palette: "apps" } } }]);
const suggest = async (): Promise<Hit[]> => [{ item: { id: "ev", name: "Standup", palette: "calendar/today", group: "Now", source: { extension: "calendar", palette: "today" } } }];
const mount = async () => {
  await act(async () => { root.render(<Launcher ref={launcher} sources={SOURCES} search={search} suggest={suggest} dialog={async () => panel} onPick={(i) => { picks.push(i.id); }} onHide={() => {}} />); });
  await flush();
};
beforeEach(() => {
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0;
  HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const key = (k: string) => act(() => { (document.activeElement ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
const sections = () => [...el.querySelectorAll(".pal-section__title")].map((s) => s.textContent);
const rowNames = () => [...el.querySelectorAll(".pal-row__title")].map((r) => r.textContent);

describe("dialog hint", () => {
  it("leads the empty root while a panel is up; Enter opens Files without a pick", async () => {
    panel = { app: "TextEdit", pid: 7, kind: "open" };
    await mount();
    expect(sections()).toEqual(["Dialog", "Now", "Applications"]);
    expect(rowNames()[0]).toBe("Type a path for the open panel of TextEdit");
    await key("Enter"); await flush();
    expect(el.querySelector(".pal-search__crumb")?.textContent).toBe("Files");
    expect(picks).toEqual([]);
  });
  it("is absent without a palette that serves dialogs", async () => {
    panel = { app: "TextEdit", pid: 7, kind: "open" };
    await act(async () => { root.render(<Launcher ref={launcher} sources={SOURCES.map((s) => ({ ...s, dialog: undefined }))} search={search} suggest={suggest} dialog={async () => panel} onPick={() => {}} onHide={() => {}} />); });
    await flush();
    expect(sections()).toEqual(["Now", "Applications"]);
  });
  it("is absent with no panel; the row is a push into the dialog palette", async () => {
    panel = null;
    await mount();
    expect(sections()).toEqual(["Now", "Applications"]);
    expect(dialogHit({ app: "Preview", pid: 1, kind: "save" }, SOURCES[1]).item).toMatchObject({ name: "Type a path for the save panel of Preview", group: "Dialog", push: { extension: "files", palette: "files" } });
  });
});
