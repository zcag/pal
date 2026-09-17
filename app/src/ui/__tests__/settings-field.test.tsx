// @vitest-environment happy-dom
// A declared number setting refuses what its spec cannot take (out of
// range, not a number) with the reason under the box and no write, the
// rule `specs::check` applies to a write from code; a good value is
// written at once, an emptied box unsets.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsField, numberProblem } from "../SettingsField";
import type { SettingSpec, SettingValue } from "../SettingsTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spec: Extract<SettingSpec, { kind: "number" }> = { id: "timeout", label: "Timeout", kind: "number", min: 1, max: 60, unit: "s", default: 30 };

describe("numberProblem", () => {
  it("names the range, the bound, or the non-number; an empty box is fine", () => {
    expect(numberProblem(spec, "0")).toBe("Between 1 and 60");
    expect(numberProblem(spec, "61")).toBe("Between 1 and 60");
    expect(numberProblem({ ...spec, max: undefined }, "0")).toBe("At least 1");
    expect(numberProblem({ ...spec, min: undefined }, "99")).toBe("At most 60");
    expect(numberProblem(spec, "abc")).toBe("Not a number");
    expect(numberProblem(spec, "")).toBeUndefined();
    expect(numberProblem(spec, "30")).toBeUndefined();
  });
});

let root: Root, el: HTMLDivElement;
const writes: SettingValue[] = [];
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); writes.length = 0; });
afterEach(() => { act(() => root.unmount()); el.remove(); });
const mount = (value: SettingValue) => act(() => { root.render(<SettingsField spec={spec} value={value} onChange={(v) => writes.push(v)} />); });
const input = () => el.querySelector<HTMLInputElement>("input")!;
const type = (v: string) => act(() => { const i = input(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); });

describe("SettingsField number", () => {
  it("refuses an out-of-range value with the reason and writes nothing; a good one is written; empty unsets", async () => {
    await mount(30);
    await type("99");
    expect(writes).toEqual([]);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Between 1 and 60");
    expect(input().value).toBe("99");
    await type("45");
    expect(writes).toEqual([45]);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    await type("");
    expect(writes).toEqual([45, undefined]);
  });
});
