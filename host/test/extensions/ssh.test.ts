// ssh against a temp ~/.ssh fixture: the `config` setting points at it, so
// the real ~/.ssh is never read.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

let host: Host;
beforeAll(async () => {
  host = await Host.bundled({ settings: { ssh: { settings: { config } } } });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("ssh", "ssh");
const pick = (id: string, action?: string) => host.pick("ssh", "ssh", id, action);

describe("ssh", () => {
  test("meta: indexed, not live", () => {
    expect(host.loaded().find((l) => l.extension === "ssh")!.palettes[0]).toMatchObject({ name: "ssh", title: "SSH Hosts", live: false, input: false, placeholder: "Connect to a host" });
  });

  test("Host names in file order, includes one level, patterns and Match blocks skipped", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["work", "extra", "marko", "deck", "steamdeck", "bare"]);
    expect(items.every((i) => i.section === "Configured")).toBe(true);
  });

  test("HostName is the subtitle and a keyword; User and Port are accessories; key=value works", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by.marko).toMatchObject({ name: "marko", subtitle: "marko.lan", keywords: ["marko.lan", "cagdas"], accessories: [{ text: "cagdas" }, { tag: ":2222" }] });
    expect(by.deck).toMatchObject({ subtitle: "192.168.1.9", accessories: [{ text: "deck" }] });
    expect(by.steamdeck.subtitle).toBe("192.168.1.9");
    expect(by.work).toMatchObject({ subtitle: "work.example.com", accessories: [{ text: "me" }] });
    expect(by.extra.subtitle).toBe("extra.example.com");
    expect(by.bare.subtitle).toBeUndefined();
    expect(by.bare.accessories).toEqual([]);
    expect(by.marko.actions!.map((a) => a.id)).toEqual(["connect", "copy-host", "copy-command"]);
  });

  test("known_hosts only with the setting on: names, [host]:port unwrapped, hashed, IPs and configured ones skipped", async () => {
    host.changeSettings("ssh", { settings: { config, include_known_hosts: true } });
    const items = await list();
    const known = items.filter((i) => i.section === "Known hosts");
    expect(known.map((i) => i.id)).toEqual(["archer", "archer.lan", "nas.lan"]);
    expect(items.slice(0, 6).every((i) => i.section === "Configured")).toBe(true);
    host.changeSettings("ssh", { settings: { config } });
    expect((await list()).some((i) => i.section === "Known hosts")).toBe(false);
  });

  test("copy actions", async () => {
    expect(await pick("marko", "copy-host")).toEqual({ copy: "marko" });
    expect(await pick("marko", "copy-command")).toEqual({ copy: "ssh marko" });
  });

  test("a missing config lists nothing rather than failing", async () => {
    host.changeSettings("ssh", { settings: { config: join(dir, "nope") } });
    expect(await list()).toEqual([]);
    host.changeSettings("ssh", { settings: { config } });
  });
});
