// @vitest-environment happy-dom
// Settings > Bar > an item's Rules: the facts line, one row per rule with
// the dot for the one that holds, the effect chips and where each comes
// from; a row opens into its editor, whose fields write single keys
// under the rule's table; Reset drops an overridden extension rule's
// table, Remove a rule of the user's own; Add a rule writes when + hidden.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsBar } from "../SettingsBar";
import { effectChips, type RuleWrite } from "../SettingsBarRules";
import { lookDefaults, type BarConfig } from "../SettingsTypes";
import { ruledItem } from "./settings-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: BarConfig = { target: "auto", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: true, sketchybarPosition: "right", menubar: { ...lookDefaults }, sketchybar: { ...lookDefaults } };

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const writes: [string, string, RuleWrite | null][] = [];
const show = () => act(() => { root.render(<SettingsBar config={config} onChange={() => {}} items={[ruledItem]} onItem={() => {}} onRule={(k, id, w) => writes.push([k, id, w])} sketchybar={false} selected="power/battery" />); });
const row = (id: string) => el.querySelector<HTMLElement>(`[data-testid="rule-${id}"]`)!;
const input = (label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const set = (i: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
  const proto = i instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(i, value);
  i.dispatchEvent(new Event(i instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
const click = (b: Element | null | undefined) => act(() => { (b as HTMLElement).click(); });
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);

describe("effectChips", () => {
  it("says what a rule does in a few words", () => {
    expect(effectChips({ hidden: true })).toEqual(["hidden"]);
    expect(effectChips({ color: "red", urgent: true, size: 12, position: "q" })).toEqual(["urgent", "tint red", "12 pt", "at q"]);
    expect(effectChips({})).toEqual([]);
  });
});

describe("SettingsBar rules", () => {
  beforeEach(() => { writes.length = 0; });

  it("lists the facts and the rules with who holds, what it does and where it comes from", async () => {
    await show();
    expect(el.querySelector('[data-testid="rule-facts"]')?.textContent).toContain("power.level 42");
    expect(el.querySelector('[data-testid="rule-facts"]')?.textContent).toContain("power.charging false");
    expect([...el.querySelectorAll(".pal-rules__row")].map((r) => r.getAttribute("data-testid"))).toEqual(["rule-fine", "rule-low", "rule-warn", "rule-focus"]);
    expect(row("warn").hasAttribute("data-active")).toBe(true);
    expect(row("low").hasAttribute("data-active")).toBe(false);
    expect([...row("low").querySelectorAll(".pal-rules__chip")].map((c) => c.textContent)).toEqual(["urgent", "tint red"]);
    expect(row("low").querySelector(".pal-rules__origin")?.textContent).toBe("from Power, changed");
    expect(row("warn").querySelector(".pal-rules__origin")?.textContent).toBe("from Power");
    expect(row("focus").querySelector(".pal-rules__origin")?.textContent).toBe("yours");
    expect(row("low").querySelector(".pal-rules__cond")?.textContent).toBe("power.level < 25");
  });

  it("opens a rule into its editor; the condition commits on Enter, the fields write one key each", async () => {
    await show();
    expect(input("low condition")).toBeNull();
    click(row("low").querySelector(".pal-rules__head"));
    expect(row("low").querySelector(".pal-rules__default")?.textContent).toBe("Power has power.level < 15");
    set(input("low condition"), "power.level < 30");
    act(() => { input("low condition").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(writes.at(-1)).toEqual(["power/battery", "low", { when: "power.level < 30" }]);
    set(el.querySelector<HTMLSelectElement>('[id="bar:power/battery-rule-low-hidden"]')!, "on");
    expect(writes.at(-1)).toEqual(["power/battery", "low", { hidden: true }]);
    set(input("low tint"), "violet");
    expect(writes.at(-1)).toEqual(["power/battery", "low", { color: "violet" }]);
    set(input("low size"), "12");
    expect(writes.at(-1)).toEqual(["power/battery", "low", { size: 12 }]);
    set(input("low position"), "");
    expect(writes.at(-1)).toEqual(["power/battery", "low", { size: 12 }]); // an unchanged controlled field fires nothing
    set(input("low icon"), "\u{f0079}");
    expect(writes.at(-1)).toEqual(["power/battery", "low", { icon: "\u{f0079}" }]);
  });

  it("Reset drops an overridden extension rule; a pristine one cannot be reset; Remove drops the user's own", async () => {
    await show();
    click(row("low").querySelector(".pal-rules__head"));
    click(button("Reset to the extension's"));
    expect(writes.at(-1)).toEqual(["power/battery", "low", null]);
    click(row("warn").querySelector(".pal-rules__head"));
    expect((button("Reset to the extension's") as HTMLButtonElement).disabled).toBe(true);
    click(row("focus").querySelector(".pal-rules__head"));
    click(button("Remove rule"));
    expect(writes.at(-1)).toEqual(["power/battery", "focus", null]);
  });

  it("Add a rule wants an id and a condition, then writes them with hidden", async () => {
    await show();
    click(button("Add a rule"));
    expect((button("Add") as HTMLButtonElement).disabled).toBe(true);
    set(input("New rule id"), "Bad Id");
    expect(input("New rule id").getAttribute("aria-invalid")).toBe("true");
    set(input("New rule id"), "night");
    set(input("New rule condition"), "hour >= 22");
    click(button("Add"));
    expect(writes.at(-1)).toEqual(["power/battery", "night", { when: "hour >= 22", hidden: true }]);
    expect(el.querySelector('[data-testid="rule-add"]')).toBeNull();
  });
});
