// @vitest-environment happy-dom
// `version` (an index event) re-runs the search at the root and in an
// indexed palette, whose rows live in the index; not in an input palette,
// which the host lists per keystroke (a show lands one event per palette,
// each of which was another host call for the same query).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources: SourceInfo[] = [
  { extension: "tela", palette: "pages", title: "Pages", live: false, input: false, count: 3, stale: false },
  { extension: "tela", palette: "search", title: "Search tela", live: false, input: true, count: 0, stale: false },
];

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
const calls: string[] = [];

beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); calls.length = 0; });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
// One function across renders, as `useCore`'s is: a new `search` would re-run the effect by itself.
const search = async (q: string, scope?: SourceInfo) => { calls.push(`${scope ? scope.palette : "root"}:${q}`); return []; };
const render = (version: number) => act(async () => {
  root.render(<Launcher ref={launcher} sources={sources} version={version} search={search} onPick={() => {}} onHide={() => {}} />);
});
const type = (q: string) => act(() => { launcher.current!.type(q); });

describe("an index event lists the index-backed levels again, not an input palette", () => {
  it("root and an indexed palette re-search on version; the input palette only on a keystroke", async () => {
    await render(0);
    await flush();
    expect(calls).toEqual(["root:"]);
    await render(1);
    await flush();
    expect(calls).toEqual(["root:", "root:"]);
    await act(() => { launcher.current!.open("tela/pages"); });
    await flush();
    expect(calls.at(-1)).toBe("pages:");
    await render(2);
    await flush();
    expect(calls.at(-1)).toBe("pages:");
    expect(calls.filter((c) => c === "pages:")).toHaveLength(2);
    await act(() => { launcher.current!.open("tela/search"); });
    await flush();
    expect(calls.at(-1)).toBe("search:");
    const n = calls.length;
    await render(3);
    await render(4);
    await flush();
    expect(calls.length).toBe(n);
    await type("onboard");
    await flush();
    expect(calls.slice(n)).toEqual(["search:onboard"]);
  });
});
