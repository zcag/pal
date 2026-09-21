// docker against a fake `docker` on PATH: a shell script that prints canned
// `{{json .}}` rows and records every call. `mode` in the fixture dir flips
// it to "daemon down"; `PAL_TERMINAL_LOG` catches the Shell action's argv
// instead of opening a terminal.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-docker-"));
const calls = join(dir, "calls");
const PS = [
  { ID: "b5d74103f8fe", Names: "theater-proxy", Image: "caddy:2-alpine", State: "running", Status: "Up 27 hours", Ports: "100.70.78.6:80->80/tcp, 192.168.1.27:80->80/tcp, 192.168.1.27:443->443/tcp, 443/udp, 2019/tcp", Command: '"caddy run"', CreatedAt: "2026-09-14 18:36:09 +0300 +03", Labels: "com.docker.compose.project=theater,com.docker.compose.service=proxy", Mounts: "/mnt/sda", Networks: "theater" },
  { ID: "aa11bb22cc33", Names: "old-job", Image: "alpine:3.20", State: "exited", Status: "Exited (0) 3 days ago", Ports: "", Command: '"sleep 300"', Labels: "" },
  { ID: "dd44ee55ff66", Names: "api", Image: "myapp:latest", State: "running", Status: "Up 2 minutes", Ports: "0.0.0.0:8080->80/tcp, :::8080->80/tcp", Labels: "" },
];
const IMAGES = [
  { ID: "379e574779b1", Repository: "127.0.0.1:5000/tela-backend", Tag: "latest", Size: "69.1MB", CreatedSince: "4 days ago", CreatedAt: "2026-09-12 15:06:57 +0300 +03" },
  { ID: "0123456789ab", Repository: "<none>", Tag: "<none>", Size: "5MB", CreatedSince: "2 weeks ago" },
];
// Under a home no test machine has: the extension shortens `$HOME/...` to `~/...`, and the fixture must not.
const COMPOSE = [
  { Name: "theater", Status: "running(35)", ConfigFiles: "/home/someone/srv/theater/compose.yml" },
  { Name: "lab", Status: "exited(2)", ConfigFiles: "/home/someone/proj/lab/compose.yml,/home/someone/proj/lab/compose.override.yml" },
];
writeFileSync(join(dir, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
if [ "$(cat "${dir}/mode" 2>/dev/null)" = down ]; then echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1; fi
case "$1 $2" in
  "ps -a") cat "${dir}/ps.jsonl" ;;
  "images --format") cat "${dir}/images.jsonl" ;;
  "compose ls") cat "${dir}/compose.json" ;;
  "logs --tail") printf 'line one\\nline two\\n'; echo 'warn: on stderr' >&2 ;;
  "compose -f") echo "compose $*" ;;
  "stop aa11bb22cc33") echo "no such container" >&2; exit 1 ;;
  "stop dd44ee55ff66") sleep 12 ;;
  "run -d") echo "0123456789abcdef" ;;
  *) echo "$2" ;;
esac
`);
chmodSync(join(dir, "docker"), 0o755);
writeFileSync(join(dir, "ps.jsonl"), PS.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(dir, "images.jsonl"), IMAGES.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(dir, "compose.json"), JSON.stringify(COMPOSE) + "\n");

const PATH = process.env.PATH;
const TERMINAL = process.env.TERMINAL;
let host: Host;
beforeAll(async () => {
  process.env.PATH = `${dir}:${PATH}`;
  // Linux: the chooser takes $TERMINAL as given (nothing is spawned under PAL_TERMINAL_LOG), so a box without one (the CI runner) still answers an argv.
  if (process.platform !== "darwin") process.env.TERMINAL ||= "kitty";
  process.env.PAL_TERMINAL_LOG = join(dir, "terminal");
  host = await Host.bundled({ settings: { docker: { settings: { ttl: 7 } } } });
});
afterAll(() => { host?.kill(); process.env.PATH = PATH; if (TERMINAL === undefined) delete process.env.TERMINAL; else process.env.TERMINAL = TERMINAL; delete process.env.PAL_TERMINAL_LOG; rmSync(dir, { recursive: true, force: true }); });

const called = () => { try { return readFileSync(calls, "utf8").trim().split("\n"); } catch { return []; } };
const list = (palette = "docker") => host.list("docker", palette);
const pick = (id: string, action?: string, palette = "docker", values?: Record<string, string | boolean>) => host.pick("docker", palette, id, action, values ? { values } : undefined);

describe("docker", () => {
  test("meta: three live palettes with the ttl from the settings", () => {
    const metas = host.loaded().find((l) => l.extension === "docker")!.palettes;
    expect(metas.map((m) => [m.name, m.title, m.live, m.ttl])).toEqual([["docker", "Docker Containers", true, 7], ["images", "Docker Images", true, 7], ["compose", "Compose Projects", true, 7]]);
  });

  test("containers: running first in two sections; image subtitle, ports, status and state tag; actions by state", async () => {
    const items = await list();
    expect(items.map((i) => [i.id, i.section])).toEqual([["b5d74103f8fe", "Running"], ["dd44ee55ff66", "Running"], ["aa11bb22cc33", "Stopped"]]);
    const [proxy, api, old] = items;
    expect(proxy).toMatchObject({ name: "theater-proxy", subtitle: "caddy:2-alpine", keywords: ["b5d74103f8fe", "caddy:2-alpine", "theater"], accessories: [{ text: "80, 443" }, { text: "Up 27 hours" }, { tag: "running", color: "green" }] });
    expect(api.accessories).toEqual([{ text: "8080:80" }, { text: "Up 2 minutes" }, { tag: "running", color: "green" }]);
    expect(old.accessories).toEqual([{ text: "Exited (0) 3 days ago" }, { tag: "exited", color: "grey" }]);
    expect(proxy.actions!.map((a) => a.id)).toEqual(["stop", "logs", "shell", "restart", "remove", "copy-id"]);
    expect(proxy.actions![0].confirm).toBeTruthy();
    expect(old.actions!.map((a) => a.id)).toEqual(["start", "logs", "remove", "copy-id"]);
    expect(proxy.detail!.metadata!.map((m) => m.label)).toEqual(["Id", "Image", "Command", "Status", "Created", "Ports", "Mounts", "Networks", "Compose project"]);
    expect(called().at(-1)).toBe("ps -a --format {{json .}}");
  });

  test("Enter toggles: stop for a running container, start for a stopped one; the palette lists again with a toast", async () => {
    expect(await pick("b5d74103f8fe")).toEqual({ keep: true, toast: { title: "Stopped b5d74103f8fe" } });
    expect(called().at(-1)).toBe("stop b5d74103f8fe");
    expect(await pick("aa11bb22cc33")).toEqual({ keep: true, toast: { title: "Started aa11bb22cc33" } });
    expect(called().at(-1)).toBe("start aa11bb22cc33");
    expect(await pick("aa11bb22cc33", "restart")).toMatchObject({ keep: true });
    expect(called().at(-1)).toBe("restart aa11bb22cc33");
  });

  test("a failed command is a failure toast with docker's last stderr line", async () => {
    expect(await pick("aa11bb22cc33", "stop")).toEqual({ keep: true, toast: { title: "Could not stop", message: "no such container", style: "failure" } });
  });

  test("a command still running after 8 s answers with a toast saying so, and goes on", async () => {
    const t0 = Date.now();
    const r = await host.request<Record<string, unknown>>("pick", { extension: "docker", palette: "docker", id: "dd44ee55ff66", action: "stop" }, 9500);
    expect(r).toEqual({ keep: true, toast: { title: "stop dd44ee55ff66 not done yet", message: "Still running after 8 s; it goes on in the background" } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(7900);
    expect(Date.now() - t0).toBeLessThan(9500);
  }, 12_000);

  test("logs: a show level with the last 200 lines fenced, stderr included; the bar's count instead when it is one", async () => {
    const r = await pick("b5d74103f8fe", "logs");
    expect(r.show).toEqual({ title: "Logs b5d74103f8fe", markdown: "````\nline one\nline two\nwarn: on stderr\n````" });
    expect(called().at(-1)).toBe("logs --tail 200 b5d74103f8fe");
    // The row's fields: the line count on every container, a Shell command on a running one; only Logs and Shell read them.
    const items = await list();
    expect(items.find((i) => i.id === "b5d74103f8fe")!.args).toEqual([{ id: "lines", placeholder: "Log lines", kind: "number", default: "200" }, { id: "command", placeholder: "Command for Shell (blank: a shell)" }]);
    expect(items.find((i) => i.id === "aa11bb22cc33")!.args!.map((a) => a.id)).toEqual(["lines"]);
    expect(items.find((i) => i.id === "b5d74103f8fe")!.actions!.filter((a) => a.args).map((a) => a.id)).toEqual(["logs", "shell"]);
    expect(items.find((i) => i.id === "aa11bb22cc33")!.actions!.filter((a) => a.args).map((a) => a.id)).toEqual(["logs"]);
    await pick("aa11bb22cc33", "logs", "docker", { lines: "50", command: "" });
    expect(called().at(-1)).toBe("logs --tail 50 aa11bb22cc33");
    await pick("aa11bb22cc33", "logs", "docker", { lines: "lots" });
    expect(called().at(-1)).toBe("logs --tail 200 aa11bb22cc33");
  });

  test("shell opens a terminal running docker exec -it, or the bar's command kept open until Enter; remove forces; copy id", async () => {
    expect(await pick("b5d74103f8fe", "shell")).toEqual({});
    const opened = () => JSON.parse(readFileSync(join(dir, "terminal"), "utf8").trim().split("\n").at(-1)!) as string[];
    expect(opened().join(" ")).toContain("docker exec -it b5d74103f8fe sh -c");
    expect(await pick("b5d74103f8fe", "shell", "docker", { lines: "200", command: "" })).toEqual({});
    expect(opened().join(" ")).toContain("docker exec -it b5d74103f8fe sh -c command -v bash");
    expect(await pick("b5d74103f8fe", "shell", "docker", { lines: "200", command: "cat /etc/os-release" })).toEqual({});
    const argv = opened();
    expect(argv.slice(-3, -1)).toEqual(["sh", "-c"]);
    expect(argv.at(-1)).toMatch(/^docker exec -it b5d74103f8fe sh -c 'cat \/etc\/os-release'; s=\$\?; printf .*read -r _$/);
    expect(await pick("b5d74103f8fe", "remove")).toEqual({ keep: true, toast: { title: "Removed b5d74103f8fe" } });
    expect(called().at(-1)).toBe("rm -f b5d74103f8fe");
    expect(await pick("b5d74103f8fe", "copy-id")).toEqual({ copy: "b5d74103f8fe" });
  });

  test("images: repo:tag (the id for <none>), size and age, run with the bar's name and ports (a form for a pick without them), remove", async () => {
    const items = await list("images");
    expect(items.map((i) => i.name)).toEqual(["127.0.0.1:5000/tela-backend:latest", "0123456789ab"]);
    expect(items[0]).toMatchObject({ subtitle: "379e574779b1", accessories: [{ text: "69.1MB" }, { text: "4 days ago" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["run", "copy-id", "remove"]);
    // Run's values come from the bar; a pick without them (a hotkey, `pal run`) gets the same fields as a form, submitted back to `run`.
    expect(items[0].args!.map((a) => a.id)).toEqual(["name", "ports"]);
    const form = await pick(items[0].id, "run", "images");
    expect(form.form).toMatchObject({ id: items[0].id, title: "Run 127.0.0.1:5000/tela-backend:latest", submit: { id: "run", title: "Run" } });
    expect(form.form!.fields.map((f) => f.id)).toEqual(["name", "ports"]);
    const bad = await pick(items[0].id, "run", "images", { name: "", ports: "eighty" });
    expect(bad.form!.errors).toEqual({ ports: "Not a port mapping: eighty" });
    expect(bad.form!.fields.map((f) => f.id)).toEqual(["name", "ports"]);
    expect(await pick(items[0].id, "run", "images", { name: "", ports: "" })).toMatchObject({ keep: true, toast: { title: "Started 0123456789ab" } });
    expect(called().at(-1)).toBe("run -d 127.0.0.1:5000/tela-backend:latest");
    const ok = await pick(items[0].id, "run", "images", { name: "web", ports: "8080:80, 443:443/tcp" });
    expect(ok).toEqual({ keep: true, toast: { title: "Started web", message: "from 127.0.0.1:5000/tela-backend:latest" } });
    expect(called().at(-1)).toBe("run -d --name web -p 8080:80 -p 443:443/tcp 127.0.0.1:5000/tela-backend:latest");
    expect(await pick("0123456789ab", "remove", "images")).toEqual({ keep: true, toast: { title: "Removed 0123456789ab" } });
    expect(called().at(-1)).toBe("rmi 0123456789ab");
  });

  test("compose: projects with their folder, status text and tag; up, down, logs and restart pass every config file", async () => {
    const items = await list("compose");
    expect(items.map((i) => i.id)).toEqual(["theater", "lab"]);
    expect(items[0]).toMatchObject({ subtitle: "/home/someone/srv/theater", keywords: ["theater"], accessories: [{ text: "running(35)" }, { tag: "running", color: "green" }] });
    expect(items[1].accessories).toEqual([{ text: "exited(2)" }, { tag: "exited", color: "grey" }]);
    expect(items[0].actions!.map((a) => a.id)).toEqual(["up", "logs", "restart", "down", "open"]);
    expect(await pick("lab", "up", "compose")).toEqual({ keep: true, toast: { title: "Up: lab" } });
    expect(called().at(-1)).toBe("compose -f /home/someone/proj/lab/compose.yml -f /home/someone/proj/lab/compose.override.yml up -d");
    expect(await pick("theater", "down", "compose")).toEqual({ keep: true, toast: { title: "Down: theater" } });
    expect(called().at(-1)).toBe("compose -f /home/someone/srv/theater/compose.yml down");
    expect((await pick("theater", "logs", "compose")).show!.title).toBe("Logs theater");
    expect(called().at(-1)).toBe("compose -f /home/someone/srv/theater/compose.yml logs --no-color --tail 200");
    expect(await pick("theater", "open", "compose")).toEqual({ open: "/home/someone/srv/theater" });
  });

  test("daemon down: one inert hint row naming it, in every palette", async () => {
    writeFileSync(join(dir, "mode"), "down");
    for (const p of ["docker", "images", "compose"]) {
      const items = await list(p);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ name: "Docker is not running", subtitle: expect.stringContaining("Cannot connect"), actions: [] });
    }
    rmSync(join(dir, "mode"));
  });

  test("binary missing: a hint row saying so, with the setting's name when it is not docker", async () => {
    host.changeSettings("docker", { settings: { binary: "no-such-docker-binary" } });
    const items = await list();
    expect(items).toEqual([expect.objectContaining({ name: "no-such-docker-binary is not installed", subtitle: "no-such-docker-binary is not on PATH", actions: [] })]);
    host.changeSettings("docker", { settings: { binary: "docker" } });
    expect((await list()).length).toBe(3);
  });
});
