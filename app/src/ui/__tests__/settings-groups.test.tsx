// @vitest-environment happy-dom
// Settings › Groups as used: no groups starts with New group, which makes
// "Living room" at once and asks which devices; a device offered by a
// registry installs on a pick and joins; joining binds the sound and the
// inputs to the TV with no pick needed; members show the device each drives,
// one missing with Install; "Sound comes from" / "Inputs come from" offer
// only members that have it and hide when none does; power lists who turns
// on together; a name commits on Enter; the search finds a group by name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsGroups, bindingsOnJoin, groupsIndex, isDevice, nextTitle, type DeviceGroup, type DeviceOffer, type GroupControl, type GroupDevice, type SettingsGroupsProps } from "../SettingsGroups";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apple: GroupDevice = { key: "appletv", title: "Apple TV", controls: ["volume", "power", "player"], device: "Living Room" };
const samsung: GroupDevice = { key: "samsungtv", title: "Samsung TV", controls: ["volume", "power", "inputs", "player"], device: "75\" Neo QLED" };
const samsungOffer: DeviceOffer = { name: "samsungtv", title: "Samsung TV", controls: ["volume", "power", "inputs", "player"] };
const living: DeviceGroup = { id: "living-room", title: "Living room", members: ["appletv", "samsungtv"], volume: "samsungtv", inputs: "samsungtv" };

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const noop = () => {};
const show = (p: Partial<SettingsGroupsProps> = {}) => act(() => { root.render(<SettingsGroups groups={[living]} devices={[apple, samsung]} onCreate={noop} onRename={noop} onDelete={noop} onMembers={noop} onBind={noop} {...p} />); });
const card = (id: string) => el.querySelector<HTMLElement>(`[data-anchor="groups:${id}"]`)!;
const select = (s: HTMLSelectElement, value: string) => act(() => { s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });
const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent);
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const click = async (b: HTMLElement) => { await act(async () => { b.click(); }); };

describe("SettingsGroups", () => {
  it("names a new group Living room, then Group 2, and only devices (not a player alone) can join", () => {
    expect(nextTitle([])).toBe("Living room");
    expect(nextTitle([living])).toBe("Group 2");
    expect(nextTitle([living, { id: "group-2", title: "Group 2", members: [] }])).toBe("Group 3");
    expect(isDevice(["player"])).toBe(false);
    expect(isDevice(["volume", "player"])).toBe(true);
  });

  it("binds the sound and the inputs to the TV on join, taking the sound over from a box without inputs", () => {
    const of = (k: string): GroupControl[] => (k === "samsungtv" ? samsung.controls : apple.controls);
    expect(bindingsOnJoin({ id: "g", members: [] }, "appletv", apple.controls, of)).toEqual({ volume: "appletv" });
    expect(bindingsOnJoin({ id: "g", members: ["appletv"], volume: "appletv" }, "samsungtv", samsung.controls, of)).toEqual({ volume: "samsungtv", inputs: "samsungtv" });
    expect(bindingsOnJoin({ id: "g", members: ["samsungtv"], volume: "samsungtv", inputs: "samsungtv" }, "appletv", apple.controls, of)).toEqual({});
  });

  it("starts with New group, which creates Living room and asks which devices, an offered one installing then joining with the TV serving", async () => {
    const calls: string[] = [];
    let groups: DeviceGroup[] = [];
    let devices: GroupDevice[] = [apple];
    const render = () => show({ groups, devices, offers: devices.some((d) => d.key === "samsungtv") ? [] : [samsungOffer], onCreate, onMembers, onBind, onInstall });
    const onCreate = vi.fn((title: string) => { groups = [{ id: "living-room", title, members: [] }]; render(); return "living-room"; });
    const onMembers = vi.fn(async (id: string, members: string[]) => { calls.push(`members ${members.join(",")}`); groups = groups.map((g) => (g.id === id ? { ...g, members } : g)); });
    const onBind = vi.fn(async (id: string, control: "volume" | "inputs", m: string | undefined) => { calls.push(`${control} ${m}`); groups = groups.map((g) => (g.id === id ? { ...g, [control]: m } : g)); });
    const onInstall = vi.fn(async (name: string) => { calls.push(`install ${name}`); devices = [...devices, samsung]; });
    await render();
    expect(el.textContent).toContain("No groups yet.");
    await click(button(el, "New group"));
    expect(onCreate).toHaveBeenCalledWith("Living room");
    const picks = [...card("living-room").querySelectorAll<HTMLButtonElement>(".pal-group__pickbtn")];
    expect(picks.map((p) => p.textContent)).toEqual(["Apple TVLiving Room", "Samsung TVInstall"]);
    await click(picks[0]);
    await render();
    await click(button(card("living-room"), "Add a device"));
    await click(button(card("living-room"), "Samsung TV"));
    expect(calls).toEqual(["members appletv", "volume appletv", "install samsungtv", "members appletv,samsungtv", "volume samsungtv", "inputs samsungtv"]);
  });

  it("lists the members with the device each drives, one not installed with Install", async () => {
    const onInstall = vi.fn(async () => {});
    await show({ devices: [apple], offers: [samsungOffer], onInstall });
    const members = [...card("living-room").querySelectorAll(".pal-group__member")];
    expect(members.map((m) => m.querySelector(".pal-group__member-title")!.textContent)).toEqual(["Apple TV", "Samsung TV"]);
    expect(members[0].textContent).toContain("Living Room");
    await click(button(members[1], "Install"));
    expect(onInstall).toHaveBeenCalledWith("samsungtv");
  });

  it("says where the sound and the inputs come from, only among members that have them, and who powers together", async () => {
    const onBind = vi.fn();
    await show({ onBind });
    const sound = card("living-room").querySelector<HTMLSelectElement>('[aria-label="Sound of Living room"]')!;
    expect(sound.value).toBe("samsungtv");
    expect(options(sound)).toEqual(["Each its own", "Apple TV", "Samsung TV"]);
    select(sound, "");
    expect(onBind).toHaveBeenLastCalledWith("living-room", "volume", undefined);
    const inputs = card("living-room").querySelector<HTMLSelectElement>('[aria-label="Inputs of Living room"]')!;
    expect(options(inputs), "only the Samsung has inputs").toEqual(["Each its own", "Samsung TV"]);
    expect(card("living-room").textContent).toContain("Apple TV and Samsung TV turn on and off together");
    await show({ groups: [{ id: "bed", title: "Bed", members: ["appletv"] }] });
    expect(card("bed").querySelector('[aria-label="Inputs of Bed"]'), "no member has inputs: no row").toBeNull();
  });

  it("removes a member, renames on Enter, and deletes on a second click", async () => {
    const onMembers = vi.fn(), onRename = vi.fn(), onDelete = vi.fn();
    await show({ onMembers, onRename, onDelete });
    await click(card("living-room").querySelector<HTMLButtonElement>('[aria-label="Remove Apple TV from Living room"]')!);
    expect(onMembers).toHaveBeenCalledWith("living-room", ["samsungtv"]);
    const title = card("living-room").querySelector<HTMLInputElement>('[aria-label="Name of Living room"]')!;
    act(() => {
      title.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Den");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onRename).toHaveBeenCalledWith("living-room", "Den");
    const del = card("living-room").querySelector<HTMLButtonElement>('[aria-label="Delete Living room"]')!;
    await click(del);
    expect(onDelete).not.toHaveBeenCalled();
    await click(del);
    expect(onDelete).toHaveBeenCalledWith("living-room");
  });

  it("is found by the search, the page and each group by name", () => {
    expect(groupsIndex([living]).map((e) => e.label)).toEqual(["Groups", "Living room"]);
  });
});
