// @vitest-environment happy-dom
// Deep links from the page (docs/design/links.md): `linkFor` per level and
// item, and the "Copy deep link" shell action: listed in the action panel,
// ⌘⇧C runs it with the row's link, and a link's effect delivered through
// the handle opens its level as a pick's answer would.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRef } from "react";
import { Launcher, type LauncherHandle, type Level } from "../Launcher";
import { COMMANDS, linkFor } from "../links";
import { PALETTES, WELCOME, type SourceInfo } from "../items";
import type { Item } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, palette: string, name = id): Item => ({ id, name, palette, source: palette.includes("/") ? { extension: palette.split("/")[0], palette: palette.split("/")[1] } : undefined });
const root: Level = { kind: "root" };

describe("linkFor", () => {
  it("a row is run/<ext>/<palette>/<id>, encoded; a drill-in carries its args", () => {
    expect(linkFor(root, row("com.apple.Safari", "apps/apps"))).toBe("pal://run/apps/apps/com.apple.Safari");
    expect(linkFor({ kind: "palette", palette: "a/b" }, row("with/slash & more", "a/b"))).toBe("pal://run/a/b/with%2Fslash%20%26%20more");
    expect(linkFor({ kind: "palette", palette: "files/files", args: { open_with: "/tmp/x" } }, row("/Applications/Preview.app", "files/files"))).toBe("pal://run/files/files/%2FApplications%2FPreview.app?args=%7B%22open_with%22%3A%22%2Ftmp%2Fx%22%7D");
  });
  it("a palette row opens the palette; one of pal's rows is commands/<id>; a tip has none", () => {
    expect(linkFor(root, row("emoji/emoji", PALETTES, "Emoji"))).toBe("pal://open/emoji/emoji");
    expect(linkFor(root, row("refresh", COMMANDS))).toBe("pal://commands/refresh");
    expect(linkFor(root, row("tip", WELCOME))).toBeUndefined();
    expect(linkFor(root, row("x", ""))).toBeUndefined();
  });
  it("inside a palette with nothing under the cursor: open, with the query typed; a drill-in level has none; the root has none", () => {
    expect(linkFor({ kind: "palette", palette: "emoji/emoji" }, undefined)).toBe("pal://open/emoji/emoji");
    expect(linkFor({ kind: "palette", palette: "emoji/emoji" }, undefined, "two words")).toBe("pal://open/emoji/emoji?q=two%20words");
    expect(linkFor({ kind: "view", palette: "blackjack/blackjack" }, undefined)).toBe("pal://open/blackjack/blackjack");
    expect(linkFor({ kind: "palette", palette: "a/b", args: { x: 1 } }, undefined)).toBeUndefined();
    expect(linkFor({ kind: "palette", palette: PALETTES }, undefined)).toBeUndefined();
    expect(linkFor(root, undefined)).toBeUndefined();
  });
  it("a form level is form/<ext>/<palette>/<id> with the action that opened it; a bar menu row is bar/<key>?action=", () => {
    const from = row("create", "quicklinks/quicklinks");
    const form: Level = { kind: "form", palette: "quicklinks/quicklinks", spec: { title: "T", fields: [], submit: { id: "save", title: "Save" } }, from, action: "create", key: 1 };
    expect(linkFor(form, from)).toBe("pal://form/quicklinks/quicklinks/create?action=create");
    expect(linkFor({ ...form, action: undefined }, from)).toBe("pal://form/quicklinks/quicklinks/create");
    const menu: Level = { kind: "menu", key: "timer/timer", title: "Timer", rows: [], submenus: {} };
    expect(linkFor(menu, row("stop", "timer/timer"))).toBe("pal://bar/timer/timer?action=stop");
    expect(linkFor(menu, row("pal:submenu", "timer/timer"))).toBeUndefined();
    expect(linkFor(menu, undefined)).toBeUndefined();
  });
});

describe("Copy deep link in the Launcher", () => {
  const source: SourceInfo = { extension: "apps", palette: "apps", title: "Apps", live: false, input: false, count: 1, stale: false };
  const safari: Item = { ...row("com.apple.Safari", "apps/apps", "Safari"), actions: [{ id: "open", title: "Open" }, { id: "quit", title: "Quit" }] };
  let rootEl: Root, el: HTMLDivElement;
  const links: string[] = [];
  const picks: string[] = [];
  const ref = createRef<LauncherHandle>();
  beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); rootEl = createRoot(el); links.length = 0; picks.length = 0; });
  afterEach(() => { act(() => rootEl.unmount()); el.remove(); });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const mount = async (onLink?: (l: string) => void) => {
    await act(async () => { rootEl.render(<Launcher ref={ref} sources={[source]} search={async () => [{ item: safari }]} onPick={(item, _q, action) => { picks.push(`${item.id}:${action ?? ""}`); }} onHide={() => {}} onLink={onLink} />); });
    await flush();
  };
  const key = (k: string, init: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, cancelable: true, ...init })); });

  it("⌘⇧C copies the row's run link and picks nothing; the action panel lists it under Link", async () => {
    await mount((l) => links.push(l));
    await key("c", { metaKey: true, ctrlKey: true, shiftKey: true });
    expect(links).toEqual(["pal://run/apps/apps/com.apple.Safari"]);
    expect(picks).toEqual([]);
    await key("k", { metaKey: true, ctrlKey: true });
    const titles = [...el.querySelectorAll(".pal-action__title")].map((n) => n.textContent);
    expect(titles).toContain("Copy deep link");
    expect([...el.querySelectorAll(".pal-actions__section")].map((n) => n.textContent)).toContain("Link");
  });

  it("without onLink there is no such action, and the key does nothing", async () => {
    await mount();
    await key("c", { metaKey: true, ctrlKey: true, shiftKey: true });
    await key("k", { metaKey: true, ctrlKey: true });
    expect([...el.querySelectorAll(".pal-action__title")].map((n) => n.textContent)).not.toContain("Copy deep link");
    expect(links).toEqual([]);
  });

  it("apply(item, effect) opens the level a link's pick answered with, here a prefilled form", async () => {
    await mount((l) => links.push(l));
    const create = row("create", "quicklinks/quicklinks", "Create Quicklink");
    await act(async () => {
      ref.current!.apply(create, { form: { title: "Create Quicklink", fields: [{ kind: "text", id: "name", label: "Name", default: "GitHub" } as never], submit: { id: "save", title: "Create" } } });
    });
    await flush();
    expect(el.querySelector(".pal-search__title")?.textContent).toBe("Create Quicklink");
    expect(el.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe("GitHub");
    // The form level's own link names the item it came from.
    await key("c", { metaKey: true, ctrlKey: true, shiftKey: true });
    expect(links.at(-1)).toBe("pal://form/quicklinks/quicklinks/create");
  });

  it("toast(spec) shows a toast without a pick", async () => {
    await mount();
    await act(async () => { ref.current!.toast({ style: "success", title: "Deployed", message: "v1.2" }); });
    expect(el.textContent).toContain("Deployed");
  });
});
