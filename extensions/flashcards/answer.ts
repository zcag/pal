// A typed answer against the card's: pure, shared by the page (served
// transpiled) and the tests. Forgiving where a learner's answer is right
// in substance: case, punctuation, ¿¡, a leading "to " on an English verb,
// words in parentheses, and any one of several answers ("of, from" takes
// either). An accent left off or one slip of the finger (a letter off in a
// longer word) is "close": it counts, and the page shows what differed.
// A missing article on a noun ("gato" for "el gato") is close too: the
// gender is the part worth learning, so it is shown, not failed.

export type Verdict = "exact" | "close" | "wrong";
export type Checked = { verdict: Verdict; /** The accepted answer nearest to what was typed. */ nearest: string; why?: "accent" | "typo" | "article" };

const ARTICLES = /^(el|la|los|las|un|una|unos|unas|the|a|an|le|les|l'|der|die|das|il|lo|gli)\s+/;

/** Lowercase, trimmed, no punctuation or parentheses, spaces collapsed; accents kept. */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFC")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[¿¡?!.,;:"“”«»…]/g, " ")
    .replace(/^\s*to\s+/, "")
    .replace(/\s+/g, " ").trim();
}

/** Without accents; ñ becomes n too (an English keyboard has none), which `check` calls close, never exact. */
export const bare = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const noArticle = (s: string) => s.replace(ARTICLES, "");

/** The answers a card's side accepts: split on , ; / and "or", each normalised. */
export function answers(side: string): string[] {
  const parts = side.split(/\s*[,;/]\s*|\s+or\s+/i).map(norm).filter(Boolean);
  return parts.length ? [...new Set(parts)] : [norm(side)];
}

/** Levenshtein distance, stopping early past `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function check(typed: string, side: string): Checked {
  const t = norm(typed);
  const all = answers(side);
  if (!t) return { verdict: "wrong", nearest: all[0] };
  if (all.includes(t)) return { verdict: "exact", nearest: t };
  for (const a of all) if (bare(a) === bare(t)) return { verdict: "close", nearest: a, why: "accent" };
  for (const a of all) {
    const na = noArticle(a), nt = noArticle(t);
    if (na !== a && (na === nt || bare(na) === bare(nt))) return { verdict: "close", nearest: a, why: "article" };
    if (na === a && nt !== t && bare(na) === bare(nt)) return { verdict: "close", nearest: a, why: "article" };
  }
  for (const a of all) {
    const b = bare(noArticle(a));
    if (b.length >= 5 && distance(b, bare(noArticle(t)), 1) <= 1) return { verdict: "close", nearest: a, why: "typo" };
  }
  return { verdict: "wrong", nearest: all.reduce((m, a) => (distance(bare(a), bare(t), 99) < distance(bare(m), bare(t), 99) ? a : m), all[0]) };
}

/**
 * The expected answer letter by letter against what was typed, for the page
 * to colour: each run is `ok` (matched), `accent` (the letter typed without
 * its accent, or with the wrong one), `miss` (in the answer, not typed or
 * typed differently) or `extra` (typed, not in the answer). A plain LCS
 * alignment over letters compared without accents; answers are words, so
 * the table is small.
 */
export type Run = { text: string; kind: "ok" | "accent" | "miss" | "extra" };
export function diff(typed: string, expected: string): Run[] {
  const a = [...typed], b = [...expected];
  const low = (x: string) => x.toLowerCase();
  const same = (x: string, y: string) => bare(low(x)) === bare(low(y));
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = same(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Run[] = [];
  const push = (text: string, kind: Run["kind"]) => { const last = out[out.length - 1]; if (last?.kind === kind) last.text += text; else out.push({ text, kind }); };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) { push(b[j], low(a[i]) === low(b[j]) ? "ok" : "accent"); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push(a[i++], "extra");
    else push(b[j++], "miss");
  }
  while (i < a.length) push(a[i++], "extra");
  while (j < b.length) push(b[j++], "miss");
  return out;
}
