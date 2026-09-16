// Builds answers.txt and allowed.txt from two public domain sources, so the
// lists are reproducible and nothing is fetched at runtime:
//
//   12dicts 6.0.2 (Alan Beale), released to the public domain: the
//   American 3esl and 6of12 lists (words in at least three ESL
//   dictionaries, and in at least six of twelve dictionaries) give the
//   answers; every 12dicts list that is public domain (not 2of12inf and
//   2+2+3, which derive from AGID) feeds the allowed guesses.
//   http://wordlist.aspell.net/12dicts/
//
//   ENABLE (Enhanced North American Benchmark Lexicon), public domain: the
//   rest of the allowed guesses.
//   https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
//
// Answers are the five-letter, lower-case, unmarked words of 3esl and 6of12
// with plurals and third-person forms dropped (a word ending in `s` whose
// stem is itself a word in those lists) and a short block list, sorted; the daily pick walks them
// in a fixed permutation (words.ts), so the order matters and must not
// change once shipped. Allowed is the union of all the lists' five-letter
// words plus the answers.
//
//   bun run extensions/wordle/build.ts <12dicts dir> <enable1.txt>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, enable] = process.argv.slice(2);
if (!dir || !enable) throw new Error("usage: build.ts <12dicts dir> <enable1.txt>");
const lines = (p: string) => readFileSync(p, "latin1").split(/\r?\n/).map((l) => l.trim());
const five = (ws: string[]) => new Set(ws.filter((w) => /^[a-z]{5}$/.test(w)));

const esl = lines(join(dir, "American/3esl.txt"));
const six = lines(join(dir, "American/6of12.txt"));
const stems = new Set([...esl, ...six].map((w) => w.replace(/[^a-z]/g, "")));
const plural = (w: string) => w.endsWith("s") && !w.endsWith("ss") && (stems.has(w.slice(0, -1)) || (w.endsWith("es") && stems.has(w.slice(0, -2))) || (w.endsWith("ies") && stems.has(w.slice(0, -3) + "y")));
/** Slurs and words nobody wants as the day's answer; still allowed as guesses. */
const unkind = new Set(["bimbo", "bitch", "chink", "fagot", "penis", "pussy", "vulva", "whore", "negro", "spick", "kraut", "honky", "darky", "gooks", "dykes", "homos", "nazis", "raped", "rapes", "slant", "spade", "tramp"]);
const answers = [...new Set([...five(esl), ...five(six)])].filter((w) => !plural(w) && !unkind.has(w)).sort();

const pd = ["American/3esl.txt", "American/2of12.txt", "American/6of12.txt", "International/3of6game.txt", "International/3of6all.txt", "International/2of4brif.txt", "International/5d+2a.txt"];
const allowed = new Set<string>(answers);
for (const f of pd) for (const w of five(lines(join(dir, f)))) allowed.add(w);
for (const w of five(lines(enable))) allowed.add(w);

const out = (name: string, words: Iterable<string>) => {
  const list = [...words].sort();
  writeFileSync(new URL(`./${name}`, import.meta.url), list.join("\n") + "\n");
  console.log(`${name}: ${list.length} words`);
};
out("answers.txt", answers);
out("allowed.txt", allowed);
