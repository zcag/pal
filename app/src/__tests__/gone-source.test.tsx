// @vitest-environment happy-dom
// A level whose source vanished (an instance removed, a palette switched
// off) pops to the root with a toast on the next `sources` change; a
// source that was never known (a bar item's view level) and the empty
// list at startup say nothing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (extension: string, palette: string, title: string): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 2, stale: false });
const work = src("gmail@work", "inbox", "Inbox (Work)");
const personal = src("gmail", "inbox", "Inbox (Personal)");

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const render = (sources: SourceInfo[]) => act(async () => {
  root.render(<Launcher ref={launcher} sources={sources} search={async () => []} onPick={() => {}} onHide={() => {}} />);
});

describe("a level on a gone source", () => {
  it("pops to the root with a toast when its source leaves the list", async () => {
    await render([personal, work]);
    await flush();
    await act(() => { launcher.current!.open("gmail@work/inbox"); });
    await flush();
    expect(el.textContent).toContain("Inbox (Work)");
    await render([personal]);
    await flush();
    expect(el.querySelector(".pal-toast")?.textContent).toContain("Inbox (Work) is gone");
    expect(el.querySelector("input")?.getAttribute("placeholder") ?? "").not.toContain("Inbox (Work)");
  });
  it("stays when the source is still there or was never a source", async () => {
    await render([personal, work]);
    await flush();
    await act(() => { launcher.current!.open("gmail/inbox"); });
    await flush();
    await render([personal]);
    await flush();
    expect(el.querySelector(".pal-toast")).toBeNull();
    expect(el.textContent).toContain("Inbox (Personal)");
  });
  it("says nothing while the list is empty at startup", async () => {
    await render([]);
    await flush();
    await render([personal]);
    await flush();
    expect(el.querySelector(".pal-toast")).toBeNull();
  });
});
