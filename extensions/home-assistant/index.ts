// Home Assistant: entities as rows (live, so the states at the root are
// current; a thermostat takes its temperature and mode, a light its
// brightness and a media player its volume in the search bar), services
// as forms, areas as drill-ins. Everything is the REST
// API in ha.ts with the settings' URL, token and timeout; a request that
// fails is one hint row with the fix, never an error.
import { argsForm, errorMessage, hint, settings, toast, when, type Ctx, type Detail, type Effect, type Extension, type Form, type Item } from "@zcag/pal";
import { actions, asText, attributeRows, Client, climateArgs, coerce, domainOf, flatFields, HaError, HOUSE, haUrl, LEVEL_ARGS, name, order, row, selectorKind, SERVICE, serviceFormField, serviceRows, stateText, targets, titleCase, unconfigured, type Service, type ServiceDomain, type Settings, type State } from "./ha.ts";

const EXTENSION = "home-assistant";
/** `ctx.args` of the entities palette's drill-ins. */
type Args = { attributes?: string; area?: string };
const AREAS_TTL = 10 * 60_000;

let areaCache: { at: number; map: Record<string, string> } | undefined;

/** The client for the current settings, or the error a hint row shows. */
function client(): Client {
  const s = settings.get<Settings>();
  const bad = unconfigured(s);
  if (bad) throw bad;
  return new Client(s.url, s.token, Math.max(1, Number(s.timeout) || 5) * 1000);
}

/** The one row a broken setup lists: inert, with the fix in the subtitle. */
const problem = (e: unknown): Item[] => [hint("setup", e instanceof HaError ? e.message : `Home Assistant: ${errorMessage(e)}`, e instanceof HaError ? e.hint : undefined, { icon: "\u{f0026}" })];
const failed = (what: string, e: unknown): Effect => toast(`Could not ${what}`, e instanceof HaError ? `${e.message}. ${e.hint}` : errorMessage(e), "failure");

/** Entity id to area name, kept ten minutes; an HA that refuses the template API leaves the rows without areas. */
async function areas(c: Client, refresh = false): Promise<Record<string, string>> {
  if (!refresh && areaCache && Date.now() - areaCache.at < AREAS_TTL) return areaCache.map;
  let map: Record<string, string> = {};
  try { map = await c.areas(); } catch (e) { console.error(`[home-assistant] areas: ${errorMessage(e)}`); }
  areaCache = { at: Date.now(), map };
  return map;
}

/** One service call from a row; the toast names what changed. */
async function call(c: Client, id: string, service: string, data: Record<string, unknown> = {}): Promise<Effect> {
  const domain = domainOf(id);
  try {
    const changed = await c.call(domain, service, { entity_id: id, ...data });
    const me = changed.find((s) => s.entity_id === id);
    return toast(me ? `${name(me)}: ${stateText(me)}` : `${titleCase(domain)}.${service} sent`);
  } catch (e) {
    return failed(`${service.replace(/_/g, " ")} ${id}`, e);
  }
}

/**
 * A light's brightness or a media player's volume from the bar's field:
 * the service called with the percent; no values (a hotkey, `pal run`) is
 * the field as a form, and anything but 0..100 comes back on it.
 */
async function setLevel(c: Client, s: State, kind: "brightness" | "volume", values: Ctx["values"] | undefined): Promise<Effect> {
  const args = LEVEL_ARGS[domainOf(s.entity_id)];
  const form = (errors?: Record<string, string>): Effect => ({ form: { ...argsForm(args, `Set ${name(s)}`, { id: kind, title: kind === "brightness" ? "Set brightness" : "Set volume" }, errors), id: s.entity_id } });
  if (!values) return form();
  const raw = String(values[kind] ?? "").trim(), v = Number(raw);
  if (!raw || Number.isNaN(v) || v < 0 || v > 100) return form({ [kind]: "A percent, 0 to 100" });
  return kind === "brightness" ? call(c, s.entity_id, "turn_on", { brightness_pct: Math.round(v) }) : call(c, s.entity_id, "volume_set", { volume_level: Math.round(v) / 100 });
}

/** The thermostat's bar arguments as a page: for a pick without values (a hotkey, `pal run`), and for a value that is not a number (the message under the field). */
const temperatureForm = (s: State, errors?: Record<string, string>): Form => ({ ...argsForm(climateArgs(s), `Set ${name(s)}`, { id: "temperature", title: "Set" }, errors), id: s.entity_id });

/** The form for one service: the target as a select of the matching entities, then its fields. */
async function serviceForm(c: Client, id: string, errors?: Record<string, string>): Promise<Form> {
  const [domain, key] = [domainOf(id), id.slice(id.indexOf(".") + 1)];
  const [services, states] = await Promise.all([c.services(), c.states()]);
  const svc = services.find((d) => d.domain === domain)?.services[key];
  if (!svc) throw new HaError(`No service ${id}`, "Refresh the list with cmd+r");
  const entities = targets(svc, states);
  return {
    id,
    title: svc.name || `${titleCase(domain)}: ${titleCase(key)}`,
    fields: [
      ...(entities ? [{ kind: "select" as const, id: "entity_id", label: "Entity", required: true, options: entities.sort((a, b) => name(a).localeCompare(name(b))).map((s) => ({ id: s.entity_id, title: `${name(s)} (${s.entity_id})` })) }] : []),
      ...flatFields(svc.fields).map(([k, f]) => serviceFormField(k, f)),
    ],
    submit: { id: "call", title: `Call ${id}` },
    errors,
  };
}

async function callService(c: Client, id: string, ctx?: Ctx): Promise<Effect> {
  const [domain, key] = [domainOf(id), id.slice(id.indexOf(".") + 1)];
  const values = ctx?.values ?? {};
  let svc: Service | undefined;
  try { svc = (await c.services()).find((d: ServiceDomain) => d.domain === domain)?.services[key]; } catch (e) { return failed(`call ${id}`, e); }
  const kinds = Object.fromEntries(flatFields(svc?.fields).map(([k, f]) => [k, selectorKind(f)]));
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === "" || v === false) continue;
    const kind = kinds[k] ?? "text";
    const value = coerce(kind, v);
    if (kind === "number" && Number.isNaN(value)) { errors[k] = "Not a number"; continue; }
    data[k] = value;
  }
  if (Object.keys(errors).length) return { form: await serviceForm(c, id, errors) };
  try {
    const changed = await c.call(domain, key, data);
    return { toast: { title: `Called ${id}`, message: changed.length ? `${changed.length} ${changed.length === 1 ? "entity" : "entities"} changed: ${changed.map(name).join(", ").slice(0, 120)}` : undefined, style: "success" } };
  } catch (e) {
    return failed(`call ${id}`, e);
  }
}

/** A pick on an entity row or one of its drill-ins; a request that fails is a toast, so the caller wraps this. */
async function pickEntity(id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect | void> {
  const args = (ctx?.args ?? {}) as Args;
  if (id === "hint:setup") return;
  const c = client();
  // The attribute level: every row copies its value (or its name).
  if (args.attributes) {
    const s = await c.state(args.attributes);
    return { copy: action === "copy_key" ? id : id === "state" ? s.state : asText(s.attributes[id]) };
  }
  // No action id (an item hotkey, a bare pick): the row's primary action.
  const act = action ?? actions(await c.state(id))[0].id;
  /** A drill-in level, its crumb the entity's name. */
  const drill = async (args: Args) => ({ push: { extension: EXTENSION, palette: "entities", args, title: name(await c.state(id)) } });
  switch (act) {
    // The bar's values (or the form's, submitted back as `temperature`; `set_temperature` was the form's submit id before, a saved hotkey may carry it).
    case "temperature": case "set_temperature": {
      const v = ctx?.values;
      if (!v) return { form: temperatureForm(await c.state(id)) };
      const t = Number(String(v.temperature ?? "").trim());
      if (!String(v.temperature ?? "").trim() || Number.isNaN(t)) return { form: temperatureForm(await c.state(id), { temperature: "Not a number" }) };
      return call(c, id, "set_temperature", { temperature: t, ...(v.hvac_mode ? { hvac_mode: v.hvac_mode } : {}) });
    }
    case "brightness": case "volume": return setLevel(c, await c.state(id), act, ctx?.values);
    case "attributes": return drill({ attributes: id });
    case "copy_id": return { copy: id };
    case "copy_value": return { copy: (await c.state(id)).state };
    case "open_ha": { const s = await c.state(id); return { open: haUrl(c.url, s) }; }
  }
  const service = SERVICE[act];
  if (!service) return failed(act, new Error("unknown action"));
  return call(c, id, service);
}

export default {
  palettes: {
    entities: {
      title: "Home Assistant",
      live: true,
      placeholder: "Search entities",
      filters: [
        { id: "all", title: "All entities" }, { id: "every", title: "Every domain" }, { id: "light", title: "Lights" }, { id: "switch", title: "Switches" }, { id: "sensor", title: "Sensors" },
        { id: "binary_sensor", title: "Binary sensors" }, { id: "climate", title: "Climate" }, { id: "media_player", title: "Media players" },
        { id: "person", title: "People" }, { id: "script", title: "Scripts" }, { id: "automation", title: "Automations" }, { id: "scene", title: "Scenes" },
      ],
      list: async (_query, ctx): Promise<Item[]> => {
        const args = (ctx?.args ?? {}) as Args;
        let c: Client;
        try { c = client(); } catch (e) { return problem(e); }
        try {
          if (args.attributes) return attributeRows(await c.state(args.attributes));
          const [states, map] = await Promise.all([c.states(), areas(c, ctx?.refresh)]);
          const s = settings.get<Settings>();
          if (args.area) return states.filter((x) => map[x.entity_id] === args.area).sort((a, b) => name(a).localeCompare(name(b))).map((x) => row(x, args.area));
          return order(states, s, ctx?.filter).map((x) => row(x, map[x.entity_id]));
        } catch (e) {
          return problem(e);
        }
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        try { return await pickEntity(id, action, ctx); } catch (e) { return failed(`reach Home Assistant for ${id}`, e); }
      },
      detail: async (id, ctx): Promise<Detail | void> => {
        if ((ctx?.args as Args | undefined)?.attributes || id === "hint:setup") return;
        let s: State;
        try { s = await client().state(id); } catch { return; }
        const shown = Object.entries(s.attributes).filter(([k]) => k !== "friendly_name").slice(0, 12);
        return {
          metadata: [
            { label: "Entity", value: s.entity_id },
            { label: "State", value: stateText(s) },
            { label: "Changed", value: when(s.last_changed) },
            ...shown.map(([k, v]) => ({ label: titleCase(k), value: asText(v).slice(0, 80) })),
          ],
        };
      },
    },
    services: {
      title: "Home Assistant Services",
      placeholder: "Search services",
      list: async (): Promise<Item[]> => {
        try { return serviceRows(await client().services()); } catch (e) { return problem(e); }
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        if (id === "hint:setup") return;
        if (action === "copy_id") return { copy: id };
        let c: Client;
        try { c = client(); } catch (e) { return failed("reach Home Assistant", e); }
        if (action === "call" && ctx?.values) return callService(c, id, ctx);
        try { return { form: await serviceForm(c, id) }; } catch (e) { return failed(`describe ${id}`, e); }
      },
    },
    areas: {
      title: "Home Assistant Areas",
      placeholder: "Search areas",
      list: async (): Promise<Item[]> => {
        let c: Client;
        try { c = client(); } catch (e) { return problem(e); }
        try {
          const map = await c.areas();
          areaCache = { at: Date.now(), map };
          const counts = new Map<string, number>();
          for (const a of Object.values(map)) counts.set(a, (counts.get(a) ?? 0) + 1);
          return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([area, n]) => ({ id: area, name: area, subtitle: `${n} ${n === 1 ? "entity" : "entities"}`, icon: HOUSE, keywords: ["area"], actions: [{ id: "open", title: "Show entities" }] }));
        } catch (e) {
          return problem(e);
        }
      },
      pick: (id): Effect | void => (id === "hint:setup" ? undefined : { push: { extension: EXTENSION, palette: "entities", args: { area: id }, title: id } }),
    },
  },
} satisfies Extension;
