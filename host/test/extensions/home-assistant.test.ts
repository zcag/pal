// Home Assistant: the pure helpers (ha.ts), then the extension over the
// wire against a Bun HTTP server standing in for HA (`/api/states`,
// `/api/services`, `/api/template`, service calls recorded and applied):
// rows, filters, accessories, the per-domain actions and what they post,
// the drill-ins, the climate and service forms and their submits, and the
// hint rows for an unset URL, a bad token, a dead host, a slow one, and a
// redirecting one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { coerce, flatFields, serviceFormField, targets, unconfigured, type ServiceDomain, type Settings, type State } from "../../../extensions/home-assistant/ha.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const E = "home-assistant";
const TOKEN = "secret";
const attrs = (friendly_name: string, rest: Record<string, unknown> = {}) => ({ friendly_name, ...rest });
const st = (entity_id: string, state: string, attributes: Record<string, unknown>, last_changed = "2026-09-16T10:00:00+00:00"): State => ({ entity_id, state, attributes, last_changed, last_updated: last_changed });

const states: State[] = [
  st("light.kitchen", "on", attrs("Kitchen", { brightness: 128, rgb_color: [255, 0, 0] })),
  st("light.hall", "off", attrs("Hall")),
  st("switch.fan", "on", attrs("Fan plug")),
  st("sensor.temp", "21.5", attrs("Temperature", { unit_of_measurement: "°C" })),
  st("binary_sensor.door", "off", attrs("Door")),
  st("climate.living", "heat", attrs("Living", { temperature: 21, hvac_modes: ["off", "heat"], min_temp: 7, max_temp: 30, temperature_unit: "°C" })),
  st("media_player.tv", "playing", attrs("TV", { volume_level: 0.3 })),
  st("cover.blind", "open", attrs("Blind")),
  st("lock.front", "locked", attrs("Front door")),
  st("scene.movie", "unknown", attrs("Movie")),
  st("script.morning", "off", attrs("Morning")),
  st("automation.night", "on", attrs("Night", { id: "abc123" })),
  st("person.me", "home", attrs("Me")),
  st("input_boolean.guest", "off", attrs("Guest mode")),
  st("vacuum.robo", "docked", attrs("Robo")),
  st("update.core", "off", attrs("Core update")),
];
const areas: Record<string, string> = { "light.kitchen": "Kitchen", "sensor.temp": "Kitchen", "light.hall": "Hall" };
const services: ServiceDomain[] = [
  { domain: "light", services: {
    turn_on: { target: { entity: [{ domain: ["light"] }] }, fields: {
      brightness_pct: { selector: { number: { min: 0, max: 100, unit_of_measurement: "%" } } },
      color_name: { selector: { select: { options: ["red", "blue"] } } },
      flash: { selector: { select: { options: [{ value: "short", label: "Short" }] } } },
      rgb_color: { example: "[255, 100, 100]", selector: { object: {} } },
      advanced_fields: { collapsed: true, fields: { xy_color: { selector: { object: {} } } } },
      more: { fields: { effect: { selector: { text: {} } } } },
    } },
    turn_off: { target: { entity: [{ domain: ["light"] }] } },
    toggle: { target: { entity: [{ domain: ["light"] }] } },
  } },
  { domain: "persistent_notification", services: { create: { fields: { message: { required: true, example: "Check it.", selector: { text: {} } }, title: { selector: { text: {} } }, urgent: { selector: { boolean: {} } } } } } },
  { domain: "homeassistant", services: { turn_on: { name: "Turn on", description: "Turns on anything.\nSecond line.", target: { entity: [{}] } } } },
];
const calls: { path: string; body: Record<string, unknown> }[] = [];
const ON_OFF: Record<string, string> = { turn_on: "on", turn_off: "off", lock: "locked", unlock: "unlocked", open_cover: "open", close_cover: "closed" };

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("401: Unauthorized", { status: 401 });
    if (u.pathname === "/api/states") return Response.json(states);
    const one = u.pathname.match(/^\/api\/states\/(.+)$/);
    if (one) { const s = states.find((x) => x.entity_id === one[1]); return s ? Response.json(s) : new Response("not found", { status: 404 }); }
    if (u.pathname === "/api/services" && req.method === "GET") return Response.json(services);
    if (u.pathname === "/api/template") return Response.json(areas);
    const call = u.pathname.match(/^\/api\/services\/([^/]+)\/(.+)$/);
    if (call && req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown>;
      calls.push({ path: `${call[1]}.${call[2]}`, body });
      const s = states.find((x) => x.entity_id === body.entity_id);
      if (!s) return Response.json([]);
      if (call[2] === "toggle") s.state = s.state === "on" ? "off" : "on";
      else if (ON_OFF[call[2]]) s.state = ON_OFF[call[2]];
      else if (call[2] === "set_temperature") s.attributes.temperature = body.temperature;
      return Response.json([s]);
    }
    return new Response("no", { status: 404 });
  },
});
const slow = Bun.serve({ port: 0, async fetch() { await Bun.sleep(2500); return Response.json([]); } });
const redirecting = Bun.serve({ port: 0, fetch(req) { return new Response(null, { status: 301, headers: { location: new URL(req.url).pathname.replace(/^/, `http://127.0.0.1:${server.port}`) } }); } });
const URL_ = `http://127.0.0.1:${server.port}`;
const base = { url: URL_, token: TOKEN, favorites: ["sensor.temp"], timeout: 2 };

let host: Host;
beforeAll(async () => { host = await Host.bundled({ settings: { [E]: { settings: base } } }); });
afterAll(() => { host.kill(); server.stop(true); slow.stop(true); redirecting.stop(true); });

const list = (ctx?: Parameters<Host["list"]>[3]) => host.list(E, "entities", "", ctx);
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick(E, "entities", id, action, ctx);
const lastCall = () => calls[calls.length - 1];

describe("manifest", () => {
  test("multi: a home is an instance; `url` and the token never inherit from the default", () => {
    const m = host.manifests.get(E)!;
    expect(m.multi).toBe(true);
    expect(m.settings!.filter((s) => s.kind === "secret" || s.scope === "instance").map((s) => s.id)).toEqual(["url", "token"]);
    expect((host.loaded().find((l) => l.extension === E) as any).instance).toEqual({ key: E, isDefault: true });
  });
});

describe("ha helpers", () => {
  const ok: Settings = { url: "http://ha", token: "t", domains: [], favorites: [], timeout: 5 };
  test("unconfigured: no url, a url without a scheme, no token, an unresolved reference", () => {
    expect(unconfigured(ok)).toBeUndefined();
    expect(unconfigured({ ...ok, url: "" })?.message).toBe("Home Assistant is not set up");
    expect(unconfigured({ ...ok, url: "ha.lan:8123" })?.message).toMatch(/http/);
    expect(unconfigured({ ...ok, token: "" })?.message).toBe("Token is not set");
    expect(unconfigured({ ...ok, token: "keychain:pal/ha" })?.hint).toMatch(/keychain:pal\/ha has no value/);
  });
  test("flatFields inlines a group and drops a collapsed one", () => {
    expect(flatFields(services[0].services.turn_on.fields).map(([k]) => k)).toEqual(["brightness_pct", "color_name", "flash", "rgb_color", "effect"]);
  });
  test("serviceFormField: select options in both spellings, boolean as checkbox, number range in the description, example as placeholder", () => {
    expect(serviceFormField("color_name", { selector: { select: { options: ["red", "blue"] } } })).toMatchObject({ kind: "select", label: "Color Name", options: [{ id: "red", title: "red" }, { id: "blue", title: "blue" }] });
    expect(serviceFormField("flash", { selector: { select: { options: [{ value: "short", label: "Short" }] } } })).toMatchObject({ kind: "select", options: [{ id: "short", title: "Short" }] });
    expect(serviceFormField("urgent", { selector: { boolean: {} } })).toMatchObject({ kind: "checkbox", default: false });
    expect(serviceFormField("brightness_pct", { selector: { number: { min: 0, max: 100, unit_of_measurement: "%" } } })).toMatchObject({ kind: "text", description: "(0..100 %)", required: false });
    expect(serviceFormField("message", { required: true, example: "Check it.", description: "Body.\nMore." })).toMatchObject({ kind: "text", required: true, placeholder: "Check it.", description: "Body." });
  });
  test("coerce: numbers, JSON, comma lists for entity selectors, booleans, the string otherwise", () => {
    expect(coerce("number", " 42 ")).toBe(42);
    expect(coerce("object", "[1, 2]")).toEqual([1, 2]);
    expect(coerce("text", "{\"a\":1}")).toEqual({ a: 1 });
    expect(coerce("text", "{not json")).toBe("{not json");
    expect(coerce("entity", "light.a, light.b")).toEqual(["light.a", "light.b"]);
    expect(coerce("entity", "light.a")).toBe("light.a");
    expect(coerce("boolean", "true")).toBe(true);
    expect(coerce("text", true)).toBe(true);
  });
  test("targets: the service's domains, every entity for a bare target, none without one", () => {
    expect(targets(services[0].services.turn_on, states)!.map((s) => s.entity_id)).toEqual(["light.kitchen", "light.hall"]);
    expect(targets(services[2].services.turn_on, states)).toHaveLength(states.length);
    expect(targets(services[1].services.create, states)).toBeUndefined();
  });
});

describe("entities", () => {
  test("rows: favourites first, then the domains in the settings' order, names sorted; a domain off the list is left out", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["sensor.temp", "light.hall", "light.kitchen", "switch.fan", "climate.living", "media_player.tv", "cover.blind", "lock.front", "scene.movie", "script.morning", "automation.night", "binary_sensor.door", "person.me", "input_boolean.guest"]);
    expect(items.map((i) => i.id)).not.toContain("vacuum.robo");
    expect(items.map((i) => i.id)).not.toContain("update.core");
  });
  test("a row: friendly name, domain and area, entity id and area as keywords, state and last change as accessories", async () => {
    const items = await list();
    const k = items.find((i) => i.id === "light.kitchen")!;
    expect(k).toMatchObject({ name: "Kitchen", subtitle: "Light · Kitchen", keywords: ["light.kitchen", "light", "Kitchen"], accessories: [{ tag: "on", color: "green" }, { date: "2026-09-16T10:00:00+00:00" }] });
    expect(k.icon).toBe("#ff0000");
    expect(items.find((i) => i.id === "light.hall")!.icon).toBe("\u{f0335}");
    expect(items.find((i) => i.id === "switch.fan")!.subtitle).toBe("Switch");
    expect(items.find((i) => i.id === "sensor.temp")!.accessories![0]).toEqual({ text: "21.5 °C" });
    expect(items.find((i) => i.id === "lock.front")!.accessories![0]).toEqual({ tag: "locked", color: "green" });
    expect(items.find((i) => i.id === "person.me")!.accessories![0]).toEqual({ tag: "home", color: "green" });
  });
  test("actions per domain, the common three closing every list", async () => {
    const items = await list();
    const ids = (id: string) => items.find((i) => i.id === id)!.actions!.map((a) => a.id);
    expect(ids("light.kitchen")).toEqual(["toggle", "on", "off", "brightness", "copy_id", "attributes", "open_ha"]);
    expect(ids("switch.fan")).toEqual(["toggle", "on", "off", "copy_id", "attributes", "open_ha"]);
    expect(ids("input_boolean.guest")).toEqual(["toggle", "on", "off", "copy_id", "attributes", "open_ha"]);
    expect(ids("climate.living")).toEqual(["temperature", "on", "off", "copy_id", "attributes", "open_ha"]);
    expect(ids("cover.blind")).toEqual(["close", "open", "stop", "copy_id", "attributes", "open_ha"]);
    expect(ids("lock.front")).toEqual(["unlock", "lock", "copy_id", "attributes", "open_ha"]);
    expect(items.find((i) => i.id === "lock.front")!.actions![0]).toMatchObject({ title: "Unlock", confirm: "Unlock Front door?" });
    // Show attributes is not on cmd+i, the shell's detail toggle; no two actions of a row share a key.
    for (const i of items) {
      const keys = i.actions!.flatMap((a) => (typeof a.shortcut === "string" ? [a.shortcut] : a.shortcut ?? []));
      expect(keys).not.toContain("cmd+i");
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(ids("media_player.tv")).toEqual(["play_pause", "next", "previous", "volume", "off", "copy_id", "attributes", "open_ha"]);
    expect(items.find((i) => i.id === "media_player.tv")!.actions![0].title).toBe("Pause");
    expect(ids("scene.movie")).toEqual(["activate", "copy_id", "attributes", "open_ha"]);
    expect(ids("script.morning")).toEqual(["run", "copy_id", "attributes", "open_ha"]);
    expect(ids("automation.night")).toEqual(["trigger", "off", "copy_id", "attributes", "open_ha"]);
    expect(items.find((i) => i.id === "automation.night")!.actions![1].title).toBe("Disable");
    expect(ids("sensor.temp")).toEqual(["copy_value", "copy_id", "attributes", "open_ha"]);
  });
  test("filters: a domain filter lists that domain alone, even one off the domains list; Every domain lists the rest after the chosen ones", async () => {
    expect((await list({ filter: "light" })).map((i) => i.id)).toEqual(["light.hall", "light.kitchen"]);
    const every = (await list({ filter: "every" })).map((i) => i.id);
    expect(every).toHaveLength(states.length);
    expect(every.slice(-2)).toEqual(["update.core", "vacuum.robo"]);
    host.changeSettings(E, { settings: { ...base, domains: ["light"] } });
    expect((await list()).map((i) => i.id)).toEqual(["sensor.temp", "light.hall", "light.kitchen"]);
    expect((await list({ filter: "scene" })).map((i) => i.id)).toEqual(["scene.movie"]);
    host.changeSettings(E, { settings: base });
  });
  test("toggle posts the service with the entity id, then keeps the palette open with the new state in a toast; a bare pick runs the primary", async () => {
    expect(await pick("light.hall", "toggle")).toEqual({ keep: true, toast: { title: "Hall: on" } });
    expect(lastCall()).toEqual({ path: "light.toggle", body: { entity_id: "light.hall" } });
    expect((await list()).find((i) => i.id === "light.hall")!.accessories![0]).toEqual({ tag: "on", color: "green" });
    expect(await pick("light.hall")).toMatchObject({ keep: true, toast: { title: "Hall: off" } });
    expect(lastCall().path).toBe("light.toggle");
    expect(await pick("switch.fan", "off")).toMatchObject({ toast: { title: "Fan plug: off" } });
    expect(lastCall()).toEqual({ path: "switch.turn_off", body: { entity_id: "switch.fan" } });
  });
  test("the rest of the per-domain actions map to their services", async () => {
    const expectCall = async (id: string, action: string, path: string) => { await pick(id, action); expect(lastCall()).toEqual({ path, body: { entity_id: id } }); };
    await expectCall("cover.blind", "close", "cover.close_cover");
    await expectCall("cover.blind", "stop", "cover.stop_cover");
    await expectCall("lock.front", "unlock", "lock.unlock");
    expect((await list()).find((i) => i.id === "lock.front")!.actions![0].id).toBe("lock");
    await expectCall("media_player.tv", "play_pause", "media_player.media_play_pause");
    await expectCall("media_player.tv", "next", "media_player.media_next_track");
    await expectCall("scene.movie", "activate", "scene.turn_on");
    await expectCall("script.morning", "run", "script.turn_on");
    await expectCall("automation.night", "trigger", "automation.trigger");
    await expectCall("automation.night", "off", "automation.turn_off");
    expect(await pick("sensor.temp", "nope")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });
  test("copy entity id, copy value, open in HA (history, or the editor for an automation or script)", async () => {
    expect(await pick("sensor.temp", "copy_id")).toEqual({ copy: "sensor.temp" });
    expect(await pick("sensor.temp", "copy_value")).toEqual({ copy: "21.5" });
    expect(await pick("sensor.temp")).toEqual({ copy: "21.5" });
    expect(await pick("sensor.temp", "open_ha")).toEqual({ open: `${URL_}/history?entity_id=sensor.temp` });
    expect(await pick("automation.night", "open_ha")).toEqual({ open: `${URL_}/config/automation/edit/abc123` });
    expect(await pick("script.morning", "open_ha")).toEqual({ open: `${URL_}/config/script/edit/morning` });
  });
  test("show attributes drills in: the state then every attribute, each copying its value or name", async () => {
    const r = await pick("light.kitchen", "attributes");
    expect(r).toEqual({ push: { extension: E, palette: "entities", args: { attributes: "light.kitchen" }, title: "Kitchen" } });
    const rows = await list({ args: { attributes: "light.kitchen" } });
    expect(rows.map((i) => [i.id, i.subtitle])).toEqual([["state", "on"], ["friendly_name", "Kitchen"], ["brightness", "128"], ["rgb_color", "[255,0,0]"]]);
    expect(await pick("rgb_color", "copy", { args: { attributes: "light.kitchen" } })).toEqual({ copy: "[255,0,0]" });
    expect(await pick("state", "copy", { args: { attributes: "light.kitchen" } })).toEqual({ copy: "on" });
    expect(await pick("brightness", "copy_key", { args: { attributes: "light.kitchen" } })).toEqual({ copy: "brightness" });
  });
  test("brightness and volume drill into presets; a preset posts the level", async () => {
    expect(await pick("light.kitchen", "brightness")).toEqual({ push: { extension: E, palette: "entities", args: { brightness: "light.kitchen" }, title: "Kitchen brightness" } });
    const rows = await list({ args: { brightness: "light.kitchen" } });
    expect(rows.map((i) => i.id)).toEqual(["current", "10", "25", "50", "75", "100"]);
    expect(rows[0]).toMatchObject({ name: "Kitchen", subtitle: "Brightness 50%", actions: [] });
    expect(rows[3].accessories).toEqual([{ tag: "current", color: "blue" }]);
    expect(rows[1].accessories).toBeUndefined();
    expect(await pick("75", "set", { args: { brightness: "light.kitchen" } })).toMatchObject({ keep: true });
    expect(lastCall()).toEqual({ path: "light.turn_on", body: { entity_id: "light.kitchen", brightness_pct: 75 } });
    expect(await pick("current", "set", { args: { brightness: "light.kitchen" } })).toEqual({});
    const vol = await list({ args: { volume: "media_player.tv" } });
    expect(vol[0].subtitle).toBe("Volume 30%");
    await pick("50", "set", { args: { volume: "media_player.tv" } });
    expect(lastCall()).toEqual({ path: "media_player.volume_set", body: { entity_id: "media_player.tv", volume_level: 0.5 } });
  });
  test("climate: Set temperature is a form with the current value and the modes; its submit posts set_temperature, a non-number comes back on the field", async () => {
    const r = await pick("climate.living", "temperature");
    const form = r.form as Form;
    expect(form).toMatchObject({ id: "climate.living", title: "Set Living", submit: { id: "set_temperature", title: "Set" } });
    expect(form.fields).toEqual([
      { kind: "text", id: "temperature", label: "Temperature", required: true, default: "21", placeholder: "21", description: "7..30 °C" },
      { kind: "select", id: "hvac_mode", label: "Mode", options: [{ id: "off", title: "Off" }, { id: "heat", title: "Heat" }], default: "heat" },
    ]);
    expect(await pick("climate.living", "set_temperature", { values: { temperature: "22.5", hvac_mode: "heat" } })).toMatchObject({ keep: true, toast: { title: "Living: heat" } });
    expect(lastCall()).toEqual({ path: "climate.set_temperature", body: { entity_id: "climate.living", temperature: 22.5, hvac_mode: "heat" } });
    const bad = await pick("climate.living", "set_temperature", { values: { temperature: "warm", hvac_mode: "heat" } });
    expect((bad.form as Form).errors).toEqual({ temperature: "Not a number" });
  });
  test("detail is lazy: the entity, its state and its attributes as metadata", async () => {
    const d = await host.detail(E, "entities", "light.kitchen");
    expect(d.metadata!.map((m) => m.label)).toEqual(["Entity", "State", "Changed", "Brightness", "Rgb Color"]);
    expect(d.metadata![1].value).toBe("on");
    expect(await host.detail(E, "entities", "brightness", { args: { attributes: "light.kitchen" } })).toEqual({});
  });
});

describe("services", () => {
  const spick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick(E, "services", id, action, ctx);
  test("rows: every service by domain then name, the service id as an accessory, a name and description when HA gives them", async () => {
    const items = await host.list(E, "services");
    expect(items.map((i) => i.id)).toEqual(["homeassistant.turn_on", "light.toggle", "light.turn_off", "light.turn_on", "persistent_notification.create"]);
    expect(items[3]).toMatchObject({ name: "Turn On", subtitle: "Light", icon: "\u{f0335}", keywords: ["light", "turn_on", "light.turn_on"], accessories: [{ text: "light.turn_on" }] });
    expect(items[0]).toMatchObject({ name: "Turn on", subtitle: "Homeassistant · Turns on anything." });
    expect(items[3].actions!.map((a) => a.id)).toEqual(["call", "copy_id"]);
    expect(await spick("light.turn_on", "copy_id")).toEqual({ copy: "light.turn_on" });
  });
  test("Enter is a form: the target as a select of the matching entities, then the fields (the collapsed group left out)", async () => {
    const r = await spick("light.turn_on", "call");
    const form = r.form as Form;
    expect(form).toMatchObject({ id: "light.turn_on", title: "Light: Turn On", submit: { id: "call", title: "Call light.turn_on" } });
    expect(form.fields.map((f) => [f.id, f.kind])).toEqual([["entity_id", "select"], ["brightness_pct", "text"], ["color_name", "select"], ["flash", "select"], ["rgb_color", "text"], ["effect", "text"]]);
    expect(form.fields[0]).toMatchObject({ required: true, options: [{ id: "light.hall", title: "Hall (light.hall)" }, { id: "light.kitchen", title: "Kitchen (light.kitchen)" }] });
    expect(form.fields[4]).toMatchObject({ placeholder: "[255, 100, 100]", description: "(JSON or comma separated)" });
    const every = (await spick("homeassistant.turn_on")).form as Form;
    expect((every.fields[0] as { options: unknown[] }).options).toHaveLength(states.length);
    const none = (await spick("persistent_notification.create")).form as Form;
    expect(none.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["message", "text", true], ["title", "text", false], ["urgent", "checkbox", false]]);
  });
  test("the submit posts the values coerced by selector, empty ones left out, and toasts what changed", async () => {
    const r = await spick("light.turn_on", "call", { values: { entity_id: "light.hall", brightness_pct: "40", color_name: "red", flash: "", rgb_color: "", effect: "" } });
    expect(r).toEqual({ toast: { title: "Called light.turn_on", message: "1 entity changed: Hall", style: "success" } });
    expect(lastCall()).toEqual({ path: "light.turn_on", body: { entity_id: "light.hall", brightness_pct: 40, color_name: "red" } });
    await spick("light.turn_on", "call", { values: { entity_id: "light.hall", brightness_pct: "", rgb_color: "[1, 2, 3]" } });
    expect(lastCall().body).toEqual({ entity_id: "light.hall", rgb_color: [1, 2, 3] });
    const pn = await spick("persistent_notification.create", "call", { values: { message: "hi", title: "", urgent: true } });
    expect(pn).toEqual({ toast: { title: "Called persistent_notification.create", style: "success" } });
    expect(lastCall()).toEqual({ path: "persistent_notification.create", body: { message: "hi", urgent: true } });
  });
  test("a number field that is not one comes back on the form, nothing posted", async () => {
    const n = calls.length;
    const r = await spick("light.turn_on", "call", { values: { entity_id: "light.hall", brightness_pct: "bright" } });
    expect((r.form as Form).errors).toEqual({ brightness_pct: "Not a number" });
    expect((r.form as Form).id).toBe("light.turn_on");
    expect(calls).toHaveLength(n);
  });
  test("a service that is gone is a failure toast, not an error", async () => {
    expect(await spick("light.nope")).toMatchObject({ keep: true, toast: { style: "failure", title: "Could not describe light.nope" } });
  });
});

describe("areas", () => {
  test("rows: every area with its entity count; Enter lists the area's entities", async () => {
    const items = await host.list(E, "areas");
    expect(items.map((i) => [i.id, i.subtitle])).toEqual([["Hall", "1 entity"], ["Kitchen", "2 entities"]]);
    expect(await host.pick(E, "areas", "Kitchen")).toEqual({ push: { extension: E, palette: "entities", args: { area: "Kitchen" }, title: "Kitchen" } });
    expect((await list({ args: { area: "Kitchen" } })).map((i) => [i.id, i.subtitle])).toEqual([["light.kitchen", "Light · Kitchen"], ["sensor.temp", "Sensor · Kitchen"]]);
  });
});

describe("when HA is not there", () => {
  const hintRow = async (palette = "entities") => { const items = await host.list(E, palette); expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ id: "hint:setup", actions: [] }); return items[0]; };
  test("no URL: one inert hint row naming the settings page, on every palette; a pick on it does nothing", async () => {
    host.changeSettings(E, { settings: { ...base, url: "" } });
    for (const p of ["entities", "services", "areas"]) expect((await hintRow(p)).subtitle).toContain("Settings › Extensions › Home Assistant");
    expect(await pick("hint:setup")).toEqual({});
    expect(await pick("light.hall", "toggle")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });
  test("a rejected token", async () => {
    host.changeSettings(E, { settings: { ...base, token: "wrong" } });
    expect((await hintRow()).name).toBe("Home Assistant rejected the token");
  });
  test("a host that does not answer: the hint within the timeout; a dead port: the hint at once", async () => {
    host.changeSettings(E, { settings: { ...base, url: `http://127.0.0.1:${slow.port}`, timeout: 1 } });
    const t0 = Date.now();
    expect((await hintRow()).name).toMatch(/did not answer within 1 s/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const dead = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = dead.port;
    dead.stop(true);
    host.changeSettings(E, { settings: { ...base, url: `http://127.0.0.1:${port}` } });
    expect((await hintRow()).name).toBe(`Could not reach http://127.0.0.1:${port}`);
  });
  test("a URL that redirects (http behind a proxy that answers 301 to https) is followed with the token kept, and the log says which URL to set", async () => {
    host.changeSettings(E, { settings: { ...base, url: `http://127.0.0.1:${redirecting.port}/` } });
    expect((await list()).map((i) => i.id)).toContain("light.kitchen");
    await host.untilStderr(`[home-assistant] http://127.0.0.1:${redirecting.port} redirects to ${URL_}; set that as the URL`);
    host.changeSettings(E, { settings: base });
  });
});
