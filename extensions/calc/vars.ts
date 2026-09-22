// Variables: `[extensions.calc] vars`, one `name = value` line each
// (`salary_hour = 54 usd`, `rent = 42000 try`, `height = 183 cm`). A value
// may use other variables (`salary_day = salary_hour * 8`). A query naming
// one is expanded in place, each name to its value in parentheses, before
// the parsers see it; currencies inside are then carried by `money.ts`.

const NAME = /^[a-z_][a-z0-9_]*$/i;
const DEPTH = 8;

/** The declared variables by lower-cased name. A line that is not `name = value` is skipped. */
export function parseVars(lines: unknown): Map<string, string> {
  const vars = new Map<string, string>();
  if (!Array.isArray(lines)) return vars;
  for (const line of lines) {
    const m = String(line).match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
    if (m && NAME.test(m[1])) vars.set(m[1].toLowerCase(), m[2]);
  }
  return vars;
}

const words = (q: string) => q.match(/[a-z_][a-z0-9_]*/gi) ?? [];

/** Whether the query names a variable. */
export const usesVar = (q: string, vars: Map<string, string>): boolean => words(q).some((w) => vars.has(w.toLowerCase()));

/** The query with every variable replaced by its value, recursively; undefined when it names none (or they loop). */
export function expand(q: string, vars: Map<string, string>): string | undefined {
  if (!usesVar(q, vars)) return;
  let s = q;
  for (let i = 0; i < DEPTH && usesVar(s, vars); i++) s = s.replace(/[a-z_][a-z0-9_]*/gi, (w) => (vars.has(w.toLowerCase()) ? `(${vars.get(w.toLowerCase())})` : w));
  return usesVar(s, vars) ? undefined : s;
}
