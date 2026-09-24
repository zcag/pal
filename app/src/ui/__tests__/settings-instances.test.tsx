// @vitest-environment happy-dom
// Instances of a `multi` extension in Settings (docs/design/instances.md,
// Phase 3): the helpers (the suffix grammar and slug, the host's tint hash
// mirrored, the instance resolved from the file and the host, the badged
// tile, what a write against an inherited value does), the Extensions
// page's Instances section and per-instance settings, the Palettes page
// grouped per key, the Overview's rows per instance.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsExtensions, byName, extensionsIndex } from "../SettingsExtensions";
import { ExtensionPalettes, palettesIndex } from "../SettingsPalettes";
import { overviewItems } from "../SettingsOverview";
import { badgedIcon, instanceBadge, instanceTint, instancesOf, leavesFile, needsSetup, resolveInstance, slugSuffix, suffixProblem, validSuffix, type SettingSpec, type SettingsExtension, type SettingsPalette, type SettingValues } from "../SettingsTypes";
import { BRAND } from "../icons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const specs: SettingSpec[] = [
  { kind: "text", id: "signature", label: "Signature", default: "" },
  { kind: "secret", id: "token", label: "Token", required: true, description: "The API token." },
  { kind: "boolean", id: "send", label: "Send", default: false, scope: "instance" },
  { kind: "list", id: "labels", label: "Labels", default: [] },
];
const palette = (key: string, title: string, settings: SettingValues = {}, inherited?: SettingValues): SettingsPalette => ({ id: `${key}-inbox`, title, settings: [{ kind: "number", id: "columns", label: "Columns", default: 1 } as SettingSpec], config: { enabled: true, settings }, ...(inherited && { inherited }) });
const base: Omit<SettingsExtension, "name" | "key" | "title" | "values" | "palettes"> = { multi: true, extTitle: "Gmail", description: "Mail.", version: "0.1.0", repo: "bundled", bundled: true, icon: { kind: "tile", bg: "red", glyph: "m" }, settings: specs, loaded: true };
const personal: SettingsExtension = { ...base, name: "gmail", key: "gmail", title: "Gmail (Personal)", instance: { key: "gmail", title: "Personal", isDefault: true, enabled: true }, values: { signature: "C", token: "keychain:pal/gmail-token", labels: ["GitHub"] }, palettes: [palette("gmail", "Inbox (Personal)", { columns: 2 })] };
const work: SettingsExtension = { ...base, name: "gmail", key: "gmail@work", title: "Gmail (Work)", icon: { kind: "tile", bg: "amber", glyph: "m", badge: "W" }, instance: { key: "gmail@work", suffix: "work", title: "Work", tint: "amber", badge: "W", isDefault: false, enabled: true }, values: {}, inherited: { signature: "C", labels: ["GitHub"] }, inheritedFrom: "Gmail (Personal)", palettes: [palette("gmail@work", "Inbox (Work)", {}, { columns: 2 })] };
const old: SettingsExtension = { ...work, key: "gmail@old", title: "Gmail (Old)", loaded: false, instance: { key: "gmail@old", suffix: "old", title: "Old", tint: "blue", badge: "O", isDefault: false, enabled: false }, values: {}, palettes: [] };
const timer: SettingsExtension = { name: "timer", key: "timer", title: "Timer", description: "Countdowns.", version: "1.0.0", repo: "bundled", bundled: true, settings: [], values: {}, palettes: [], loaded: true };
const all = [personal, work, old, timer];

describe("instance helpers", () => {
  it("checks a suffix as the core does and says why not", () => {
    for (const ok of ["work", "flat_2", "a", "0-a", "a".repeat(32)]) expect(validSuffix(ok), ok).toBe(true);
    for (const bad of ["", "default", "Work", "-work", "wörk", "a.b", "a".repeat(33)]) expect(validSuffix(bad), bad).toBe(false);
    expect(suffixProblem("")).toContain("suffix is needed");
    expect(suffixProblem("default")).toContain("default instance");
    expect(suffixProblem("Work")).toContain("Starts with");
    expect(suffixProblem("wo rk")).toContain("Lowercase");
    expect(suffixProblem("a".repeat(33))).toContain("At most 32");
    expect(suffixProblem("work", ["work"])).toContain("already");
    expect(suffixProblem("home", ["work"])).toBe("");
  });
  it("slugs a title into a suffix", () => {
    expect(slugSuffix("Work")).toBe("work");
    expect(slugSuffix("Work (SerpApi)")).toBe("work-serpapi");
    expect(slugSuffix("  Çağdaş's Flat 2 ")).toBe("cagdas-s-flat-2");
    expect(slugSuffix("--x--")).toBe("x");
    expect(slugSuffix("a".repeat(40))).toHaveLength(32);
    expect(slugSuffix("")).toBe("");
  });
  it("hashes the tint as the host does, skipping the extension's own", () => {
    // djb2 over the brand list (host/src/instances.ts `tintOf`): the same suffix, the same colour, and never `own`.
    const djb2 = (s: string) => { let h = 5381; for (const ch of s) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0; return h; };
    const without = (own?: string) => BRAND.filter((c) => c !== own);
    expect(instanceTint("work", "ink")).toBe(without("ink")[djb2("work") % 11]);
    expect(instanceTint("work")).toBe(BRAND[djb2("work") % 12]);
    for (let i = 0; i < 50; i++) expect(instanceTint(`s${i}`, "red")).not.toBe("red");
    expect(instanceBadge("work")).toBe("W");
    expect(instanceBadge("")).toBe("");
  });
  it("resolves an instance from the host's announcement over the file, and fills a parked one's defaults", () => {
    expect(resolveInstance("gmail", "gmail", { title: "Personal" }, { key: "gmail", title: "Personal", isDefault: true })).toEqual({ key: "gmail", isDefault: true, enabled: true, title: "Personal" });
    expect(resolveInstance("gmail", "gmail", undefined, undefined)).toEqual({ key: "gmail", isDefault: true, enabled: true });
    expect(resolveInstance("gmail@work", "gmail", { title: "Work", tint: "amber" }, { key: "gmail@work", title: "Work", tint: "amber", badge: "W", isDefault: false })).toEqual({ key: "gmail@work", suffix: "work", title: "Work", tint: "amber", badge: "W", isDefault: false, enabled: true });
    const parked = resolveInstance("gmail@old", "gmail", { enabled: false }, undefined, "red");
    expect(parked).toEqual({ key: "gmail@old", suffix: "old", title: "Old", tint: instanceTint("old", "red"), badge: "O", isDefault: false, enabled: false });
    expect(resolveInstance("gmail@x", "gmail", { tint: "plaid", badge: "ABC" }, undefined).tint).toBe(instanceTint("x"));
    expect(resolveInstance("gmail@x", "gmail", { tint: "plaid", badge: "ABC" }, undefined).badge).toBe("AB");
  });
  it("badges the tile of a non-default instance and leaves the rest", () => {
    expect(badgedIcon({ kind: "tile", bg: "red", glyph: "m" }, work.instance)).toEqual({ kind: "tile", bg: "amber", glyph: "m", badge: "W" });
    expect(badgedIcon({ kind: "tile", bg: "red", glyph: "m" }, personal.instance)).toEqual({ kind: "tile", bg: "red", glyph: "m" });
    expect(badgedIcon({ kind: "emoji", value: "x" }, work.instance)).toEqual({ kind: "emoji", value: "x" });
    expect(badgedIcon(undefined, work.instance)).toBeUndefined();
  });
  it("writes against the inherited value, not the default, for an instance", () => {
    const sig = specs[0];
    expect(leavesFile("C", sig, "C")).toBe(true);
    expect(leavesFile("W", sig, "C")).toBe(false);
    expect(leavesFile("", sig, "C")).toBe(true);
    expect(leavesFile("", sig)).toBe(true);
    expect(leavesFile("C", sig)).toBe(false);
    expect(leavesFile(["GitHub"], specs[3], ["GitHub"])).toBe(true);
    expect(leavesFile([], specs[3])).toBe(true);
    expect(leavesFile(false, specs[2])).toBe(true);
  });
  it("flags what an instance still needs, through the inheritance", () => {
    expect(needsSetup(work).map((s) => s.id)).toEqual(["token"]);
    expect(needsSetup(personal)).toEqual([]);
    expect(needsSetup({ ...work, values: {}, inherited: { signature: "C" } }).map((s) => s.id)).toEqual(["token"]);
  });
  it("groups by name with the default first, and indexes per key", () => {
    expect(byName(all).map((e) => e.key)).toEqual(["gmail", "timer"]);
    expect(byName([work, personal]).map((e) => e.key)).toEqual(["gmail"]);
    expect(instancesOf(work, all).map((e) => e.key)).toEqual(["gmail", "gmail@old", "gmail@work"]);
    const idx = extensionsIndex(all);
    expect(idx.find((e) => e.anchor === "extensions:gmail@work:token")?.hint).toBe("Gmail (Work) setting");
    expect(idx.find((e) => e.anchor === "extensions:gmail@work")?.label).toBe("Gmail (Work)");
    expect(idx.find((e) => e.anchor === "extensions:gmail")?.label).toBe("Gmail");
    const pidx = palettesIndex(all);
    expect(pidx.find((e) => e.anchor === "palettes:gmail@work-inbox")?.label).toBe("Gmail › Inbox (Work)"); // the group's header carries the instance; the row's prefix is the extension's plain title
    expect(pidx.find((e) => e.anchor === "palettes:gmail@work-inbox")?.keywords).toContain("Gmail (Work)");
    expect(pidx.find((e) => e.anchor === "palettes:gmail@work-inbox:columns")?.hint).toBe("Gmail (Work) › Inbox (Work)");
  });
  it("puts the Overview's needs-setup and failed rows per instance", () => {
    const failing = { ...personal, loaded: false, error: "boom", warnings: ["w"] };
    const items = overviewItems({ version: "0.1.0", hotkey: { hotkeys: [{ wanted: "ctrl+space", registered: true }], registered: true }, extensions: [failing, { ...work, warnings: ["w"] }, timer], bar: [], diagnostics: [] });
    expect(items.map((i) => i.id)).toEqual(["failed:gmail", "setup:gmail@work", "warning:gmail:w"]);
    expect(items[1].title).toBe("Gmail (Work) needs token");
    expect(items[1].action?.go).toEqual({ page: "extensions", anchor: "extensions:gmail@work:token" });
    expect(items[2].title).toBe("Gmail: manifest warning");
  });
});

describe("Extensions page with instances", () => {
  let root: Root, el: HTMLDivElement;
  beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
  afterEach(() => { act(() => root.unmount()); el.remove(); });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it("the home says an extension's accounts once, under its own title; its page has the Instances section with every instance", () => {
    const home = renderToStaticMarkup(<SettingsExtensions extensions={all} onSelect={() => {}} onChange={() => {}} />);
    expect(home).toContain("<b>Gmail</b><span>Set token (Work)</span>"); // one card per extension, its own title, the instance that needs it named
    expect(home).not.toContain("Gmail (Work)</b>");
    const html = renderToStaticMarkup(<SettingsExtensions extensions={all} selected="gmail" onSelect={() => {}} onChange={() => {}} onInstanceAdd={async () => {}} onInstanceRename={() => {}} onInstanceRemove={async () => {}} onInstanceEnabled={() => {}} />);
    const rows = el.ownerDocument.createElement("div");
    rows.innerHTML = html;
    const keys = [...rows.querySelectorAll(".pal-instances__key")].map((k) => k.textContent);
    expect(keys).toEqual(["gmail", "gmail@old", "gmail@work"]);
    expect(rows.querySelector('[data-anchor="extensions:gmail"] .pal-instances__title')?.textContent).toContain("default");
    expect(rows.querySelector('.pal-instances__row[data-off] .pal-instances__title')?.textContent).toContain("Old");
    expect(rows.querySelectorAll('.pal-instances__row [role="switch"]')).toHaveLength(3);
    expect([...rows.querySelectorAll(".pal-instances__row .pal-button")].map((b) => b.textContent)).toEqual(["Rename", "Rename", "Remove", "Rename", "Remove"]);
    expect(rows.querySelector(".pal-xpane__hero .pal-xpane__title")?.textContent).toBe("Gmail");
    expect(rows.querySelector('.pal-instances__row[data-anchor="extensions:gmail@work"] .pal-icon')?.getAttribute("data-brand")).toBe("amber");
    expect(rows.querySelector('.pal-instances__row[data-anchor="extensions:gmail@work"] .pal-icon__badge')?.textContent).toBe("W");
    expect(rows.querySelector(".pal-instances")).not.toBeNull();
    // A non-multi extension has no such section.
    expect(renderToStaticMarkup(<SettingsExtensions extensions={all} selected="timer" onSelect={() => {}} onChange={() => {}} onInstanceAdd={async () => {}} />)).not.toContain("pal-instances");
  });

  it("shows the selected instance's settings with the inherited and per-instance notes, and writes under its key", async () => {
    const changes: [string, unknown][] = [];
    await act(async () => { root.render(<SettingsExtensions extensions={all} selected="gmail" onSelect={() => {}} onChange={(k, v) => changes.push([k, v])} />); });
    await flush();
    const note = () => el.querySelector('section[aria-label="Settings"] .pal-xpane__h-note')?.textContent;
    expect(note()).toBe("extensions.gmail");
    // A row of the Instances section selects the instance for the Settings section.
    await act(async () => { (el.querySelector('.pal-instances__row[data-anchor="extensions:gmail@work"] .pal-instances__main') as HTMLButtonElement).click(); });
    expect(note()).toBe('extensions."gmail@work"');
    expect(el.querySelector('[role="radiogroup"][aria-label="Settings of which instance"] [aria-checked="true"]')?.textContent).toBe("Work");
    const sig = el.querySelector('[data-anchor="extensions:gmail@work:signature"]')!;
    expect(sig.hasAttribute("data-inherited")).toBe(true);
    expect(sig.querySelector(".pal-setting__note")?.textContent).toBe("From Gmail (Personal)");
    expect((sig.querySelector("input") as HTMLInputElement).value).toBe("C");
    const token = el.querySelector('[data-anchor="extensions:gmail@work:token"]')!;
    expect(token.querySelector(".pal-setting__note")?.textContent).toContain("Set for this instance");
    expect(token.hasAttribute("data-missing")).toBe(true);
    expect(el.querySelector('[data-anchor="extensions:gmail@work:send"] .pal-setting__note')?.textContent).toContain("Set for this instance");
    expect(el.querySelector(".pal-callout")?.textContent).toContain("Gmail (Work) lists nothing until token is set");
    // A change lands under the instance's key; the values passed are the instance's own plus the edit.
    const input = sig.querySelector("input") as HTMLInputElement;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "W"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(changes[0][0]).toBe("gmail@work");
    expect(changes[0][1]).toEqual({ signature: "W" });
    // The segmented control moves the section to another instance.
    await act(async () => { (el.querySelector('[role="radiogroup"][aria-label="Settings of which instance"] [data-id="gmail"]') as HTMLButtonElement).click(); });
    expect(note()).toBe("extensions.gmail");
    expect(el.querySelector('[data-anchor="extensions:gmail:signature"] .pal-setting__note')).toBeNull();
  });

  it("adds another account through the inline form with the suffix slugged and checked", async () => {
    const added: unknown[] = [];
    const selected: string[] = [];
    await act(async () => { root.render(<SettingsExtensions extensions={all} selected="gmail" onSelect={() => {}} onSelectInstance={(k) => selected.push(k)} onChange={() => {}} onInstanceAdd={async (...a) => { added.push(a); }} />); });
    await flush();
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === "Add another account")!;
    await act(async () => { button.click(); });
    const form = el.querySelector("form.pal-instances__add")!;
    const [title, suffix] = [...form.querySelectorAll("input")];
    const type = (input: HTMLInputElement, v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const create = () => form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    await type(title, "Side Project");
    expect(suffix.value).toBe("side-project");
    expect(create().disabled).toBe(false);
    expect(form.querySelector(".pal-instances__note")?.textContent).toContain("pal://open/gmail@side-project/");
    // A suffix in use, or a bad one, is refused live.
    await type(suffix, "work");
    expect(form.querySelector(".pal-instances__note")?.textContent).toContain("already");
    expect(create().disabled).toBe(true);
    await type(suffix, "Side");
    expect(form.querySelector(".pal-instances__note")?.textContent).toContain("Starts with");
    // Typed by hand, the suffix stops following the title.
    await type(suffix, "side");
    await type(title, "Side Project Two");
    expect(suffix.value).toBe("side");
    // A tint; Create passes it, and the new key is selected.
    await act(async () => { (form.querySelector('.pal-instances__tint[data-brand="teal"]') as HTMLButtonElement).click(); });
    expect(form.querySelector(".pal-instances__preview .pal-icon")?.getAttribute("data-brand")).toBe("teal");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(added).toEqual([["gmail", "side", "Side Project Two", "teal"]]);
    expect(selected).toEqual(["gmail@side"]);
    expect(el.querySelector("form.pal-instances__add")).toBeNull();
  });

  it("renames inline, parks with the switch, and removes on the second press", async () => {
    const renamed: [string, string][] = [];
    const enabled: [string, boolean][] = [];
    const removed: string[] = [];
    await act(async () => { root.render(<SettingsExtensions extensions={all} selected="gmail" onSelect={() => {}} onChange={() => {}} onInstanceRename={(k, t) => { renamed.push([k, t]); }} onInstanceEnabled={(k, v) => enabled.push([k, v])} onInstanceRemove={async (k) => { removed.push(k); }} />); });
    await flush();
    const row = (key: string) => el.querySelector(`.pal-instances__row[data-anchor="extensions:${key}"]`)!;
    await act(async () => { ([...row("gmail@work").querySelectorAll("button")].find((b) => b.textContent === "Rename") as HTMLButtonElement).click(); });
    const field = row("gmail@work").querySelector("input.pal-instances__rename") as HTMLInputElement;
    expect(field.value).toBe("Work");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Job"); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(renamed).toEqual([["gmail@work", "Job"]]);
    await act(async () => { (row("gmail@old").querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect(enabled).toEqual([["gmail@old", true]]);
    const remove = () => [...row("gmail@work").querySelectorAll("button")].find((b) => b.textContent?.startsWith("Remove")) as HTMLButtonElement;
    await act(async () => { remove().click(); });
    expect(remove().textContent).toContain("Click again");
    expect(removed).toEqual([]);
    await act(async () => { remove().click(); });
    await flush();
    expect(removed).toEqual(["gmail@work"]);
    expect(row("gmail").querySelector("button[aria-label^='Remove']")).toBeNull();
  });
});

describe("an instance's palettes on its pane", () => {
  it("wear the instance's badged tile, and an inherited palette setting is noted", () => {
    const html = renderToStaticMarkup(<ExtensionPalettes ext={work} open="gmail@work-inbox" onOpen={() => {}} onChange={() => {}} />);
    const doc = document.createElement("div");
    doc.innerHTML = html;
    expect(doc.querySelector(".pal-ptable")?.getAttribute("aria-label")).toBe("Gmail (Work) palettes");
    const workRow = doc.querySelector('[data-anchor="palettes:gmail@work-inbox"]')!;
    expect(workRow.querySelector(".pal-ptable__name")?.textContent).toBe("Inbox (Work)");
    expect(workRow.querySelector(".pal-icon")?.getAttribute("data-brand")).toBe("amber");
    const columns = doc.querySelector('[data-anchor="palettes:gmail@work-inbox:columns"]')!;
    expect(columns.hasAttribute("data-inherited")).toBe(true);
    expect(columns.querySelector(".pal-setting__note")?.textContent).toBe("From Gmail (Personal)");
    expect((columns.querySelector("input") as HTMLInputElement).getAttribute("value")).toBe("2");
  });
});

