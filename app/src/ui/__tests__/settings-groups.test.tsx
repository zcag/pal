// @vitest-environment happy-dom
// Settings › Groups as used: a card per group with its members (the device
// each drives, one not installed or not running said so), who serves the
// volume and the inputs (only members that provide it offered, "each its
// own" unsetting), power as every member's; a device joins from the
// picker (one in another group moves); a name is committed on Enter; a new
// group starts from the field; the search finds a group by name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsGroups, groupsIndex, type DeviceGroup, type GroupDevice, type SettingsGroupsProps } from "../SettingsGroups";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const devices: GroupDevice[] = [
  { key: "appletv", title: "Apple TV", controls: ["volume", "power", "player"], device: "Living Room" },
  { key: "samsungtv", title: "Samsung TV", controls: ["volume", "power", "inputs", "player"], device: "75\" Neo QLED" },
  { key: "spotify", title: "Spotify", controls: ["volume", "player"], stopped: true },
];
const living: DeviceGroup = { id: "living-room", title: "Living room", members: ["appletv", "samsungtv", "lgtv"], volume: "samsungtv" };
const bedroom: DeviceGroup = { id: "bedroom", title: "Bedroom", members: ["spotify"] };
const empty: DeviceGroup = { id: "office", members: [] };

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const noop = () => {};
const show = (p: Partial<SettingsGroupsProps> = {}) => act(() => { root.render(<SettingsGroups groups={[living, bedroom, empty]} devices={devices} onCreate={noop} onRename={noop} onDelete={noop} onMembers={noop} onBind={noop} {...p} />); });
const card = (id: string) => el.querySelector<HTMLElement>(`[data-anchor="groups:${id}"]`)!;
const select = (s: HTMLSelectElement, value: string) => act(() => { s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });
const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent);

describe("SettingsGroups", () => {
  it("lists the members with the device each drives, and says which are missing or stopped", async () => {
    await show();
    const members = [...card("living-room").querySelectorAll(".pal-group__member")];
    expect(members.map((m) => m.querySelector(".pal-group__member-title")!.textContent)).toEqual(["Apple TV", "Samsung TV", "lgtv"]);
    expect(members[1].textContent).toContain("75\" Neo QLED");
    expect(members[2].textContent).toContain("not installed");
    expect(card("bedroom").textContent).toContain("not running");
  });
  it("offers each control's members that provide it, and power as every member's", async () => {
    const onBind = vi.fn();
    await show({ onBind });
    const vol = card("living-room").querySelector<HTMLSelectElement>('[aria-label="Volume of Living room"]')!;
    expect(vol.value).toBe("samsungtv");
    expect(options(vol)).toEqual(["Each its own", "Apple TV", "Samsung TV"]);
    select(vol, "");
    expect(onBind).toHaveBeenLastCalledWith("living-room", "volume", undefined);
    const inputs = card("living-room").querySelector<HTMLSelectElement>('[aria-label="Inputs of Living room"]')!;
    expect(options(inputs), "only the Samsung has inputs").toEqual(["Each its own", "Samsung TV"]);
    select(inputs, "samsungtv");
    expect(onBind).toHaveBeenLastCalledWith("living-room", "inputs", "samsungtv");
    expect(card("living-room").textContent).toContain("Every member: Apple TV, Samsung TV");
    expect(card("bedroom").textContent).toContain("No member has inputs");
  });
  it("adds a device from the picker, moving one out of another group, and removes one", async () => {
    const onMembers = vi.fn();
    await show({ onMembers });
    const add = card("office").querySelector<HTMLSelectElement>('[aria-label="Add a device to office"]')!;
    expect(options(add)).toEqual(["Add the first device…", "Apple TV (in Living room)", "Samsung TV (in Living room)", "Spotify (in Bedroom)"]);
    select(add, "spotify");
    expect(onMembers.mock.calls).toEqual([["bedroom", []], ["office", ["spotify"]]]);
    act(() => { card("living-room").querySelector<HTMLButtonElement>('[aria-label="Remove lgtv from Living room"]')!.click(); });
    expect(onMembers).toHaveBeenLastCalledWith("living-room", ["appletv", "samsungtv"]);
    expect(card("office").textContent).toContain("Add the devices you use together");
  });
  it("renames on Enter, creates from the field, deletes on the second click", async () => {
    const onRename = vi.fn(), onCreate = vi.fn(), onDelete = vi.fn();
    await show({ onRename, onCreate, onDelete });
    const name = card("bedroom").querySelector<HTMLInputElement>('[aria-label="Name of Bedroom"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Upstairs"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { name.focus(); name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onRename).toHaveBeenLastCalledWith("bedroom", "Upstairs");
    const field = el.querySelector<HTMLInputElement>('[aria-label="New group\'s name"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Kitchen"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { [...el.querySelectorAll("button")].find((b) => b.textContent === "New group")!.click(); });
    expect(onCreate).toHaveBeenLastCalledWith("Kitchen");
    const del = card("office").querySelector<HTMLButtonElement>('[aria-label="Delete office"]')!;
    act(() => del.click());
    expect(onDelete).not.toHaveBeenCalled();
    act(() => del.click());
    expect(onDelete).toHaveBeenLastCalledWith("office");
  });
  it("says what it is for with no devices and no groups; the search finds a group", async () => {
    await show({ groups: [], devices: [] });
    expect(el.querySelector(".pal-groups__none")!.textContent).toContain("Nothing here provides a control yet");
    expect(groupsIndex([living]).map((e) => [e.label, e.anchor])).toEqual([["Groups", undefined], ["Living room", "groups:living-room"]]);
  });
});
