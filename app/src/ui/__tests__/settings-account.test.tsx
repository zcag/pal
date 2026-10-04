// @vitest-environment happy-dom
// Settings › Account: signed out, the email then the code; signed in, the
// handle, Sync now, the devices, the settings history by day with Restore,
// a synced extension's keys with theirs, Sign out and Delete. And the
// "this Mac only" note that the core's local list puts on rows elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsAccount, byDay, summary, type AccountState, type SettingsAccountProps, type SyncRev } from "../SettingsAccount";
import { LocalKeys, SettingsRow, keySegments, localMatcher } from "../SettingsField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const NOW = Date.UTC(2026, 9, 4, 12);
const T = NOW / 1000;
const DAY = 86_400;

function props(state: AccountState, over: Partial<SettingsAccountProps> = {}): SettingsAccountProps {
  return {
    state,
    onStart: vi.fn(async () => {}),
    onVerify: vi.fn(async () => {}),
    onDevices: vi.fn(async () => [
      { id: "a", name: "hornet", created: T - 40 * DAY, last_seen: T - 60, current: true },
      { id: "b", name: "marko", created: T - 12 * DAY, last_seen: T - DAY, current: false },
    ]),
    onHandle: vi.fn(async (h: string) => h),
    onDropDevice: vi.fn(async () => {}),
    onSyncNow: vi.fn(async () => {}),
    onHistory: vi.fn(async (space: string): Promise<SyncRev[]> =>
      space === "config"
        ? [
            { key: "general.theme", value: "dark", rev: 9, at: T - 600, device: "hornet" },
            { key: "general.design", value: "frappe", rev: 5, at: T - 3 * DAY, device: "marko" },
          ]
        : [
            { key: "best", value: 182.4, rev: 8, at: T - 900, device: "hornet" },
            { key: "best", value: 141.9, rev: 4, at: T - 2 * DAY, device: "marko" },
          ]),
    onRestore: vi.fn(async () => {}),
    onSignOut: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    now: NOW,
    ...over,
  };
}

const show = async (p: SettingsAccountProps) => { await act(async () => { root.render(<SettingsAccount {...p} />); }); };
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (b: HTMLElement) => { await act(async () => { b.click(); }); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const signedIn: AccountState = { signedIn: true, email: "ada@example.com", handle: "ada", lastSynced: T - 120, synced: [{ key: "vortex", title: "Vortex" }] };

describe("signed out", () => {
  it("asks for the email, then the code, and signs in with both", async () => {
    const p = props({ signedIn: false, synced: [] });
    await show(p);
    expect(el.textContent).toContain("No password: a code comes by mail.");
    expect(button("Send Code").disabled).toBe(true);
    await type(el.querySelector<HTMLInputElement>("#pal-account-email")!, " ada@example.com ");
    await click(button("Send Code"));
    expect(p.onStart).toHaveBeenCalledWith("ada@example.com");
    expect(el.textContent).toContain("Sent to ada@example.com");
    await type(el.querySelector<HTMLInputElement>("#pal-account-code")!, "12a3456");
    expect(el.querySelector<HTMLInputElement>("#pal-account-code")!.value).toBe("123456");
    await click(button("Sign In"));
    expect(p.onVerify).toHaveBeenCalledWith("ada@example.com", "123456");
  });

  it("shows the server's words for a wrong code", async () => {
    const p = props({ signedIn: false, synced: [] }, { onVerify: vi.fn(async () => { throw "That code is wrong or expired."; }) });
    await show(p);
    await type(el.querySelector<HTMLInputElement>("#pal-account-email")!, "a@b.c");
    await click(button("Send Code"));
    await type(el.querySelector<HTMLInputElement>("#pal-account-code")!, "000000");
    await click(button("Sign In"));
    expect(el.querySelector("[data-error]")?.textContent).toContain("That code is wrong or expired.");
  });
});

describe("signed in", () => {
  it("draws the account, the devices and the settings history, and restores a day", async () => {
    const p = props(signedIn);
    await show(p);
    expect(el.textContent).toContain("ada@example.com");
    expect(el.textContent).toContain("Last synced 2m ago");
    expect(el.textContent).toContain("This Mac");
    expect(el.textContent).toContain("last seen 1d ago");
    await click(button("Sync Now"));
    expect(p.onSyncNow).toHaveBeenCalled();
    // Two days of changes: the newest is now, the older one can be put back.
    const restore = [...el.querySelectorAll("button")].filter((b) => b.textContent === "Restore These Settings");
    expect(restore).toHaveLength(1);
    await click(restore[0]);
    expect(p.onRestore).toHaveBeenCalledWith("config", { at: T - 3 * DAY });
    // Another device signs out from here.
    await click(button("Sign Out"));
    expect(p.onDropDevice).toHaveBeenCalledWith("b", false);
    expect(el.querySelector("[aria-label=\"Devices\"]")?.textContent).not.toContain("marko");
  });

  it("a synced extension's keys, an older revision restored", async () => {
    const p = props(signedIn);
    await show(p);
    await click(button("Show History"));
    expect(p.onHistory).toHaveBeenCalledWith("ext:vortex");
    expect(el.textContent).toContain("182.4");
    await click(button("Restore"));
    expect(p.onRestore).toHaveBeenCalledWith("ext:vortex", { key: "best", rev: 4 });
  });

  it("saves a new handle, and says why one is refused", async () => {
    const p = props(signedIn, { onHandle: vi.fn(async () => { throw "That handle is taken."; }) });
    await show(p);
    const input = el.querySelector<HTMLInputElement>("#pal-account-handle")!;
    expect(button("Save")).toBeUndefined();
    await type(input, "admin");
    await click(button("Save"));
    expect(p.onHandle).toHaveBeenCalledWith("admin");
    expect(el.querySelector('[data-anchor="account:handle"] [data-error]')?.textContent).toContain("That handle is taken.");
  });

  it("deletes only on the second click", async () => {
    const p = props(signedIn);
    await show(p);
    await click(button("Delete Account"));
    expect(p.onDelete).not.toHaveBeenCalled();
    await click([...el.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Delete everything?"))!);
    expect(p.onDelete).toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("summary says a value in a few words", () => {
    expect(summary(null)).toBe("removed");
    expect(summary([1, 2])).toBe("2 items");
    expect(summary({ a: 1 })).toBe("1 fields");
    expect(summary(42)).toBe("42");
  });

  it("byDay groups revisions by day, newest first", () => {
    const days = byDay([
      { key: "a", value: 1, rev: 3, at: T, device: "x" },
      { key: "b", value: 1, rev: 2, at: T - 10, device: "y" },
      { key: "a", value: 1, rev: 1, at: T - 5 * DAY, device: "x" },
    ]);
    expect(days.map((d) => [d.keys, d.devices])).toEqual([[2, ["x", "y"]], [1, ["x"]]]);
    expect(days[0].at).toBe(T);
  });
});

describe("this Mac only", () => {
  it("matches the core's patterns, quoted segments and stars included", () => {
    const local = localMatcher(["general.hotkey", "palettes.*.hotkey", 'extensions."gmail@work".vault']);
    expect(keySegments('palettes."a.b".hotkey')).toEqual(["palettes", "a.b", "hotkey"]);
    expect(local("general.hotkey")).toBe(true);
    expect(local('palettes."a.b".hotkey')).toBe(true);
    expect(local('extensions."gmail@work".vault')).toBe(true);
    expect(local("general.theme")).toBe(false);
    expect(local("palettes.files.enabled")).toBe(false);
  });

  it("a row whose key is local says so; a synced one says nothing", async () => {
    await act(async () => {
      root.render(
        <LocalKeys.Provider value={localMatcher(["general.usage"])}>
          <SettingsRow label="Usage" configKey="general.usage" description="Counts.">x</SettingsRow>
          <SettingsRow label="Theme" configKey="general.theme">y</SettingsRow>
        </LocalKeys.Provider>,
      );
    });
    const notes = [...el.querySelectorAll(".pal-setting__local")];
    expect(notes).toHaveLength(1);
    expect(notes[0].closest(".pal-setting")?.textContent).toContain("Usage");
  });
});
