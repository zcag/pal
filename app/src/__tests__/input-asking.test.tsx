// @vitest-environment happy-dom
// An input palette's host answers each keystroke in its own time (GitHub's
// search takes seconds): the search row's loading sweep runs while the
// latest query is unanswered, and an earlier query's late answer does not
// stop it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, type LauncherHandle } from "../Launcher";
import type { SourceInfo } from "../items";
import type { Hit } from "../ui/List";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources: SourceInfo[] = [
  { extension: "github", palette: "prs", title: "Pull Requests", live: false, input: false, count: 3, stale: false },
  { extension: "github", palette: "search", title: "Search GitHub", live: false, input: true, count: 0, stale: false },
];

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
/** The input palette's pending answers by query; the root and the indexed palette answer at once. */
const pending = new Map<string, () => void>();

beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); pending.clear(); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const search = (q: string, scope?: SourceInfo) => (scope?.input ? new Promise<Hit[]>((resolve) => pending.set(q, () => resolve([]))) : Promise.resolve([]));
const loading = () => el.querySelector(".pal-search")!.hasAttribute("data-loading");
const answer = (q: string) => act(async () => { pending.get(q)!(); await Promise.resolve(); await Promise.resolve(); });

describe("an input palette's pending search", () => {
  it("sweeps while the latest query is unanswered, and only that query's answer stops it", async () => {
    await act(async () => { root.render(<Launcher ref={launcher} sources={sources} version={0} search={search} onPick={() => {}} onHide={() => {}} />); });
    await flush();
    expect(loading()).toBe(false);
    await act(() => { launcher.current!.open("github/prs"); });
    await flush();
    expect(loading()).toBe(false);
    await act(() => { launcher.current!.open("github/search"); });
    await answer("");
    expect(loading()).toBe(false);
    await act(() => { launcher.current!.type("pars"); });
    expect(loading()).toBe(true);
    await act(() => { launcher.current!.type("parser"); });
    await answer("pars");
    expect(loading()).toBe(true);
    await answer("parser");
    expect(loading()).toBe(false);
  });
});
