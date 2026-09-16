// wifi against canned core/wifi.* replies. The extension reads
// `process.platform` at import: these tests describe the host they run on
// (macOS lists Available from the cache with a Scan row; Linux scans
// through nmcli's own cache), and assert per platform where they differ.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WifiKnown, WifiScan, WifiStatus } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import { bars } from "../../../extensions/wifi/index.ts";

const MAC = process.platform === "darwin";
let status: WifiStatus = { interface: "en0", powered: true, current: { ssid: "eldiven", signal: 92, channel: "44", security: "WPA2", ip: "192.168.1.131" } };
const known: WifiKnown[] = [{ ssid: "eldiven", security: null }, { ssid: "marvin", security: null }, { ssid: "Cafe Wifi", security: null }];
let scan: WifiScan = {
  networks: [
    { ssid: "eldiven", signal: 92, channel: "44", security: "WPA2", known: true, current: true },
    { ssid: "marvin", signal: 60, channel: "6", security: "WPA2", known: true, current: false },
    { ssid: "Open Cafe", signal: 55, channel: "1", security: null, known: false, current: false },
    { ssid: "Neighbour", signal: 30, channel: "11", security: "WPA2", known: false, current: false },
  ],
  hidden: 2,
  age_secs: 12,
};
const calls: { method: string; params: any }[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "wifi.status": () => status,
      "wifi.known": () => known,
      "wifi.scan": (p) => { calls.push({ method: "scan", params: p }); return scan; },
      "wifi.join": (p) => { calls.push({ method: "join", params: p }); if (p.ssid === "Neighbour" && p.password !== "hunter2") throw new Error("networksetup: Failed to join network Neighbour"); return null; },
      "wifi.forget": (p) => { calls.push({ method: "forget", params: p }); return null; },
      "wifi.password": (p) => { if (p.ssid === "marvin") throw new Error("no saved password for marvin"); return "s3cret"; },
      "wifi.set_power": (p) => { calls.push({ method: "set_power", params: p }); status = { ...status, powered: p.on, current: p.on ? status.current : null }; return null; },
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("wifi", "wifi");
const pick = (id: string, action?: string, values?: Record<string, string | boolean>) => host.pick("wifi", "wifi", id, action, values ? { values } : undefined);

describe("wifi", () => {
  test("meta: live", () => {
    expect(host.loaded().find((l) => l.extension === "wifi")!.palettes).toMatchObject([{ name: "wifi", title: "Wi-Fi", live: true, input: false }]);
  });

  test("signal bars", () => {
    expect([bars(100), bars(75), bars(51), bars(25), bars(1), bars(0)]).toEqual(["▂▄▆█", "▂▄▆", "▂▄▆", "▂", "▂", "▂"]);
  });

  test("sections: Current, Known (in-range ones tagged), Available, the Scan row on macOS, the power row", async () => {
    const items = await list();
    expect(calls.at(-1)).toEqual({ method: "scan", params: { mode: MAC ? "cached" : "auto" } });
    const bySection = (s: string) => items.filter((i) => i.section === s).map((i) => i.id);
    expect(bySection("Current")).toEqual(["current:eldiven"]);
    expect(items[0]).toMatchObject({ name: "eldiven", subtitle: "192.168.1.131 · channel 44 · WPA2", accessories: [{ text: "▂▄▆█ 92%" }, { tag: "connected", color: "green" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["copy_ip", "password", "forget"]);
    expect(bySection("Known")).toEqual(["known:marvin", "known:Cafe Wifi"]);
    const marvin = items.find((i) => i.id === "known:marvin")!;
    expect(marvin).toMatchObject({ subtitle: "WPA2 · channel 6", accessories: [{ text: "▂▄▆ 60%" }, { tag: "in range", color: "blue" }] });
    expect(marvin.actions!.map((a) => a.id)).toEqual(["join", "password", "forget"]);
    expect(marvin.actions![2]).toMatchObject({ style: "destructive", confirm: "Forget marvin? Its password goes with it." });
    expect(items.find((i) => i.id === "known:Cafe Wifi")).toMatchObject({ subtitle: "Saved", accessories: [] });
    expect(bySection("Available")).toEqual(["net:Open Cafe", "net:Neighbour", "scan"]);
    expect(items.find((i) => i.id === "net:Open Cafe")).toMatchObject({ subtitle: "Open · channel 1", accessories: [{ text: "▂▄▆ 55%" }] });
    expect(items.find((i) => i.id === "scan")!.subtitle).toBe(MAC ? "scanned 12 s ago · 2 nearby with names hidden by macOS · takes a few seconds" : "scanned 12 s ago · 2 nearby with names hidden by macOS");
    expect(items.at(-1)).toMatchObject({ id: "power", name: "Turn Wi-Fi Off", section: "Wi-Fi" });
  });

  test("a hidden current name (macOS without Location Services) still lists with its details", async () => {
    const saved = status;
    status = { ...status, current: { ssid: null, signal: null, channel: "44", security: "WPA2_PSK", ip: "10.0.0.5" } };
    try {
      const cur = (await list())[0];
      expect(cur).toMatchObject({ id: "current:", name: "Connected network", subtitle: "10.0.0.5 · channel 44 · WPA2_PSK · name hidden by macOS without Location Services", accessories: [{ tag: "connected", color: "green" }] });
      expect(cur.actions!.map((a) => a.id)).toEqual(["copy_ip"]);
    } finally {
      status = saved;
    }
  });

  test("join: a known network joins at once, a secured new one gets a password form, a wrong password shows it again", async () => {
    expect(await pick("known:marvin")).toEqual({ hud: "Joined marvin" });
    expect(calls.at(-1)).toEqual({ method: "join", params: { ssid: "marvin" } });
    expect(await pick("net:Open Cafe", "join")).toEqual({ hud: "Joined Open Cafe" });
    const form = await pick("net:Neighbour");
    expect(form.form).toMatchObject({ id: "net:Neighbour", title: "Join Neighbour", submit: { id: "join_with", title: "Join" } });
    expect(form.form!.fields.map((f) => f.kind)).toEqual(["password"]);
    const again = await pick("net:Neighbour", "join_with", { password: "wrong" });
    expect(again.form!.errors).toEqual({ password: "networksetup: Failed to join network Neighbour" });
    expect(await pick("net:Neighbour", "join_with", { password: "hunter2" })).toEqual({ hud: "Joined Neighbour" });
    expect(calls.at(-1)).toEqual({ method: "join", params: { ssid: "Neighbour", password: "hunter2" } });
  });

  test("copy password, copy IP, copy name; a missing password is a toast", async () => {
    expect(await pick("known:Cafe Wifi", "password")).toEqual({ copy: "s3cret" });
    expect(await pick("known:marvin", "password")).toEqual({ keep: true, toast: { title: "Could not read the password", message: "no saved password for marvin", style: "failure" } });
    expect(await pick("current:eldiven", "copy_ip")).toEqual({ copy: "192.168.1.131" });
    expect(await pick("net:Neighbour", "copy")).toEqual({ copy: "Neighbour" });
  });

  test("forget goes to the core and keeps the palette with a toast", async () => {
    expect(await pick("known:Cafe Wifi", "forget")).toEqual({ keep: true, toast: { title: "Forgot Cafe Wifi", style: "success" } });
    expect(calls.at(-1)).toEqual({ method: "forget", params: { ssid: "Cafe Wifi" } });
  });

  test("scan row runs a fresh scan; the power row flips the radio, and off lists only itself", async () => {
    expect(await pick("scan")).toEqual({ keep: true });
    expect(calls.at(-1)).toEqual({ method: "scan", params: { mode: "fresh" } });
    expect(await pick("power")).toEqual({ keep: true });
    expect(calls.at(-1)).toEqual({ method: "set_power", params: { on: false } });
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["power"]);
    expect(items[0].name).toBe("Turn Wi-Fi On");
    expect(await pick("power")).toEqual({ keep: true });
    expect(status.powered).toBe(true);
  });

  test("no interface: one inert row", async () => {
    const h = await Host.bundled({ core: { "wifi.status": () => ({ interface: null, powered: false, current: null }) } });
    try {
      expect(await h.list("wifi", "wifi")).toMatchObject([{ id: "error", name: "No Wi-Fi interface", actions: [] }]);
    } finally {
      h.kill();
    }
  });
});
