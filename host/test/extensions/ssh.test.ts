// ssh against a temp ~/.ssh fixture: the `config` setting points at it, so
// the real ~/.ssh is never read; `PAL_TERMINAL_LOG` catches Connect's argv
// instead of opening a terminal.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-ssh-"));
const config = join(dir, "config");
mkdirSync(join(dir, "conf.d"));
writeFileSync(config, `
# comment
Include conf.d/*.conf
Include ${join(dir, "extra")}

Host marko
  HostName marko.lan
  User cagdas
  Port 2222

Host deck steamdeck
  HostName=192.168.1.9
  User deck

Host inner
  HostName 10.0.0.7
  ProxyJump marko

Host loop
  HostName 127.0.0.1

Host *.internal !bastion
  User root

Host *
  ServerAliveInterval 30

Match host marko
  User other

Host bare
`);
writeFileSync(join(dir, "conf.d", "work.conf"), "Host work\n  HostName work.example.com\n  User me\n");
writeFileSync(join(dir, "extra"), "Host extra\n  hostname extra.example.com\n");
writeFileSync(join(dir, "known_hosts"), [
  "marko.lan ssh-ed25519 AAAA",
  "[nas.lan]:2222,10.0.0.5 ssh-rsa BBBB",
  "|1|hashed|hash ssh-ed25519 CCCC",
  "192.168.1.9 ssh-ed25519 DDDD",
  "@cert-authority *.example.com ssh-rsa EEEE",
  "archer,archer.lan ssh-ed25519 FFFF",
].join("\n"));

const TERMINAL = process.env.TERMINAL;
let host: Host;
beforeAll(async () => {
  // Linux: the chooser takes $TERMINAL as given (nothing is spawned under PAL_TERMINAL_LOG), so a box without one (the CI runner) still answers an argv.
  if (process.platform !== "darwin") process.env.TERMINAL ||= "kitty";
  process.env.PAL_TERMINAL_LOG = join(dir, "terminal");
  host = await Host.bundled({ settings: { ssh: { settings: { config } } } });
});
afterAll(() => { host.kill(); if (TERMINAL === undefined) delete process.env.TERMINAL; else process.env.TERMINAL = TERMINAL; delete process.env.PAL_TERMINAL_LOG; rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("ssh", "ssh");
const pick = (id: string, action?: string, values?: Record<string, string>) => host.pick("ssh", "ssh", id, action, values && { values });
/** The last terminal argv Connect asked for. */
const opened = () => JSON.parse(readFileSync(join(dir, "terminal"), "utf8").trim().split("\n").at(-1)!) as string[];

describe("ssh", () => {
  test("meta: indexed, not live", () => {
    expect(host.loaded().find((l) => l.extension === "ssh")!.palettes[0]).toMatchObject({ name: "ssh", title: "SSH Hosts", live: false, input: false, placeholder: "Connect to a host" });
  });

  test("Host names in file order, includes one level, patterns and Match blocks skipped; the file is the section", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["work", "extra", "marko", "deck", "steamdeck", "inner", "loop", "bare"]);
    const dirName = dir.slice(dir.lastIndexOf("/") + 1);
    // The section is the file, relative to the config's directory (`.ssh/config`, `.ssh/conf.d/work.conf` in real life).
    expect(items.map((i) => i.section)).toEqual([`${dirName}/conf.d/work.conf`, `${dirName}/extra`, ...Array(6).fill(`${dirName}/config`)]);
  });

  test("HostName is the subtitle and a keyword; User and Port are accessories; key=value works", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by.marko).toMatchObject({ name: "marko", subtitle: "marko.lan", keywords: ["marko.lan", "cagdas"], accessories: [{ text: "cagdas" }, { tag: ":2222" }] });
    expect(by.marko.detail!.metadata!.map((m) => [m.label, m.value])).toEqual([["Host", "marko"], ["HostName", "marko.lan"], ["User", "cagdas"], ["Port", "2222"], ["File", `${dir.slice(dir.lastIndexOf("/") + 1)}/config`]]);
    expect(by.inner.detail!.markdown).toContain("ssh -J marko inner");
    expect(by.deck).toMatchObject({ subtitle: "192.168.1.9", accessories: [{ text: "deck" }] });
    expect(by.steamdeck.subtitle).toBe("192.168.1.9");
    expect(by.work).toMatchObject({ subtitle: "work.example.com", accessories: [{ text: "me" }] });
    expect(by.extra.subtitle).toBe("extra.example.com");
    expect(by.bare.subtitle).toBeUndefined();
    expect(by.bare.accessories).toEqual([]);
    expect(by.marko.actions!.map((a) => a.id)).toEqual(["connect", "copy-host", "copy-command", "ping"]);
    // Connect takes one optional argument in the bar: the command to run there.
    expect(by.marko.args).toEqual([{ id: "command", placeholder: "Command (blank: a shell)" }]);
    // A ProxyJump is a tag and a keyword, and adds the -J copy.
    expect(by.inner).toMatchObject({ keywords: ["10.0.0.7", "marko"], accessories: [{ tag: "via marko", color: "blue" }] });
    expect(by.inner.actions!.map((a) => a.id)).toEqual(["connect", "copy-host", "copy-command", "copy-jump", "ping"]);
  });

  test("known_hosts only with the setting on: names, [host]:port unwrapped, hashed, IPs and configured ones skipped", async () => {
    host.changeSettings("ssh", { settings: { config, include_known_hosts: true } });
    const items = await list();
    const known = items.filter((i) => i.section === "Known hosts");
    expect(known.map((i) => i.id)).toEqual(["archer", "archer.lan", "nas.lan"]);
    expect(items.slice(0, 8).every((i) => i.section !== "Known hosts")).toBe(true);
    host.changeSettings("ssh", { settings: { config } });
    expect((await list()).some((i) => i.section === "Known hosts")).toBe(false);
  });

  test("copy actions, the -J form with the jump host", async () => {
    expect(await pick("marko", "copy-host")).toEqual({ copy: "marko" });
    expect(await pick("marko", "copy-command")).toEqual({ copy: "ssh marko" });
    expect(await pick("inner", "copy-jump")).toEqual({ copy: "ssh -J marko inner" });
    expect(await pick("marko", "copy-jump")).toEqual({ copy: "ssh marko" });
  });

  test("connect: a shell without values or with a blank command; a typed command runs over ssh -t and the window waits for Enter", async () => {
    expect(await pick("marko", "connect")).toEqual({});
    expect(opened().slice(-2)).toEqual(["ssh", "marko"]);
    expect(await pick("marko", "connect", { command: "" })).toEqual({});
    expect(opened().slice(-2)).toEqual(["ssh", "marko"]);
    expect(await pick("marko", "connect", { command: "uptime -p" })).toEqual({});
    const argv = opened();
    expect(argv.slice(-3, -1)).toEqual(["sh", "-c"]);
    expect(argv.at(-1)).toMatch(/^ssh -t marko 'uptime -p'; s=\$\?; printf .*read -r _$/);
  });

  test("ping: the round trip as a toast for a host that answers, a failure toast for one that does not", async () => {
    if (!Bun.which("ping")) return;
    const ok = await pick("loop", "ping");
    expect(ok).toMatchObject({ keep: true, toast: { title: expect.stringMatching(/^127\.0\.0\.1: [\d.]+ ms$/) } });
    const bad = await pick("bare", "ping");
    expect(bad).toMatchObject({ keep: true, toast: { title: "bare did not answer", style: "failure" } });
  });

  test("a missing config lists one hint row rather than failing", async () => {
    host.changeSettings("ssh", { settings: { config: join(dir, "nope") } });
    expect(await list()).toMatchObject([{ id: "hint:empty", name: "No hosts in your ssh config", actions: [] }]);
    host.changeSettings("ssh", { settings: { config } });
  });
});
