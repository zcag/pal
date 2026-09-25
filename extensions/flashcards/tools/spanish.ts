// Builds the bundled Spanish packs. The words are Jeff Doozan's "6001
// Spanish" deck (github.com/doozan/6001_Spanish, its last built notes.csv,
// pinned below): the 6001 most used Spanish lemmas, with phrases where a
// word lives in one (sin embargo), junk excluded, gender and part of speech,
// Wiktionary's senses with the deck's short "hint" glosses marked, and three
// example pairs from Tatoeba's reviewed lists. This script keeps the hint
// glosses (parentheses and "Compare …" asides dropped, three senses at
// most), picks the example that uses the word as written at a readable
// length, and weights each word by its share of spoken Spanish (hermitdave's
// OpenSubtitles counts, lemmatised in doozan/spanish_data) for "the words
// you know cover N%". Regenerate with
//
//   bun extensions/flashcards/tools/spanish.ts [dir with notes.csv and frequency.csv]
//
// (downloads them when no dir is given; ~11 MB). Writes packs/spanish-words.json
// (CC BY-SA 4.0: Wiktionary, FrequencyWords; sentences CC BY 2.0 FR, Tatoeba:
// see packs/LICENSE.md) and packs/spanish-phrases.json (PHRASES below,
// written for the pack).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOTES = "https://raw.githubusercontent.com/doozan/6001_Spanish/3ab6b9e45ed352fd60acd08c0840cd76fa492417/notes.csv";
const FREQ = "https://raw.githubusercontent.com/doozan/spanish_data/master/frequency.csv";
const out = join(import.meta.dir, "..", "packs");

let dir = process.argv[2];
if (!dir) {
  dir = await mkdtemp(join(tmpdir(), "spanish-data-"));
  await Bun.write(join(dir, "notes.csv"), await fetch(NOTES));
  await Bun.write(join(dir, "frequency.csv"), await fetch(FREQ));
}
const read = (f: string) => readFile(join(dir!, f), "utf8");

/** RFC 4180 CSV: quoted fields with commas, doubled quotes and newlines. */
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const unhtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/** "to be (have a (transient) location in space). Compare ser" → "to be": the hint glosses, asides out, three senses at most, ~34 characters. */
function gloss(data: string): string | undefined {
  // Reflexive hints ("to look, to seem" under ver) only when the word has nothing else.
  const hints = [...data.matchAll(/<span class="pos ([^"]*\bhint\b[^"]*)">(.*?)<\/span>\s*(?=<span class="pos|<\/div>)/gs)];
  const plain = hints.filter((m) => !/reflexive/.test(m[1]));
  const spans = (plain.length ? plain : hints).map((m) => m[2]);
  const all = spans.length ? spans : [...data.matchAll(/<span class="pos [^"]*">(.*?)<\/span>\s*(?=<span class="pos|<\/div>)/gs)].slice(0, 2).map((m) => m[1]);
  const parts: string[] = [];
  const key = (t: string) => t.toLowerCase().replace(/^to /, "");
  for (const span of all) {
    const g = span.match(/<span class="gloss">(.*?)<\/span>/s)?.[1];
    if (!g) continue;
    let t = unhtml(g);
    // Nested parentheses first, then the outer ones; then "Compare x", "See x", trailing "etc".
    for (let k = 0; k < 3; k++) t = t.replace(/\([^()]*\)/g, "");
    // "… Compare ser", "See x": a cross-reference, capitalised (not the "see" in "to see").
    t = t.replace(/(^|\.\s*|\s)(Compare|See|Synonyms?|Antonyms?)\b.*$/, "").replace(/\[[^\]]*\]/g, "").replace(/\s*\+\s*\w+/g, "").replace(/\s+/g, " ").replace(/\s+([,;.])/g, "$1").replace(/[.;,\s]+$/, "").trim();
    for (const p of t.split(/[;,]\s*/)) {
      // A parenthesis the split cut open ("to advance (to make"), and a ": used to…" explanation.
      const s = p.replace(/\s*\([^)]*$/, "").replace(/:\s.*$/, "").trim();
      if (!s || /^etc\.?$/i.test(s) || parts.some((x) => key(x) === key(s))) continue;
      if ([...parts, s].join(", ").length > 34) return parts.length ? parts.join(", ") : s;
      parts.push(s);
      if (parts.length === 3) return parts.join(", ");
    }
  }
  return parts.length ? parts.join(", ") : undefined;
}

type Pair = { es: string; en: string };
/** The pair that uses the word as written, at four to eight words, translated about as long as it is. */
function example(sentences: string, word: string): Pair | undefined {
  const es = [...sentences.matchAll(/<span class="spa">(.*?)<\/span>/gs)].map((m) => unhtml(m[1]));
  const en = [...sentences.matchAll(/<span class="eng">(.*?)<\/span>/gs)].map((m) => unhtml(m[1]));
  const pairs = es.map((s, i) => ({ es: s, en: en[i] ?? "" })).filter((p) => p.es && p.en);
  const head = word.split(" ")[0];
  const stem = head.length > 4 ? head.slice(0, head.length - 2) : head;
  const re = new RegExp(`(^|[^\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu");
  const n = (s: string) => s.split(/\s+/).length;
  const score = (p: Pair) => (re.test(p.es) ? 0 : 4) + Math.max(0, Math.abs(n(p.es) - 6) - 2) + Math.abs(n(p.es) - n(p.en)) * 0.5 + (p.es.length > 60 ? 3 : 0);
  return pairs.sort((a, b) => score(a) - score(b))[0];
}

const POS: Record<string, string> = { v: "verb", adj: "adjective", adv: "adverb", prep: "preposition", conj: "conjunction", pron: "pronoun", num: "number", interj: "interjection", art: "article", determiner: "determiner", phrase: "phrase", prop: "name", contraction: "contraction" };
const GENDER: Record<string, [string, string]> = { m: ["el", "masculine"], f: ["la", "feminine"], mf: ["el/la", "masculine or feminine"], "m-p": ["los", "masculine plural"], "f-p": ["las", "feminine plural"], "mf-p": ["los/las", "plural"] };
// A feminine noun starting with a stressed a takes el (el agua); the deck marks them "f".
const EL = /^(agua|alma|arma|hambre|águila|área|aula|ave|hacha|habla|ala|arte|hada|asma|ancla|aguja?)$/;

// The few the deck's glosses leave empty ("...; ...").
const FIX: Record<string, string> = { bus: "bus" };

// ---- words -------------------------------------------------------------
const freq = csv(await read("frequency.csv")).slice(1).filter((r) => r[0]);
const total = freq.reduce((s, r) => s + Number(r[0]), 0);
const count = new Map<string, number>();
for (const [n, lemma] of freq) count.set(lemma, (count.get(lemma) ?? 0) + Number(n));
const cards: Record<string, unknown>[] = [];
let noExample = 0;
const ids = new Set<string>();
for (const [word, pos, , data, sentences] of csv(await read("notes.csv")).slice(1)) {
  if (!word || !data) continue;
  const back = Object.hasOwn(FIX, word) ? FIX[word] : gloss(data);
  if (!back) { console.warn(`words: no gloss for ${word}`); continue; }
  const g = GENDER[pos];
  const front = g ? `${EL.test(word) && pos === "f" ? "el" : g[0]} ${word}` : word;
  const ex = example(sentences ?? "", word);
  if (!ex) noExample++;
  // A word listed twice (bajo as adjective and as preposition) is two cards: the second one's id names its part of speech.
  const id = ids.has(word) ? `${word}·${pos}` : word;
  ids.add(word);
  cards.push({
    id,
    front,
    back,
    note: g ? `noun · ${g[1]}` : POS[pos] ?? pos,
    ...(ex && { example: ex.es, example_back: ex.en }),
    weight: Number(((count.get(word) ?? 0) / total).toFixed(7)),
  });
}
await writeFile(join(out, "spanish-words.json"), JSON.stringify({
  title: "Spanish: 6000 most common words",
  description: "The words of everyday Spanish, most used first, each with an example sentence: Jeff Doozan's 6001 Spanish deck. The first thousand cover most of what you hear.",
  lang: { front: "es", back: "en" },
  reverse: true,
  source: "Jeff Doozan's 6001 Spanish (github.com/doozan/6001_Spanish): English Wiktionary and hermitdave/FrequencyWords (OpenSubtitles), CC BY-SA 4.0; sentences from Tatoeba, CC BY 2.0 FR.",
  license: "CC BY-SA 4.0",
  cards,
}, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`spanish-words: ${cards.length} cards, ${noExample} without an example`);

// ---- phrases -----------------------------------------------------------
// Everyday phrases, written for this pack (set phrases like these are
// nobody's): Spanish, English, and a note where the register matters.
const PHRASES: [string, string, string?][] = [
  ["Hola.", "Hello / Hi"], ["Buenos días.", "Good morning"], ["Buenas tardes.", "Good afternoon", "until dark"], ["Buenas noches.", "Good evening / Good night"],
  ["Adiós.", "Goodbye"], ["Hasta luego.", "See you later"], ["Hasta mañana.", "See you tomorrow"], ["Nos vemos.", "See you"],
  ["¿Cómo estás?", "How are you?", "informal"], ["¿Cómo está usted?", "How are you?", "formal"], ["¿Qué tal?", "How's it going?"],
  ["Estoy bien, gracias.", "I'm fine, thanks"], ["¿Y tú?", "And you?"], ["Mucho gusto.", "Nice to meet you"], ["Igualmente.", "Likewise"],
  ["Gracias.", "Thank you / Thanks"], ["Muchas gracias.", "Thank you very much"], ["De nada.", "You're welcome"], ["Por favor.", "Please"],
  ["Lo siento.", "I'm sorry"], ["Perdón.", "Sorry / Excuse me", "bumping into someone"], ["Disculpe.", "Excuse me", "getting attention, formal"], ["Con permiso.", "Excuse me", "passing by"],
  ["Sí.", "Yes"], ["No.", "No"], ["Claro.", "Of course / Sure"], ["Vale.", "OK", "Spain"], ["Está bien.", "It's fine / OK"],
  ["No sé.", "I don't know"], ["No entiendo.", "I don't understand"], ["¿Puede repetirlo, por favor?", "Could you repeat that, please?"],
  ["Más despacio, por favor.", "Slower, please"], ["¿Habla inglés?", "Do you speak English?", "formal"], ["Hablo un poco de español.", "I speak a little Spanish"],
  ["¿Qué significa esto?", "What does this mean?"], ["¿Cómo se dice ... en español?", "How do you say ... in Spanish?"],
  ["¿Cómo te llamas?", "What's your name?", "informal"], ["Me llamo ...", "My name is ..."], ["¿De dónde eres?", "Where are you from?"], ["Soy de ...", "I'm from ..."],
  ["¿Cuántos años tienes?", "How old are you?"], ["Tengo treinta años.", "I'm thirty years old"],
  ["¿Dónde está el baño?", "Where is the bathroom?"], ["¿Dónde está la estación?", "Where is the station?"], ["¿Está lejos?", "Is it far?"],
  ["A la derecha.", "To the right"], ["A la izquierda.", "To the left"], ["Todo recto.", "Straight ahead"],
  ["¿Cuánto cuesta?", "How much is it?"], ["La cuenta, por favor.", "The bill, please"], ["¿Aceptan tarjeta?", "Do you take cards?"],
  ["Quisiera un café.", "I'd like a coffee"], ["Una cerveza, por favor.", "A beer, please"], ["Para llevar.", "To go / Takeaway"], ["¡Buen provecho!", "Enjoy your meal!"],
  ["¿Qué hora es?", "What time is it?"], ["Tengo hambre.", "I'm hungry"], ["Tengo sed.", "I'm thirsty"], ["Tengo frío.", "I'm cold"], ["Tengo calor.", "I'm hot"],
  ["Tengo sueño.", "I'm sleepy"], ["Estoy cansado.", "I'm tired"], ["Tengo prisa.", "I'm in a hurry"], ["Llego tarde.", "I'm late"],
  ["¡Ayuda!", "Help!"], ["¡Cuidado!", "Watch out!"], ["Llame a la policía.", "Call the police"], ["Necesito un médico.", "I need a doctor"], ["Estoy perdido.", "I'm lost"],
  ["Me gusta.", "I like it"], ["No me gusta.", "I don't like it"], ["Me encanta.", "I love it"], ["Te quiero.", "I love you"], ["Te echo de menos.", "I miss you", "Spain; Latin America: te extraño"],
  ["¡Qué bien!", "Great! / How nice!"], ["¡Qué lástima!", "What a shame!"], ["¡Felicidades!", "Congratulations!"], ["¡Salud!", "Cheers! / Bless you!"],
  ["¿Qué pasa?", "What's happening? / What's up?"], ["¿Qué haces?", "What are you doing?"], ["No pasa nada.", "It's no problem / Don't worry"], ["No importa.", "It doesn't matter"],
  ["Tienes razón.", "You're right"], ["Estoy de acuerdo.", "I agree"], ["Espera un momento.", "Wait a moment"], ["Vamos.", "Let's go / Come on"],
  ["Ven aquí.", "Come here"], ["¿Puedo ayudarle?", "Can I help you?", "formal"], ["¿Me ayudas?", "Can you help me?", "informal"],
  ["¿Tienes tiempo?", "Do you have time?"], ["Hace calor.", "It's hot", "weather"], ["Hace frío.", "It's cold", "weather"], ["Está lloviendo.", "It's raining"],
  ["¿Qué quieres?", "What do you want?"], ["¿Dónde vives?", "Where do you live?"], ["Vivo aquí.", "I live here"], ["¿A qué te dedicas?", "What do you do for a living?"],
  ["Buena suerte.", "Good luck"], ["¡Que te diviertas!", "Have fun!"], ["¡Buen viaje!", "Have a good trip!"], ["¡Feliz cumpleaños!", "Happy birthday!"],
  ["Que tengas un buen día.", "Have a nice day"], ["¿Estás seguro?", "Are you sure?"], ["Así es la vida.", "That's life"], ["Por supuesto.", "Of course"],
  ["A lo mejor.", "Maybe"], ["Ya veremos.", "We'll see"], ["Poco a poco.", "Little by little"], ["Mi casa es tu casa.", "Make yourself at home"],
];
const phrases = PHRASES.map(([es, en, note]) => ({ id: es, front: es, back: en, ...(note && { note }) }));
await writeFile(join(out, "spanish-phrases.json"), JSON.stringify({
  title: "Spanish: everyday phrases",
  description: "Greetings, getting by and small talk: the hundred phrases you need first.",
  lang: { front: "es", back: "en" },
  reverse: true,
  cards: phrases,
}, null, 0).replace(/\},\{/g, "},\n{"));
console.log(`spanish-phrases: ${phrases.length} cards`);
