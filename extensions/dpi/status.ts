// What `dpi status` prints, read into facts and judged: `on`, `off`, or
// `partial` (half of it in effect, which is what a crashed proxy or a
// `networksetup` left behind looks like). Pure: index.ts runs the script,
// the tests feed canned output from both platforms.
//
// macOS (`macos_status` in the script):
//   proxy   : up (pid 4242, :1080)        | proxy   : down
//   service : Wi-Fi
//   dns     : 1.1.1.1 9.9.9.9             | dns     : There aren't any DNS Servers set on Wi-Fi.
//   socks   : 127.0.0.1:1080              | socks   : off
// Linux (`linux_status`): one `<service> <state>` line per systemd unit, a
// blank, then `DNS <answer>` for a known-blocked name resolved through the
// stub resolver.

export type State = "off" | "on" | "partial";

/** The macOS facts: the byedpi process, the network service the script points at it, that service's DNS list and SOCKS target (`host:port`, `null` while off). */
export type MacFacts = { platform: "macos"; proxy: { up: boolean; pid?: number; port?: number }; service: string; dns: string[]; socks: string | null };
/** The Linux facts: every unit's `systemctl is-active` word, and what the resolver answered for the probe name (`null` for nothing). */
export type LinuxFacts = { platform: "linux"; services: { name: string; state: string }[]; probe: string | null };
export type Facts = MacFacts | LinuxFacts;

/** The judged status: the state, why it is partial when it is, the facts, and the proxy port to test through (the script's default while the proxy is down). */
export type Status = { state: State; reason?: string; facts: Facts; port: number; raw: string };

/** The script's `PORT`; what the status line prints wins over it. */
export const DEFAULT_PORT = 1080;
/** BTK's block page: what a hijacked resolver answers for a blocked name (the script's header). */
export const BLOCK_PAGE = "195.175.254.2";
/** The script's `DNS_ON`, the default of the `dns` setting. */
export const DEFAULT_DNS = ["1.1.1.1", "9.9.9.9"];

const isIp = (s: string) => /^[0-9a-fA-F:.]+$/.test(s) && /[0-9]/.test(s);

/** The macOS shape, or `undefined` when the text is not it. */
export function parseMac(out: string): MacFacts | undefined {
  const line = (key: string) => new RegExp(`^${key}\\s*:\\s*(.*)$`, "m").exec(out)?.[1].trim();
  const proxy = line("proxy"), service = line("service"), dns = line("dns"), socks = line("socks");
  if (proxy === undefined || service === undefined || dns === undefined || socks === undefined) return;
  const up = /^up\b/.test(proxy);
  const pid = Number(/pid (\d+)/.exec(proxy)?.[1]);
  const port = Number(/:(\d+)\)?\s*$/.exec(proxy)?.[1]);
  return {
    platform: "macos",
    proxy: { up, ...(up && Number.isFinite(pid) && { pid }), ...(up && Number.isFinite(port) && { port }) },
    service,
    // "There aren't any DNS Servers set on Wi-Fi." is networksetup's sentinel for none.
    dns: dns.split(/\s+/).filter(isIp),
    socks: socks === "off" || !socks ? null : socks,
  };
}

/** The Linux shape, or `undefined` when the text is not it. */
export function parseLinux(out: string): LinuxFacts | undefined {
  const services: LinuxFacts["services"] = [];
  let probe: string | null | undefined;
  for (const raw of out.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^(\S+)\s+(.*)$/.exec(l);
    if (!m) continue;
    if (m[1] === "DNS") probe = m[2].trim() || null;
    else services.push({ name: m[1], state: m[2].trim() || "unknown" });
  }
  if (!services.length || probe === undefined) return;
  return { platform: "linux", services, probe };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The state from the facts. macOS: the proxy process, the service's SOCKS
 * pointing at `127.0.0.1:<port>` and its DNS set to the override are the
 * three halves; all three is `on`, none is `off`, anything else `partial`
 * with the reason. With no override configured DNS is not judged. Linux:
 * every unit active is `on` unless the probe still answers the block page;
 * none is `off`; some is `partial`.
 */
export function judge(facts: Facts, dnsOverride: string[] = DEFAULT_DNS): { state: State; reason?: string } {
  const on: string[] = [], off: string[] = [];
  if (facts.platform === "macos") {
    const port = facts.proxy.port ?? DEFAULT_PORT;
    (facts.proxy.up ? on : off).push(facts.proxy.up ? `proxy up (pid ${facts.proxy.pid ?? "?"})` : "proxy down");
    const socksOn = facts.socks === `127.0.0.1:${port}`;
    (socksOn ? on : off).push(socksOn ? "SOCKS on" : facts.socks ? `SOCKS at ${facts.socks}` : "SOCKS off");
    if (dnsOverride.length) {
      const dnsOn = sameSet(facts.dns, dnsOverride);
      (dnsOn ? on : off).push(dnsOn ? "DNS overridden" : facts.dns.length ? `DNS at ${facts.dns.join(" ")}` : "DNS not overridden");
    }
  } else {
    for (const s of facts.services) (s.state === "active" ? on : off).push(`${s.name} ${s.state === "active" ? "up" : s.state}`);
    if (!off.length && facts.probe === BLOCK_PAGE) return { state: "partial", reason: `${on.join(", ")}, but DNS still answers the block page` };
  }
  if (!off.length) return { state: "on" };
  if (!on.length) return { state: "off" };
  return { state: "partial", reason: `${cap(on.join(", "))}, but ${off.join(" and ")}` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `dpi status` output on `platform` as a `Status`; throws when the text is neither shape (the script printed an error, or something else answered). */
export function parseStatus(out: string, platform: "macos" | "linux", dnsOverride: string[] = DEFAULT_DNS): Status {
  const facts = platform === "macos" ? parseMac(out) : parseLinux(out);
  if (!facts) throw new Error(`unexpected status output: ${out.trim().split("\n")[0] || "(nothing)"}`);
  const port = facts.platform === "macos" && facts.proxy.port ? facts.proxy.port : DEFAULT_PORT;
  return { ...judge(facts, dnsOverride), facts, port, raw: out.trim() };
}

/** One line for a subtitle or a tooltip: what is in effect, in the script's own words (`Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9`). */
export function summary(st: Status): string {
  if (st.state === "partial") return st.reason ?? "Partly on";
  const f = st.facts;
  if (f.platform === "macos") return st.state === "on" ? `${f.service} -> socks5://${f.socks}, dns ${f.dns.join(" ")}` : `${f.service} as before, byedpi down`;
  const names = f.services.map((s) => s.name).join(" + ");
  return st.state === "on" ? `${names} up, resolver -> 127.0.0.1` : `${names} down, resolver as before`;
}

/** The facts as label/value pairs, for the detail pane, the popover card and the copied text. */
export function factLines(st: Status): [string, string][] {
  const f = st.facts;
  if (f.platform === "macos") {
    return [
      ["Proxy", f.proxy.up ? `up (pid ${f.proxy.pid ?? "?"}, :${f.proxy.port ?? st.port})` : "down"],
      ["Service", f.service],
      ["DNS", f.dns.length ? f.dns.join(" ") : "not set (the ISP's)"],
      ["SOCKS", f.socks ?? "off"],
    ];
  }
  return [...f.services.map((s): [string, string] => [s.name, s.state]), ["DNS probe", f.probe === BLOCK_PAGE ? `${f.probe} (the block page)` : f.probe ?? "no answer"]];
}

/** The `Turn on` / `Turn off` word for a state: off asks for on, anything else for off. */
export const nextWord = (state: State): "on" | "off" => (state === "off" ? "on" : "off");
