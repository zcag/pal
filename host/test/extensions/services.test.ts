// services against fake `systemctl`/`journalctl`/`sudo`/`pkexec` (Linux
// backend) and `launchctl` (macOS backend) on PATH: shell scripts that print
// canned output and record their argv. `PAL_SERVICES_BACKEND` picks the
// backend, so both run on one machine; each gets its own host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-services-"));
const calls = join(dir, "calls");
const called = () => { try { return readFileSync(calls, "utf8").trim().split("\n"); } catch { return []; } };
const script = (name: string, body: string) => { writeFileSync(join(dir, name), `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "${calls}"\n${body}`); chmodSync(join(dir, name), 0o755); };
const PATH = process.env.PATH;

const USER_UNITS = [
  { unit: "agent-chrome.service", load: "loaded", active: "active", sub: "running", description: "Agent-controlled Chromium" },
  { unit: "backup.service", load: "loaded", active: "inactive", sub: "dead", description: "Nightly backup" },
  { unit: "broken.service", load: "loaded", active: "failed", sub: "failed", description: "broken.service" },
];
const SYSTEM_UNITS = [
  { unit: "docker.service", load: "loaded", active: "active", sub: "running", description: "Docker Application Container Engine" },
  { unit: "cups.service", load: "loaded", active: "inactive", sub: "dead", description: "CUPS Scheduler" },
];
const byState = (units: typeof USER_UNITS, state: string | undefined) => units.filter((u) => !state || u.active === state || u.sub === state);

// systemctl: `--user` picks the table; `--state=` filters; `list-unit-files` gives enabled states; verbs on
// system units refuse unless `${dir}/allow` names the escalation that works (plain, sudo or pkexec).
script("systemctl", `
scope=system; state=; verb=; unit=
for a in "$@"; do case "$a" in --user) scope=user ;; --state=*) state=\${a#--state=} ;; --*) ;; list-units|list-unit-files) verb=$a ;; start|stop|restart|enable|disable) verb=$a ;; *) unit=$a ;; esac; done
if [ "$verb" = list-units ]; then cat "${dir}/$scope-units-$state.json"; exit 0; fi
if [ "$verb" = list-unit-files ]; then cat "${dir}/$scope-files.json"; exit 0; fi
if [ "$unit" = missing.service ]; then echo "Failed to $verb $unit: Unit $unit not found." >&2; exit 5; fi
if [ "$scope" = system ] && [ "$(cat ${dir}/allow 2>/dev/null)" != plain ] && [ "$PAL_FAKE_ROOT" != 1 ]; then echo "Failed to $verb $unit: Access denied as the requested operation requires interactive authentication." >&2; exit 1; fi
exit 0
`);
script("sudo", `
if [ "$(cat ${dir}/allow 2>/dev/null)" = sudo ]; then shift; PAL_FAKE_ROOT=1 exec "$@"; fi
echo "sudo: a password is required" >&2; exit 1
`);
script("pkexec", `
if [ "$(cat ${dir}/allow 2>/dev/null)" = pkexec ]; then PAL_FAKE_ROOT=1 exec "$@"; fi
echo "Error creating textual authentication agent: Error opening current controlling terminal" >&2; exit 127
`);
script("journalctl", `printf 'Sep 16 10:00:00 marko x[1]: started\\nSep 16 10:00:01 marko x[1]: ready\\n'`);
for (const state of ["", "failed", "running"]) {
  writeFileSync(join(dir, `user-units-${state}.json`), JSON.stringify(byState(USER_UNITS, state || undefined)));
  writeFileSync(join(dir, `system-units-${state}.json`), JSON.stringify(byState(SYSTEM_UNITS, state || undefined)));
}
writeFileSync(join(dir, "user-files.json"), JSON.stringify([{ unit_file: "agent-chrome.service", state: "enabled" }, { unit_file: "backup.service", state: "disabled" }, { unit_file: "broken.service", state: "static" }, { unit_file: "never-ran.service", state: "disabled" }, { unit_file: "worker@.service", state: "disabled" }, { unit_file: "old.service", state: "masked" }]));
writeFileSync(join(dir, "system-files.json"), JSON.stringify([{ unit_file: "docker.service", state: "enabled" }, { unit_file: "cups.service", state: "disabled" }]));

// launchctl: `list` prints the table; the verbs record and succeed, except a bootout of a label that is not loaded.
script("launchctl", `
case "$1" in
  list) printf 'PID\\tStatus\\tLabel\\n412\\t0\\tio.cagdas.chrome-cdp\\n-\\t0\\thomebrew.mxcl.syncthing\\n-\\t-9\\tcom.apple.progressd\\n999\\t0\\tapplication.com.apple.Notes.1152921500311894404\\n' ;;
  bootout) case "$2" in */io.cagdas.bt-follow) echo "Boot-out failed: 3: No such process" >&2; exit 3 ;; esac ;;
esac
exit 0
`);
const agents = join(dir, "LaunchAgents"), sysAgents = join(dir, "Library", "LaunchAgents");
mkdirSync(agents); mkdirSync(sysAgents, { recursive: true });
const plist = (label: string, args: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${a}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
writeFileSync(join(agents, "io.cagdas.chrome-cdp.plist"), plist("io.cagdas.chrome-cdp", ["/Users/x/.local/bin/chrome-cdp", "--keep"]));
writeFileSync(join(agents, "io.cagdas.bt-follow.plist"), plist("io.cagdas.bt-follow", ["/Users/x/.local/bin/bt", "set", "follow"]));
writeFileSync(join(agents, "notes.txt"), "not a plist");
writeFileSync(join(sysAgents, "com.google.keystone.agent.plist"), plist("com.google.keystone.agent", ["/Library/Google/ksagent"]));

afterAll(() => { process.env.PATH = PATH; delete process.env.PAL_SERVICES_BACKEND; rmSync(dir, { recursive: true, force: true }); });

describe("services (systemd)", () => {
  let host: Host;
  beforeAll(async () => {
    process.env.PATH = `${dir}:${PATH}`;
    process.env.PAL_SERVICES_BACKEND = "systemd";
    host = await Host.bundled({ settings: { services: { settings: { ttl: 5 } } } });
  });
  afterAll(() => host?.kill());
  const list = (filter?: string) => host.list("services", "services", undefined, filter ? { filter } : undefined);
  const pick = (id: string, action?: string) => host.pick("services", "services", id, action);

  test("meta: live, four filters, the ttl from the settings", () => {
    expect(host.loaded().find((l) => l.extension === "services")!.palettes[0]).toMatchObject({ name: "services", title: "Services", live: true, input: false, ttl: 5, filters: [{ id: "user", title: "User" }, { id: "system", title: "System" }, { id: "failed", title: "Failed" }, { id: "running", title: "Running" }] });
  });

  test("user units (the default): loaded ones then unit files never loaded (templates and masked skipped); enabled state and active/sub tag; actions by state, no enable for a static unit", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["user:agent-chrome.service", "user:backup.service", "user:broken.service", "user:never-ran.service"]);
    expect(items[3]).toMatchObject({ name: "never-ran", accessories: [{ text: "disabled" }, { tag: "inactive/dead", color: "grey" }] });
    expect(items[3].subtitle).toBeUndefined();
    expect(items[0]).toMatchObject({ name: "agent-chrome", subtitle: "Agent-controlled Chromium", keywords: ["agent-chrome.service", "user"], accessories: [{ text: "enabled" }, { tag: "running", color: "green" }] });
    expect(items[1].accessories).toEqual([{ text: "disabled" }, { tag: "inactive/dead", color: "grey" }]);
    expect(items[2].subtitle).toBeUndefined();
    expect(items[2].accessories).toEqual([{ tag: "failed", color: "red" }]);
    expect(items[0].actions!.map((a) => [a.id, a.confirm ?? null])).toEqual([["stop", null], ["logs", null], ["restart", null], ["disable", null], ["copy", null]]);
    expect(items[1].actions!.map((a) => a.id)).toEqual(["start", "logs", "restart", "enable", "copy"]);
    expect(items[2].actions!.map((a) => a.id)).toEqual(["start", "logs", "restart", "copy"]);
    expect(items.every((i) => i.section === undefined)).toBe(true);
    expect(called().slice(-2)).toEqual(["systemctl --user --no-pager list-units --type=service --all --output=json", "systemctl --user --no-pager list-unit-files --type=service --output=json"]);
  });

  test("system units ask before stop, restart and disable; failed and running span both scopes in sections", async () => {
    const system = await list("system");
    expect(system.map((i) => i.id)).toEqual(["system:docker.service", "system:cups.service"]);
    expect(system[0].actions!.map((a) => [a.id, !!a.confirm])).toEqual([["stop", true], ["logs", false], ["restart", true], ["disable", true], ["copy", false]]);
    expect(system[1].actions!.map((a) => [a.id, !!a.confirm])).toEqual([["start", false], ["logs", false], ["restart", true], ["enable", false], ["copy", false]]);
    const failed = await list("failed");
    expect(failed.map((i) => [i.id, i.section])).toEqual([["user:broken.service", "User"]]);
    const running = await list("running");
    expect(running.map((i) => [i.id, i.section])).toEqual([["user:agent-chrome.service", "User"], ["system:docker.service", "System"]]);
  });

  test("Enter toggles a user unit through systemctl --user; enable, disable, copy, and a unit systemd does not know", async () => {
    await list();
    expect(await pick("user:agent-chrome.service")).toEqual({ keep: true, toast: { title: "Stopped agent-chrome.service" } });
    expect(called().at(-1)).toBe("systemctl --user --no-pager --no-ask-password stop agent-chrome.service");
    expect(await pick("user:backup.service")).toEqual({ keep: true, toast: { title: "Started backup.service" } });
    expect(await pick("user:backup.service", "enable")).toEqual({ keep: true, toast: { title: "Enabled backup.service" } });
    expect(called().at(-1)).toBe("systemctl --user --no-pager --no-ask-password enable backup.service");
    expect(await pick("user:agent-chrome.service", "disable")).toMatchObject({ toast: { title: "Disabled agent-chrome.service" } });
    expect(await pick("user:backup.service", "copy")).toEqual({ copy: "backup.service" });
    expect(await pick("user:missing.service")).toEqual({ keep: true, toast: { title: "Unit not listed", message: "List again first", style: "failure" } });
  });

  test("logs: journalctl -u, --user for a user unit, as a show level", async () => {
    await list("system");
    const r = await pick("system:docker.service", "logs");
    expect(r.show).toEqual({ title: "docker.service logs", markdown: "````\nSep 16 10:00:00 marko x[1]: started\nSep 16 10:00:01 marko x[1]: ready\n````" });
    expect(called().at(-1)).toBe("journalctl -u docker.service -n 200 --no-pager");
    await list();
    await pick("user:backup.service", "logs");
    expect(called().at(-1)).toBe("journalctl --user -u backup.service -n 200 --no-pager");
  });

  test("system units: systemctl, then sudo -n, then pkexec; none allowed is a toast that says so", async () => {
    await list("system");
    const refused = await pick("system:cups.service", "start");
    expect(refused.toast).toMatchObject({ title: "Could not start cups.service", style: "failure" });
    expect(refused.toast!.message).toMatch(/^Not permitted: Failed to start cups.service.*\nsudo -n: sudo: a password is required\npkexec: Error creating textual authentication agent/);
    expect(called().slice(-3)).toEqual([
      "systemctl --no-pager --no-ask-password start cups.service",
      "sudo -n systemctl --no-pager --no-ask-password start cups.service",
      "pkexec systemctl --no-pager --no-ask-password start cups.service",
    ]);
    writeFileSync(join(dir, "allow"), "sudo");
    expect(await pick("system:cups.service", "start")).toEqual({ keep: true, toast: { title: "Started cups.service" } });
    expect(called().slice(-3)).toEqual(["systemctl --no-pager --no-ask-password start cups.service", "sudo -n systemctl --no-pager --no-ask-password start cups.service", "systemctl --no-pager --no-ask-password start cups.service"]);
    writeFileSync(join(dir, "allow"), "pkexec");
    expect(await pick("system:docker.service", "restart")).toEqual({ keep: true, toast: { title: "Restarted docker.service" } });
    expect(called().at(-2)).toBe("pkexec systemctl --no-pager --no-ask-password restart docker.service");
    writeFileSync(join(dir, "allow"), "plain");
    expect(await pick("system:docker.service", "stop")).toEqual({ keep: true, toast: { title: "Stopped docker.service" } });
    expect(called().at(-1)).toBe("systemctl --no-pager --no-ask-password stop docker.service");
    rmSync(join(dir, "allow"));
  });

  test("confirm_user asks for user units too", async () => {
    host.changeSettings("services", { settings: { ttl: 5, confirm_user: true } });
    const items = await list();
    expect(items[0].actions![0]).toMatchObject({ id: "stop", confirm: "Stop this user unit?" });
    host.changeSettings("services", { settings: { ttl: 5 } });
  });
});

describe("services (launchd)", () => {
  let host: Host;
  beforeAll(async () => {
    process.env.PATH = `${dir}:${PATH}`;
    process.env.PAL_SERVICES_BACKEND = "launchd";
    host = await Host.bundled({ settings: { services: { settings: { agent_dirs: [agents, sysAgents] } } } });
  });
  afterAll(() => host?.kill());
  const list = (filter?: string) => host.list("services", "services", undefined, filter ? { filter } : undefined);
  const pick = (id: string, action?: string) => host.pick("services", "services", id, action);
  const gui = `gui/${process.getuid!()}`;

  test("meta: Launch Agents with three filters", () => {
    expect(host.loaded().find((l) => l.extension === "services")!.palettes[0]).toMatchObject({ title: "Launch Agents", live: true, filters: [{ id: "agents", title: "Agents" }, { id: "loaded", title: "Loaded" }, { id: "running", title: "Running" }] });
  });

  test("agents: every plist in the folders, one section per folder, with pid and state from launchctl list; actions by state", async () => {
    const items = await list();
    expect(items.map((i) => [i.id, i.section])).toEqual([["io.cagdas.bt-follow", agents], ["io.cagdas.chrome-cdp", agents], ["com.google.keystone.agent", sysAgents]]);
    const [follow, cdp, keystone] = items;
    expect(cdp).toMatchObject({ name: "io.cagdas.chrome-cdp", subtitle: "/Users/x/.local/bin/chrome-cdp", keywords: ["io.cagdas.chrome-cdp.plist"], accessories: [{ text: "pid 412" }, { tag: "running", color: "green" }] });
    expect(cdp.actions!.map((a) => a.id)).toEqual(["unload", "restart", "show", "open", "copy"]);
    expect(cdp.actions![0].confirm).toBeTruthy();
    expect(follow.accessories).toEqual([{ tag: "not loaded", color: "grey" }]);
    expect(follow.actions!.map((a) => a.id)).toEqual(["load", "show", "open", "copy"]);
    expect(keystone.detail!.metadata).toEqual([{ label: "Label", value: "com.google.keystone.agent" }, { label: "Plist", value: join(sysAgents, "com.google.keystone.agent.plist") }, { label: "Program", value: "/Library/Google/ksagent" }, { label: "State", value: "not loaded" }]);
  });

  test("loaded and running: launchctl list's jobs, sorted, application.* launch jobs skipped, a non-zero last exit tagged red", async () => {
    const loaded = await list("loaded");
    expect(loaded.map((i) => i.id)).toEqual(["com.apple.progressd", "homebrew.mxcl.syncthing", "io.cagdas.chrome-cdp"]);
    expect(loaded[0].accessories).toEqual([{ tag: "exit -9", color: "red" }]);
    expect(loaded[1].accessories).toEqual([{ tag: "loaded", color: "blue" }]);
    expect(loaded[1].actions!.map((a) => a.id)).toEqual(["unload", "restart", "copy"]);
    expect(loaded[2].subtitle).toBe("/Users/x/.local/bin/chrome-cdp");
    expect((await list("running")).map((i) => i.id)).toEqual(["io.cagdas.chrome-cdp"]);
  });

  test("load bootstraps the plist, unload boots the label out, restart kickstarts; launchctl's refusal is a toast", async () => {
    await list();
    expect(await pick("io.cagdas.bt-follow")).toEqual({ keep: true, toast: { title: "Loaded io.cagdas.bt-follow" } });
    expect(called().at(-1)).toBe(`launchctl bootstrap ${gui} ${join(agents, "io.cagdas.bt-follow.plist")}`);
    expect(await pick("io.cagdas.chrome-cdp")).toEqual({ keep: true, toast: { title: "Unloaded io.cagdas.chrome-cdp" } });
    expect(called().at(-1)).toBe(`launchctl bootout ${gui}/io.cagdas.chrome-cdp`);
    expect(await pick("io.cagdas.chrome-cdp", "restart")).toEqual({ keep: true, toast: { title: "Restarted io.cagdas.chrome-cdp" } });
    expect(called().at(-1)).toBe(`launchctl kickstart -k ${gui}/io.cagdas.chrome-cdp`);
    expect(await pick("io.cagdas.bt-follow", "unload")).toEqual({ keep: true, toast: { title: "Could not unload io.cagdas.bt-follow", message: "Boot-out failed: 3: No such process", style: "failure" } });
  });

  test("show plist is the XML as a show level; open plist file opens it; copy label", async () => {
    await list();
    const r = await pick("io.cagdas.chrome-cdp", "show");
    expect(r.show!.title).toBe("io.cagdas.chrome-cdp.plist");
    expect(r.show!.markdown).toMatch(/^````xml\n<\?xml version="1.0"[\s\S]*<string>io.cagdas.chrome-cdp<\/string>[\s\S]*\n````$/);
    expect(await pick("io.cagdas.chrome-cdp", "open")).toEqual({ open: join(agents, "io.cagdas.chrome-cdp.plist") });
    expect(await pick("io.cagdas.chrome-cdp", "copy")).toEqual({ copy: "io.cagdas.chrome-cdp" });
  });

  test("a missing agent folder is skipped; none at all is a hint", async () => {
    host.changeSettings("services", { settings: { agent_dirs: [join(dir, "nope"), sysAgents] } });
    expect((await list()).map((i) => i.id)).toEqual(["com.google.keystone.agent"]);
    host.changeSettings("services", { settings: { agent_dirs: [join(dir, "nope")] } });
    expect(await list()).toEqual([expect.objectContaining({ name: "No agent plists", actions: [] })]);
    host.changeSettings("services", { settings: { agent_dirs: [agents, sysAgents] } });
  });
});
