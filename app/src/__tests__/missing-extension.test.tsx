// @vitest-environment happy-dom
// A push or a link into an extension that is not loaded opens its card
// ("X isn't installed" with Install, "X is turned off" with Turn on,
// or neither when no registry lists it) instead of an empty level; Enter
// installs, and the card gives way to the palette once the index lists
// it. A palette entered is counted for its extension (`onOpened`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Launcher, missingCard, missingExtension, type LauncherHandle, type MissingInfo } from "../Launcher";
import type { SourceInfo } from "../items";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (extension: string, palette: string, title: string): SourceInfo => ({ extension, palette, title, live: false, input: false, count: 2, stale: false });
const clipboard = src("clipboard", "clipboard", "Clipboard");
const snippets = src("snippets", "snippets", "Snippets");

let root: Root, el: HTMLDivElement;
const launcher: { current: LauncherHandle | null } = { current: null };
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
const enter = () => act(async () => { document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
type Props = { missing?: (e: string) => Promise<MissingInfo>; install?: (e: string, i: MissingInfo, from: string) => Promise<void>; opened?: (e: string) => void };
const render = (sources: SourceInfo[], p: Props) => act(async () => {
  root.render(<Launcher ref={launcher} sources={sources} search={async () => []} onPick={() => ({ push: { extension: "snippets", palette: "snippets" } })} onHide={() => {}} missing={p.missing} onInstallMissing={p.install} onOpened={p.opened} />);
});

describe("missingExtension", () => {
  it("names the extension of a key nothing of which is loaded, and nothing else", () => {
    expect(missingExtension("snippets/snippets", [clipboard])).toBe("snippets");
    expect(missingExtension("gmail@work/inbox", [clipboard])).toBe("gmail@work");
    expect(missingExtension("clipboard/clipboard", [clipboard])).toBeUndefined();
    // A palette of a loaded extension (switched off, renamed) is not a missing extension; nor a shell source, a bar key, or anything before the index answered.
    expect(missingExtension("clipboard/other", [clipboard])).toBeUndefined();
    expect(missingExtension("pal/welcome", [clipboard])).toBeUndefined();
    expect(missingExtension("bar:snippets/x", [clipboard])).toBeUndefined();
    expect(missingExtension("snippets/snippets", [])).toBeUndefined();
  });
  it("words the card for each state", () => {
    const base = { kind: "missing" as const, extension: "snippets", from: "store" as const, phase: "idle" as const };
    expect(missingCard({ ...base, info: { title: "Snippets", state: "absent", installable: true, tagline: "Text you reuse" } })).toEqual({ title: "Snippets isn't installed", hint: "Text you reuse", note: undefined });
    expect(missingCard({ ...base, info: { title: "Snippets", state: "off" } }).title).toBe("Snippets is turned off");
    expect(missingCard({ ...base, info: { title: "snippets", state: "unknown" } }).hint).toBe("No registry you follow lists it.");
    expect(missingCard({ ...base, info: { title: "DPI", state: "absent", installable: false, blocked: "not for this platform" } }).hint).toBe("It can't be installed here: not for this platform.");
    expect(missingCard({ ...base, phase: "error", error: "offline", info: { title: "Snippets", state: "absent", installable: true } }).note).toBe("offline");
  });
});

describe("a push into a missing extension", () => {
  it("shows the card, installs on Enter from the store, then opens the palette once the index lists it", async () => {
    const install = vi.fn(async () => {});
    const opened = vi.fn();
    const p: Props = { missing: async () => ({ title: "Snippets", state: "absent", installable: true, tagline: "Text you reuse" }), install, opened };
    await render([clipboard], p);
    await act(() => { launcher.current!.open("snippets/snippets"); });
    await flush();
    expect(el.textContent).toContain("Snippets isn't installed");
    expect(el.textContent).toContain("Text you reuse");
    expect(el.querySelector(".pal-empty__action button")?.textContent).toBe("Install");
    await enter();
    await flush();
    expect(install).toHaveBeenCalledWith("snippets", expect.objectContaining({ state: "absent" }), "store");
    expect(el.textContent).toContain("Opening…");
    await render([clipboard, snippets], p);
    await flush();
    expect(el.textContent).not.toContain("isn't installed");
    expect(el.querySelector("input")?.getAttribute("placeholder")).toBe("Search Snippets…");
    expect(opened).toHaveBeenCalledWith("snippets");
  });
  it("says a failed install under the card and keeps Install", async () => {
    const p: Props = { missing: async () => ({ title: "Snippets", state: "absent", installable: true }), install: async () => { throw new Error("offline: pal.cagdas.io is not reachable"); } };
    await render([clipboard], p);
    await act(() => { launcher.current!.open("snippets/snippets"); });
    await flush();
    await enter();
    await flush();
    expect(el.textContent).toContain("offline: pal.cagdas.io is not reachable");
    expect(el.querySelector(".pal-empty__action button")?.textContent).toBe("Install");
  });
  it("offers Turn on for one turned off, and nothing for one no registry lists", async () => {
    await render([clipboard], { missing: async () => ({ title: "Snippets", state: "off" }), install: async () => {} });
    await act(() => { launcher.current!.open("snippets/snippets"); });
    await flush();
    expect(el.textContent).toContain("Snippets is turned off");
    expect(el.querySelector(".pal-empty__action button")?.textContent).toBe("Turn on");
    await render([clipboard], { missing: async () => ({ title: "tan", state: "unknown" }), install: async () => {} });
    await act(() => { launcher.current!.missing("tan"); });
    await flush();
    expect(el.textContent).toContain("tan isn't installed");
    expect(el.querySelector(".pal-empty__action")).toBeNull();
  });
  it("without the store's answer a push opens as it always did", async () => {
    await render([clipboard], {});
    await act(() => { launcher.current!.open("snippets/snippets"); });
    await flush();
    expect(el.textContent).not.toContain("isn't installed");
  });
});
