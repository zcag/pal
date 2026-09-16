// Listening TCP ports as data: the `lsof -F pcn` records (macOS, and Linux
// without `ss`) and `ss -ltnpH` lines (Linux). Pure, so the tests need no
// sockets. Both answer one entry per process and port, ports deduplicated
// (IPv4 and IPv6 listeners of one port are one).

export type Listener = { pid: number; command: string; port: number; address: string };

/** `p<pid>` starts a process, `c<command>` names it, every `n<addr>:<port>` under it is a listener. */
export function parseLsofListeners(out: string): Listener[] {
  const found: Listener[] = [];
  const seen = new Set<string>();
  let pid = 0, command = "";
  for (const line of out.split("\n")) {
    const tag = line[0], rest = line.slice(1);
    if (tag === "p") { pid = +rest; command = ""; }
    else if (tag === "c") command = rest;
    else if (tag === "n") {
      const m = rest.match(/^(.*):(\d+)$/);
      if (!m || !pid || seen.has(`${pid}:${m[2]}`)) continue;
      seen.add(`${pid}:${m[2]}`);
      found.push({ pid, command, port: +m[2], address: m[1] });
    }
  }
  return found;
}

/** `LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3),("sshd",pid=1235,fd=3))`: one entry per pid in `users`. */
export function parseSsListeners(out: string): Listener[] {
  const found: Listener[] = [];
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[0] === "LISTEN" ? cols[3] : cols[4] === "LISTEN" ? cols[3] : cols[3];
    const m = local?.match(/^(.*):(\d+)$/);
    if (!m) continue;
    for (const u of line.matchAll(/\("([^"]*)",pid=(\d+)/g)) {
      const key = `${u[2]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ pid: +u[2], command: u[1], port: +m[2], address: m[1].replace(/^\[|\]$/g, "") });
    }
  }
  return found;
}

/** The `:port` query form: `:` alone is every listener, `:30` those whose port starts with 30, `:3000` that port. */
export const portQuery = (q: string): string | undefined => (q.startsWith(":") && /^:\d*$/.test(q) ? q.slice(1) : undefined);
