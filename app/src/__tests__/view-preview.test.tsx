// @vitest-environment happy-dom
// A popover row read in full (`Effect.show` with `actions`, the SDK's
// `preview`): Space in the view opens it, its actions are listed and their
// bare keys work, Enter is the first; one run picks the view it came from
// and its answer closes the preview (a view's next tree lands on the view).
// Space or Escape goes back; a failed action leaves it open.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { Effect, SourceInfo } from "../items";
import type { ViewSpec } from "../ui/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SourceInfo = { extension: "mail", palette: "inbox", title: "Mail", live: false, input: false, view: "view", count: 0, stale: false };
const tree = (label: string): ViewSpec => ({
  title: label,
  keys: "actions",
  actions: [{ id: "open", title: "Open" }, { id: "preview", title: "Preview", shortcut: "space" }, { id: "read", title: "Mark as read", shortcut: "m" }],
  tree: { type: "stack", children: [{ type: "text", value: label }] },
});

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const picks: string[] = [];
let failRead = false;

beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); picks.length = 0; failRead = false; });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const mount = async () => {
  await act(async () => {
    root.render(
      <Launcher
        ref={launcher}
        sources={[source]}
        search={async () => []}
        view={async () => tree("2 unread")}
        onPick={async (item, _q, action): Promise<Effect> => {
          picks.push(`${item.id}:${action}`);
          if (action === "preview") return { show: { markdown: "Hello there", title: "Lunch?", actions: [{ id: "open", title: "Open in Mail" }, { id: "read", title: "Mark as read", shortcut: "m" }] } };
          if (action === "read" && failRead) throw new Error("offline");
          return { view: tree("1 unread") };
        }}
        onHide={() => {}}
      />,
    );
  });
  await flush();
  await act(() => { launcher.current!.open("mail/inbox"); });
  await flush();
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const shown = () => el.querySelector(".pal-show")?.textContent ?? null;
const title = () => el.querySelector(".pal-search__title")?.textContent;

describe("a view row's preview", () => {
  it("opens on Space, runs a bare key's action on the view and lands back on its next tree", async () => {
    await mount();
    await key(" "); await flush();
    expect(shown()).toContain("Hello there");
    await key("m"); await flush();
    expect(picks).toEqual(["view:preview", "view:read"]);
    expect(shown()).toBeNull();
    expect(title()).toBe("1 unread");
  });
  it("Enter runs the first action; Space and Escape go back without a pick", async () => {
    await mount();
    await key(" "); await flush();
    await key(" "); await flush();
    expect(shown()).toBeNull();
    await key(" "); await flush();
    await key("Escape"); await flush();
    expect(shown()).toBeNull();
    expect(picks).toEqual(["view:preview", "view:preview"]);
    await key(" "); await flush();
    await key("Enter"); await flush();
    expect(picks.at(-1)).toBe("view:open");
    expect(shown()).toBeNull();
  });
  it("stays open when the action fails", async () => {
    await mount();
    failRead = true;
    await key(" "); await flush();
    await key("m"); await flush();
    expect(shown()).toContain("Hello there");
    expect(el.textContent).toContain("Could not mark as read");
  });
});
