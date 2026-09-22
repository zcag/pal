// The process table, one `ps` on either platform: what the Processes
// palette lists and the Stats popovers rank. `comm` goes last on the
// line because on macOS it is the executable's full path and may hold
// spaces; every other column is a number.
import { exec } from "./exec.ts";

/** One process: `cpu` is `%cpu` as ps reports it, `rss` resident KiB, `comm` the command (a path on macOS), `name` its basename. */
export type Proc = { pid: number; ppid: number; uid: number; cpu: number; rss: number; comm: string; name: string };

/** `ps` with headers off: pid, parent, uid, %cpu, %mem, rss, comm. */
export const PS_ARGV = process.platform === "linux" ? ["ps", "-eo", "pid=,ppid=,uid=,%cpu=,%mem=,rss=,comm="] : ["ps", "-axo", "pid=,ppid=,uid=,%cpu=,%mem=,rss=,comm="];
export const PS_MS = 5000;

/** The lines `PS_ARGV` prints as processes; a line that is not seven fields is skipped. */
export function parsePs(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const comm = m[7].trim();
    if (!comm) continue;
    procs.push({ pid: +m[1], ppid: +m[2], uid: +m[3], cpu: +m[4], rss: +m[6], comm, name: comm.slice(comm.lastIndexOf("/") + 1) });
  }
  return procs;
}

/** Every process right now (about 20 ms for 700 of them on a laptop). */
export const listProcesses = async (): Promise<Proc[]> => parsePs((await exec(PS_ARGV, { ms: PS_MS })).out);
