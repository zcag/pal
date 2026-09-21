// Docker: three live palettes over the docker CLI's `--format '{{json .}}'` output. Containers, running
// first (Enter starts a stopped one and stops a running one, after a
// confirm); images, run with a name and ports typed in the bar; Compose
// projects. Podman works
// through the same commands (`binary = "podman"`, or its `docker` alias).
// Without the binary, or with the daemon down, one inert hint row says so.
// Logs open as a `show` level; Shell opens a terminal (the SDK's `terminal`).
import { basename, dirname } from "node:path";
import { argsForm, hint as hintRow, settings, terminal, tilde, toast, type Accessory, type Action, type Arg, type Detail, type Extension, type Item, type Metadata, type TagColor } from "@zcag/pal";

/** `[extensions.docker]`, defaults in pal.json. */
type Settings = { binary: string; ttl: number; terminal: terminal.Choice };
const S = () => settings.get<Settings>();
/** `ttl` is palette meta, read once at load (a change takes effect on the next reload). */
const TTL = S().ttl;

/** The whale (md-docker), the extension's own icon, on every row. */
const ICON = "\u{f0868}";
const LOG_LINES = 200;
const LIST_MS = 8_000;
/** The core drops a pick unanswered after 10 s: a slower command (a `stop` whose process ignores SIGTERM, a `compose up` that pulls) goes on without us and the toast says so. */
const WAIT_MS = 8_000;
const ACT_MS = 60_000;
/** `compose up` may pull. */
const COMPOSE_MS = 600_000;

// ---- cli ------------------------------------------------------------------

/** `pending`: still running when `WAIT_MS` passed; it goes on by itself (killed at `ms`). */
type Run = { code: number; out: string; err: string; pending?: true };

/** One docker command, answered within `WAIT_MS`, killed after `ms`; never throws. */
async function docker(args: string[], ms: number): Promise<Run> {
  const bin = Bun.which(S().binary || "docker");
  if (!bin) return { code: 127, out: "", err: "not installed" };
  const proc = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), ms);
  const outP = new Response(proc.stdout).text(), errP = new Response(proc.stderr).text();
  const code = await Promise.race([proc.exited, Bun.sleep(WAIT_MS).then(() => undefined)]);
  if (code === undefined) { proc.exited.then(() => clearTimeout(timer)); proc.unref(); return { code: -1, out: "", err: "", pending: true }; }
  const [out, err] = await Promise.all([outP, errP]);
  clearTimeout(timer);
  return { code, out, err: err.trim() };
}

/** The toast for a command that is still going: the palette lists again (⌘R later shows the outcome). */
const pending = (what: string) => ({ keep: true as const, toast: { title: `${what} not done yet`, message: `Still running after ${WAIT_MS / 1000} s; it goes on in the background` } });

/** `{{json .}}` prints one object per line (a whole array on some podman versions). */
function rows<T>(out: string): T[] {
  const t = out.trim();
  if (!t) return [];
  if (t.startsWith("[")) { try { return JSON.parse(t) as T[]; } catch { return []; } }
  return t.split("\n").flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } });
}

const hint = (name: string, subtitle: string): Item => hintRow(name, name, subtitle, { icon: ICON });

/** The row a failed listing shows instead of nothing: no binary, or a daemon that is not answering. */
function failed(r: Run): Item[] {
  const bin = S().binary || "docker";
  if (r.code === 127 && r.err === "not installed") return [hint(`${bin} is not installed`, bin === "docker" ? "Install Docker (or Podman and set the binary setting)" : `${bin} is not on PATH`)];
  const line = r.err.split("\n")[0] || `${bin} exited ${r.code}`;
  return [hint(/cannot connect|is the docker daemon running|connection refused/i.test(line) ? "Docker is not running" : `${bin} failed`, line)];
}

const fail = (title: string, r: Run) => toast(title, r.err.split("\n").slice(-1)[0] || `exit ${r.code}`, "failure");

/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string) => "````\n" + s.replace(/````/g, "```​`") + "\n````";
const trailing = (out: string) => out.replace(/\n+$/, "");

async function logs(title: string, args: string[]): Promise<{ show: Detail & { title: string } }> {
  const r = await docker(args, LIST_MS);
  const text = trailing([trailing(r.out), r.err].filter(Boolean).join("\n"));
  return { show: { title, markdown: text ? fence(text) : "_No output._" } };
}

// ---- containers ------------------------------------------------------------

/** `docker ps --format '{{json .}}'`; podman gives `Names` and `Ports` as arrays. */
type PsRow = { ID: string; Names: string | string[]; Image: string; State: string; Status: string; Ports: string | { host_port?: number; container_port?: number; protocol?: string }[]; Command?: string; CreatedAt?: string; RunningFor?: string; Labels?: string; Mounts?: string; Networks?: string; Size?: string };

const STATE_COLOR: Record<string, TagColor> = { running: "green", exited: "grey", paused: "amber", restarting: "amber", created: "blue", dead: "red", removing: "red" };
const names = (n: PsRow["Names"]) => (Array.isArray(n) ? n.join(", ") : n).replace(/^\//, "");

/** Published ports, compact: `80` when host and container agree, `8080:80` otherwise, unpublished ones dropped. */
function ports(p: PsRow["Ports"]): string {
  const seen = new Set<string>();
  const entries = Array.isArray(p) ? p.filter((e) => e.host_port).map((e) => `${e.host_port}->${e.container_port}`) : p.split(",").map((s) => s.trim()).filter((s) => s.includes("->"));
  for (const e of entries) {
    const [h, c] = e.split("->");
    const hp = h.slice(h.lastIndexOf(":") + 1), cp = c.replace(/\/\w+$/, "");
    seen.add(hp === cp ? hp : `${hp}:${cp}`);
  }
  const all = [...seen];
  return all.slice(0, 4).join(", ") + (all.length > 4 ? ` +${all.length - 4}` : "");
}

/** State by id from the last listing: Enter (no action id) toggles on it. */
const running = new Map<string, boolean>();

const project = (labels = "") => labels.split(",").find((l) => l.startsWith("com.docker.compose.project="))?.split("=")[1];

const RUNNING: Action[] = [
  { id: "stop", title: "Stop", confirm: "Stop this container?" },
  { id: "logs", title: "Logs", shortcut: "cmd+l" },
  { id: "shell", title: "Shell", shortcut: "cmd+t" },
  { id: "restart", title: "Restart", shortcut: "cmd+shift+r" },
  { id: "remove", title: "Remove", shortcut: "cmd+d", style: "destructive", confirm: "Remove this container? It is stopped first; its writable layer is lost." },
  { id: "copy-id", title: "Copy id", shortcut: "cmd+c" },
];
const STOPPED: Action[] = [
  { id: "start", title: "Start" },
  { id: "logs", title: "Logs", shortcut: "cmd+l" },
  { id: "remove", title: "Remove", shortcut: "cmd+d", style: "destructive", confirm: "Remove this container? Its writable layer is lost." },
  { id: "copy-id", title: "Copy id", shortcut: "cmd+c" },
];

function container(r: PsRow): Item {
  const name = names(r.Names);
  const up = r.State === "running";
  running.set(r.ID, up);
  const p = ports(r.Ports ?? "");
  const proj = project(r.Labels);
  const accessories: Accessory[] = [];
  if (p) accessories.push({ text: p });
  if (r.Status) accessories.push({ text: r.Status });
  accessories.push({ tag: r.State, color: STATE_COLOR[r.State] ?? "grey" });
  const metadata: Metadata[] = [
    { label: "Id", value: r.ID },
    { label: "Image", value: r.Image },
    ...(r.Command ? [{ label: "Command", value: r.Command.replace(/^"|"$/g, "") }] : []),
    { label: "Status", value: r.Status },
    ...(r.CreatedAt ? [{ label: "Created", value: r.CreatedAt }] : []),
    ...(typeof r.Ports === "string" && r.Ports ? [{ label: "Ports", value: r.Ports }] : []),
    ...(r.Mounts ? [{ label: "Mounts", value: r.Mounts }] : []),
    ...(r.Networks ? [{ label: "Networks", value: r.Networks }] : []),
    ...(proj ? [{ label: "Compose project", value: proj }] : []),
  ];
  return {
    id: r.ID,
    name,
    subtitle: r.Image,
    icon: ICON,
    keywords: [r.ID, r.Image, ...(proj ? [proj] : [])],
    accessories,
    detail: { metadata },
    section: up ? "Running" : "Stopped",
    actions: up ? RUNNING : STOPPED,
    state: r.State,
  };
}

async function listContainers(): Promise<Item[]> {
  const r = await docker(["ps", "-a", "--format", "{{json .}}"], LIST_MS);
  if (r.code !== 0) return failed(r);
  const items = rows<PsRow>(r.out).map(container);
  if (!items.length) return [hint("No containers", "Run an image from Docker Images and it lists here")];
  // Running first; docker's order (newest first) within each.
  return [...items.filter((i) => i.section === "Running"), ...items.filter((i) => i.section !== "Running")];
}

async function pickContainer(id: string, action?: string) {
  action ??= running.get(id) ? "stop" : "start";
  switch (action) {
    case "copy-id": return { copy: id };
    case "logs": return logs(`Logs ${id}`, ["logs", "--tail", String(LOG_LINES), id]);
    case "shell": {
      const bin = S().binary || "docker";
      // bash when the image has it, sh otherwise.
      const why = terminal.open([bin, "exec", "-it", id, "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash; exec sh"], S().terminal);
      return why ? toast("Could not open a terminal", why, "failure") : {};
    }
    case "remove": {
      const r = await docker(["rm", "-f", id], ACT_MS);
      return r.pending ? pending(`Removing ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `Removed ${id}` } } : fail("Could not remove", r);
    }
    case "start": case "stop": case "restart": {
      const r = await docker([action, id], ACT_MS);
      const done = { start: "Started", stop: "Stopped", restart: "Restarted" }[action];
      return r.pending ? pending(`${action} ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `${done} ${id}` } } : fail(`Could not ${action}`, r);
    }
  }
  return { keep: true as const };
}

// ---- images ------------------------------------------------------------------

type ImageRow = { ID: string; Repository: string; Tag: string; Size: string; CreatedSince?: string; CreatedAt?: string; Containers?: string };

const IMAGE_ACTIONS: Action[] = [
  { id: "run", title: "Run" },
  { id: "copy-id", title: "Copy id", shortcut: "cmd+c" },
  { id: "remove", title: "Remove", shortcut: "cmd+d", style: "destructive", confirm: "Remove this image? A container still using it keeps docker from removing it." },
];
/** Run's arguments, typed in the bar: both optional (docker picks a name, no port published), so Enter twice runs the image bare. */
const RUN_ARGS: Arg[] = [
  { id: "name", placeholder: "Name (docker picks one when blank)" },
  { id: "ports", placeholder: "Ports: 8080:80, 443:443" },
];

const imageName = (r: ImageRow) => (r.Repository === "<none>" ? r.ID : `${r.Repository}:${r.Tag}`);

function image(r: ImageRow): Item {
  const name = imageName(r);
  return {
    id: name,
    name,
    subtitle: r.ID,
    icon: ICON,
    keywords: [r.ID, r.Repository],
    accessories: [{ text: r.Size }, ...(r.CreatedSince ? [{ text: r.CreatedSince }] : [])],
    detail: { metadata: [{ label: "Id", value: r.ID }, { label: "Repository", value: r.Repository }, { label: "Tag", value: r.Tag }, { label: "Size", value: r.Size }, ...(r.CreatedAt ? [{ label: "Created", value: r.CreatedAt }] : [])] },
    args: RUN_ARGS,
    actions: IMAGE_ACTIONS,
  };
}

async function listImages(): Promise<Item[]> {
  const r = await docker(["images", "--format", "{{json .}}"], LIST_MS);
  if (r.code !== 0) return failed(r);
  const items = rows<ImageRow>(r.out).map(image);
  return items.length ? items : [hint("No images", `${S().binary || "docker"} pull one and it lists here`)];
}

/** The bar's fields as a page: what a pick without values (a hotkey, `pal run`) answers, and what a bad port comes back on. */
const runForm = (image: string, errors?: Record<string, string>) => ({ form: { ...argsForm(RUN_ARGS, `Run ${image}`, { id: "run", title: "Run" }, errors), id: image } });

async function pickImage(id: string, action = "run", values?: Record<string, string | boolean>) {
  switch (action) {
    case "copy-id": return { copy: id };
    case "run": {
      if (!values) return runForm(id);
      const name = String(values.name ?? "").trim();
      const ports = String(values.ports ?? "").split(",").map((p) => p.trim()).filter(Boolean);
      const bad = ports.find((p) => !/^(\d+\.){0,3}\d*:?\d+(:\d+)?(\/(tcp|udp))?$/.test(p));
      if (bad) return runForm(id, { ports: `Not a port mapping: ${bad}` });
      const r = await docker(["run", "-d", ...(name ? ["--name", name] : []), ...ports.flatMap((p) => ["-p", p]), id], ACT_MS);
      return r.pending ? pending(`docker run ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `Started ${name || r.out.trim().slice(0, 12)}`, message: `from ${id}` } } : fail("Could not run", r);
    }
    case "remove": {
      const r = await docker(["rmi", id], ACT_MS);
      return r.pending ? pending(`Removing ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `Removed ${id}` } } : fail("Could not remove", r);
    }
  }
  return { keep: true as const };
}

// ---- compose -------------------------------------------------------------------

/** `docker compose ls --format json`: one array; `ConfigFiles` is comma separated. */
type ComposeRow = { Name: string; Status: string; ConfigFiles: string };

const COMPOSE_ACTIONS: Action[] = [
  { id: "up", title: "Up" },
  { id: "logs", title: "Logs", shortcut: "cmd+l" },
  { id: "restart", title: "Restart", shortcut: "cmd+shift+r" },
  { id: "down", title: "Down", shortcut: "cmd+d", style: "destructive", confirm: "Stop and remove this project's containers and networks?" },
  { id: "open", title: "Open project folder", shortcut: "cmd+o" },
];

/** `running(35)`, `exited(2)`, `running(1), exited(1)`: the leading word decides the tag. */
const composeColor = (status: string): TagColor => (/^running/.test(status) ? (status.includes("exited") ? "amber" : "green") : /^(paused|restarting)/.test(status) ? "amber" : "grey");

const composeFiles = new Map<string, string[]>();

function composeProject(r: ComposeRow): Item {
  const files = r.ConfigFiles.split(",").map((f) => f.trim()).filter(Boolean);
  composeFiles.set(r.Name, files);
  const dir = files[0] ? dirname(files[0]) : "";
  return {
    id: r.Name,
    name: r.Name,
    subtitle: dir ? tilde(dir) : undefined,
    icon: ICON,
    keywords: [basename(dir)],
    accessories: [{ text: r.Status }, { tag: r.Status.split("(")[0], color: composeColor(r.Status) }],
    detail: { metadata: [{ label: "Status", value: r.Status }, ...files.map((f) => ({ label: "Config", value: tilde(f) }))] },
    actions: COMPOSE_ACTIONS,
  };
}

async function listCompose(): Promise<Item[]> {
  const r = await docker(["compose", "ls", "-a", "--format", "json"], LIST_MS);
  if (r.code !== 0) return failed(r);
  const items = rows<ComposeRow>(r.out).map(composeProject);
  return items.length ? items : [hint("No Compose projects", "Bring one up with compose up and it lists here")];
}

async function pickCompose(id: string, action = "up") {
  const files = composeFiles.get(id);
  if (!files?.length) return toast("Project not listed", "List again first", "failure");
  const compose = ["compose", ...files.flatMap((f) => ["-f", f])];
  switch (action) {
    case "open": return { open: dirname(files[0]) };
    case "logs": return logs(`Logs ${id}`, [...compose, "logs", "--no-color", "--tail", String(LOG_LINES)]);
    case "up": case "down": case "restart": {
      const r = await docker([...compose, action, ...(action === "up" ? ["-d"] : [])], COMPOSE_MS);
      const done = { up: "Up", down: "Down", restart: "Restarted" }[action];
      return r.pending ? pending(`compose ${action} ${id}`) : r.code === 0 ? { keep: true as const, toast: { title: `${done}: ${id}` } } : fail(`compose ${action} failed`, r);
    }
  }
  return { keep: true as const };
}

export default {
  palettes: {
    docker: {
      title: "Docker Containers",
      live: true,
      ttl: TTL,
      placeholder: "Search containers",
      list: listContainers,
      pick: (id, action) => pickContainer(id, action),
    },
    images: {
      title: "Docker Images",
      live: true,
      ttl: TTL,
      placeholder: "Search images",
      list: listImages,
      pick: (id, action, ctx) => pickImage(id, action, ctx?.values),
    },
    compose: {
      title: "Compose Projects",
      live: true,
      ttl: TTL,
      placeholder: "Search Compose projects",
      list: listCompose,
      pick: (id, action) => pickCompose(id, action),
    },
  },
} satisfies Extension;
