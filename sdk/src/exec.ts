// One way to run a program from an extension: spawned with no stdin (or
// the text given), stdout and stderr collected whole, killed after `ms`.
// The pieces the extensions were each writing around `Bun.spawn`.

export type Exec = {
  /** The exit code; what `Bun.spawn`'s `exited` answers after a kill on timeout too. */
  code: number;
  out: string;
  err: string;
  /** The timer fired before it exited. */
  timedOut: boolean;
};

export type ExecOptions = { ms?: number; cwd?: string; stdin?: string; env?: Record<string, string | undefined> };

/** Default wait before the process is killed. */
export const EXEC_MS = 10_000;

/** Runs `argv` to completion or `ms`; the code, the two streams and whether it was cut short. Rejects only when it could not start. */
export async function exec(argv: string[], o: ExecOptions = {}): Promise<Exec> {
  const proc = Bun.spawn(argv, { cwd: o.cwd, env: o.env as Record<string, string> | undefined, stdin: o.stdin === undefined ? "ignore" : new TextEncoder().encode(o.stdin), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, o.ms ?? EXEC_MS);
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err, timedOut };
  } finally { clearTimeout(timer); }
}

/** `exec` that answers stdout and throws on a non-zero exit (stderr's text, else the code) or a timeout. */
export async function run(argv: string[], o: ExecOptions = {}): Promise<string> {
  const r = await exec(argv, o);
  if (r.timedOut) throw new Error(`${argv[0]} did not finish in ${Math.round((o.ms ?? EXEC_MS) / 1000)} s`);
  if (r.code !== 0) throw new Error(r.err.trim() || `${argv[0]} exited ${r.code}`);
  return r.out;
}
