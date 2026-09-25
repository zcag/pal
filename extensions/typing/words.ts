// The words a test is made of. WORDS is 244 of the most common English
// words, picked by hand from the everyday core of the language (function
// words, the common verbs, nouns and adjectives), no proper nouns and
// nothing capitalised; a plain list of common words, written for pal.
//
// `generate` draws them at random, never the same word twice in a row, and
// dresses them for the punctuation and numbers options: a capital to open
// a sentence, a comma, a full stop, now and then a question, a colon, a
// word in quotes or brackets, a dash; a number (1 to 4 digits) in place of
// a word. Pure, the rng injected, so the tests pin a draw.
export const WORDS: readonly string[] = `
the be of and a to in he have it that for they with as not on she at by this we you do but from or which one would all
will there say who make when can more if no man out other so what time up go about than into could state only new year
some take come these know see use get like then first any work now may such give over think most even find day also after
way many must look before great back through long where much should well people down own just because good each those
feel seem how high too place little world very still nation hand old life tell write become here show house both between
need mean call develop under last right move thing general school never same another begin while number part turn real
leave might want point form off child few small since against ask late home interest large person end open public follow
during present without again hold around possible head consider word program problem however lead system set order eye
plan run keep face fact group play stand increase early course change help line city put close case force meet once water
upon war build hear light unite live every country bring center let side try provide continue name certain power pay
result question study woman member until far night always service away report something company week church toward start
`.trim().split(/\s+/);

export type Dress = { punctuation: boolean; numbers: boolean };

const pick = <T>(xs: readonly T[], rng: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/** A number the length of a short word: 1 to 4 digits, no leading zero. */
function number(rng: () => number): string {
  const digits = 1 + Math.floor(rng() * 4);
  let s = String(1 + Math.floor(rng() * 9));
  while (s.length < digits) s += Math.floor(rng() * 10);
  return s;
}

/**
 * `n` more words after `prev` (the test so far: the next one must not repeat its last, and a sentence it left open
 * goes on). With punctuation the words form sentences: the first capitalised, one in eight or so ends one.
 */
export function generate(n: number, dress: Dress, rng: () => number = Math.random, prev: readonly string[] = []): string[] {
  const out: string[] = [];
  let last = prev.length ? prev[prev.length - 1] : "";
  let open = !last || /[.?!]$/.test(last);
  for (let i = 0; i < n; i++) {
    let w: string;
    do w = pick(WORDS, rng); while (w === bare(last));
    if (dress.numbers && rng() < 0.12) w = number(rng);
    else if (dress.punctuation) {
      if (open) w = cap(w);
      const r = rng();
      if (r < 0.1) w += pick([".", ".", ".", "?", "!"], rng);
      else if (r < 0.19) w += ",";
      else if (r < 0.21) w += pick([";", ":"], rng);
      else if (r < 0.235) w = `"${w}"`;
      else if (r < 0.25) w = `(${w})`;
      else if (r < 0.265 && !open) w = "-";
    }
    open = dress.punctuation && /[.?!]$/.test(w);
    out.push(w);
    last = w;
  }
  return out;
}

/** A word without its dress: what "the same word" compares. */
const bare = (w: string) => w.replace(/[^a-z]/gi, "").toLowerCase();
