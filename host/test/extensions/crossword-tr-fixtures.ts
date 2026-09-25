// Crossword's Turkish fixtures: kare bulmaca made for the tests and the
// screenshots (the grids filled from common crossword words, the clues
// written here; no paper's puzzle is copied into the repo), in each paper's
// own format, and a stand-in for the three sites serving them the way they do:
//
//   HaberTürk   a day page carrying `var _data = [...]` (answers placed by
//               their 1-based start)
//   Cumhuriyet  /api/list and /api/puzzle/<date>: the rows, the clues by
//               number, a photo over a block of squares as a data URL
//   Sabah       the month slider (POST, JSON with the articles' HTML), an
//               article with the player in an iframe, the player page with the
//               puzzle as base64 JSON; its grids cross Ç with C
import { gridOf } from "../../../extensions/crossword/game.ts";
import { cumhuriyetPuzzle } from "../../../extensions/crossword/turkish.ts";

type HtEntry = { clue: string; answer: string; orientation: "across" | "down"; startx: number; starty: number };

/** An entry list from rows of answers as [direction, 1-based x, 1-based y, answer, clue]. */
const entries = (list: [string, number, number, string, string][]): HtEntry[] =>
  list.map(([d, x, y, answer, clue]) => ({ clue, answer, orientation: d === "A" ? "across" : "down", startx: x, starty: y }));

//  T E M A # # # A
//  İ T İ # # F E K
//  # K A İ N A T #
//  M İ # N A Z İ K
//  # # S E N # # O
//  A # A K S İ # N
//  R # G # U R # U
//  E B U # K İ R #
export const HT_8 = entries([
  ["A", 1, 1, "TEMA", "Bir eserin ana düşüncesi"],
  ["A", 1, 2, "İTİ", "Köpeği, halk ağzıyla"],
  ["A", 6, 2, "FEK", "İpoteği kaldırma işlemi"],
  ["A", 2, 3, "KAİNAT", "Bütün gök cisimleriyle evren"],
  ["A", 1, 4, "Mİ", "Do ve re'den sonra gelen nota"],
  ["A", 4, 4, "NAZİK", "Başkalarına karşı ince, saygılı ve düşünceli davranan; kibar, zarif, ölçülü kimse"],
  ["A", 3, 5, "SEN", "İkinci tekil kişi zamiri"],
  ["A", 3, 6, "AKSİ", "Ters, huysuz"],
  ["A", 5, 7, "UR", "Vücutta oluşan şiş"],
  ["A", 1, 8, "EBU", "Arapça kökenli adlarda baba anlamı veren ön ek"],
  ["A", 5, 8, "KİR", "Temizlenmesi gereken leke"],
  ["D", 1, 1, "Tİ", "Si notasının eski adı"],
  ["D", 2, 1, "ETKİ", "Tesir"],
  ["D", 3, 1, "MİA", "Oyuncu Farrow'un adı"],
  ["D", 8, 1, "AK", "Beyaz, lekesiz"],
  ["D", 6, 2, "FAZ", "Evre, safha"],
  ["D", 7, 2, "ETİ", "Anadolu'nun eski halklarından, Hitit"],
  ["D", 4, 3, "İNEK", "Sütü için beslenen hayvan"],
  ["D", 5, 3, "NANSUK", "İnce, yumuşak bir pamuklu kumaş"],
  ["D", 8, 4, "KONU", "Üzerinde konuşulan şey, mevzu"],
  ["D", 3, 5, "SAGU", "Bazı palmiyelerden elde edilen nişasta"],
  ["D", 1, 6, "ARE", "Yüz metrekarelik yüzey ölçüsü"],
  ["D", 6, 6, "İRİ", "Büyük yapılı, cüsseli"],
]);

/** HaberTürk's day page around a puzzle. */
export const htPage = (id: number, data: HtEntry[]) =>
  `<!doctype html><html><head><title>Günün Kare Bulmacası</title></head><body><div id="crossword"></div><script>  $(document).ready( function(){ var _id = ${id}; var _data = ${JSON.stringify(data)}; $('#crossword').crossword({ id: _id, data: _data }); });</script></body></html>`;

// A 3 by 4 with a one-square photo down the right: KAŞ AYI ŞIK read both ways.
const SWATCH = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#E8B04A"/><circle cx="5" cy="4" r="2.4" fill="#7A4A2A"/></svg>`).toString("base64")}`;
export const CUM_SMALL = {
  date: "", no: "", title: "Günün Kare Bulmacası",
  solution: ["KAŞ#", "AYI#", "ŞIK#"],
  clues: { across: { 1: "Gözün üstündeki kıllar", 4: "Kutup hayvanı", 5: "Zarif, göz alıcı" }, down: { 1: "Kalın kaşlı, halk ağzıyla", 2: "Fotoğraftaki hayvan", 3: "Hoş, yakışıklı" } },
  media: [{ type: "image", src: SWATCH, row: 1, col: 4, rows: 3, cols: 1 }],
};

// A 17 by 11 in Cumhuriyet's shape for the screenshots: the photo (a drawing
// made here) over the 5 by 5 block in the middle, which ANKA's clue points at.
const BIG_ROWS = [
  "KARASU##İDEAL#İTİ",
  "ALACA#ÜNLÜ###ULAM",
  "SAF#CE#Aİ#KATRE#A",
  "AB#K#######SA##F#",
  "RAZAKI#####TRAKİT",
  "AŞAR#T#####A#TAL#",
  "#####R#####NİAMEY",
  "P#KANİ#####ANKA#U",
  "ALARA#AN#O##T#RAN",
  "KARASİ#AKYAKA#A#A",
  "##ESATİR#AVANE##K",
];
/** Clues by where the word starts (row, column, 0-based) and its direction: numbered the way the paper numbers them. */
const BIG_CLUES: [string, number, number, string][] = [
  ["A", 0, 0, "Sakarya'nın kıyı ilçesi"], ["A", 0, 8, "Ulaşılmak istenen en yüksek amaç, ülkü"], ["A", 0, 14, "Köpeği, halk ağzıyla"],
  ["A", 1, 0, "Karışık renkli, benekli"], ["A", 1, 6, "Tanınmış, şöhretli"], ["A", 1, 13, "Kategori, kavram öbeği"],
  ["A", 2, 0, "Katışıksız, arı"], ["A", 2, 4, "C harfinin okunuşu"], ["A", 2, 7, "Uluslararası Af Örgütü'nün İngilizce kısaltması"], ["A", 2, 10, "Damla"],
  ["A", 3, 0, "Avrupa Birliği'nin kısaltması"], ["A", 3, 11, "Suudi Arabistan'ın kısaltması"],
  ["A", 4, 0, "İri taneli, uzun bir üzüm türü"], ["A", 4, 11, "Volkanik bir kayaç"],
  ["A", 5, 0, "Osmanlı'da ürün vergisi, öşür"], ["A", 5, 13, "Talan sözcüğünün ilk üç harfi"],
  ["A", 6, 11, "Nijer'in başkenti"],
  ["A", 7, 2, "İnanmış, ikna olmuş"], ["A", 7, 11, "Fotoğraftaki efsanevi kuş"],
  ["A", 8, 0, "Antalya'da bir çay ve Selçuklu hanı"], ["A", 8, 6, "Pek kısa süre"], ["A", 8, 14, "Kurosawa'nın Kral Lear'den uyarladığı film"],
  ["A", 9, 0, "Balıkesir yöresinde kurulmuş bir beylik"], ["A", 9, 7, "Muğla'da, Gökova Körfezi kıyısında bir belde"],
  ["A", 10, 2, "Mitoloji, söylenceler"], ["A", 10, 9, "Yardakçılar, çevre (olumsuz anlamda)"],
  ["D", 0, 0, "Geminin baş ve kıç taraflarındaki yükseltilmiş güverte"], ["D", 0, 1, "Şalgama benzeyen, yumru köklü bir sebze"], ["D", 0, 2, "Eşya konan tahta"], ["D", 0, 3, "Alternatif akımın kısaltması"], ["D", 0, 4, "Demir levha"],
  ["D", 0, 8, "Ilık, halk ağzıyla"], ["D", 0, 9, "İki, Farsça"], ["D", 0, 14, "Birliktelik bildiren bağlaç"], ["D", 0, 15, "Tantalın simgesi"], ["D", 0, 16, "Dolaylı anlatma, kinaye"],
  ["D", 1, 7, "Sodyumun simgesi"], ["D", 1, 13, "Vücutta oluşan şiş"],
  ["D", 2, 11, "Kazakistan'ın başkenti"], ["D", 2, 12, "Azerbaycan'da çalınan telli bir çalgı"],
  ["D", 3, 3, "Kış yağışı"], ["D", 3, 15, "Ağ biçiminde örülmüş torba"],
  ["D", 4, 2, "Z harfinin okunuşu"], ["D", 4, 5, "Buhurizade Mustafa, ünlü besteci"], ["D", 4, 13, "Saldırı, hamle"], ["D", 4, 14, "Gemide yolcu odası"],
  ["D", 6, 12, "Bir erkek adı"], ["D", 6, 16, "Çamaşır yıkanan yer"],
  ["D", 7, 0, "Temiz, lekesiz"], ["D", 7, 2, "Dört kenarı eşit dörtgen"], ["D", 7, 3, "Doğu Anadolu'da bir nehir"], ["D", 7, 4, "ABD'nin uzay ajansı"],
  ["D", 8, 1, "Bir nota"], ["D", 8, 7, "Taneli, kırmızı bir meyve"], ["D", 8, 9, "İğneyle yapılan ince süsleme"],
  ["D", 9, 5, "Köpek"], ["D", 9, 10, "Avlanan hayvan"], ["D", 9, 11, "K harfinin okunuşu"],
];
const PHOENIX = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2F5E"/><stop offset=".55" stop-color="#C2477A"/><stop offset="1" stop-color="#F6A04D"/></linearGradient><linearGradient id="f" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FFD166"/><stop offset=".6" stop-color="#F77F2F"/><stop offset="1" stop-color="#D62839"/></linearGradient></defs><rect width="100" height="100" fill="url(#s)"/><circle cx="50" cy="78" r="24" fill="#FFD9A0" opacity=".55"/><path d="M50 72c-4-10-4-20 0-30 4 10 4 20 0 30z" fill="url(#f)"/><path d="M48 50C36 40 22 36 8 40c10 2 20 8 26 16-8-3-16-3-24 0 12 1 22 6 30 12z" fill="url(#f)"/><path d="M52 50c12-10 26-14 40-10-10 2-20 8-26 16 8-3 16-3 24 0-12 1-22 6-30 12z" fill="url(#f)"/><circle cx="50" cy="36" r="5" fill="url(#f)"/><path d="M53 35l6 2-6 1z" fill="#FFD166"/><path d="M44 74c2 8 4 12 6 16 2-4 4-8 6-16" fill="none" stroke="#FFD166" stroke-width="2" stroke-linecap="round"/></svg>`).toString("base64")}`;
export const CUM_BIG = {
  date: "", no: "", title: "Günün Kare Bulmacası", solution: BIG_ROWS,
  clues: (() => {
    const p = cumhuriyetPuzzle({ solution: BIG_ROWS }, "2026-01-01"), g = gridOf(p);
    const out = { across: {} as Record<number, string>, down: {} as Record<number, string> };
    for (const [d, r, c, clue] of BIG_CLUES) {
      const w = g.words.find((x) => x.dir === (d === "A" ? "across" : "down") && x.cells[0] === r * p.w + c);
      if (!w) throw new Error(`no word at ${d} ${r},${c}`);
      out[w.dir][w.n] = clue;
    }
    return out;
  })(),
  media: [{ type: "image", src: PHOENIX, row: 4, col: 7, rows: 5, cols: 5 }],
};

// A 3 by 3 of Sabah's, crossing Ç (AÇI, across) with C (CAN, down), and one across below.
export const SABAH_SMALL = {
  client: "sabah.com.tr", size: { x: 3, y: 3 }, puzzleTxt: ["ACI", "#A#", "#N#"],
  puzzleData: [
    { id: 1, x: 1, y: 1, answer: "açı", clue: "İki doğrunun kesiştiği yerdeki açıklık", direction: "across" },
    { id: 2, x: 2, y: 1, answer: "can", clue: "Ruh, hayat", direction: "down" },
  ],
};

const sabahSlider = (items: { date: string; n: number }[]) =>
  JSON.stringify({ Html: items.map(({ date, n }) => `<div class="swiper-slide"><a href="/bulmaca-coz/kare/${date.replaceAll("-", "/")}/${Number(date.slice(8))}-gunluk-kare-bulmaca-${n}"><h3>Günlük Kare Bulmaca - ${n}</h3></a></div>`).join("") });
const sabahArticle = (src: string) => `<html><body><div class="puzzle-wrapper"><iframe border="0" class="kare-bulmaca" src="${src}" width="100%"></iframe></div></body></html>`;
const sabahPlayer = (data: unknown) => `<html><head><script>_DEBUG = false;_PUZZLE_CODE = 'X';_PUZZLE_DATA = '${Buffer.from(JSON.stringify(data)).toString("base64")}';</script></head><body></body></html>`;

/**
 * The three sites on one server, around `today` (YYYY-MM-DD): HaberTürk has today's and the
 * day before (a day without one is its site's "not found" page), Cumhuriyet lists the two days
 * before today, Sabah has two puzzles on 2025-04-28 and one on 2025-04-27. `env` points the
 * extension at it; every request is counted in `hits`; `down` answers 503.
 */
export function fakePapers(today: string, big?: { cum?: unknown }) {
  const hits: string[] = [];
  let down = false;
  const day = (k: number) => new Date(Date.parse(`${today}T12:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url), path = url.pathname;
      hits.push(path);
      if (down) return new Response("unavailable", { status: 503 });
      const base: string = `http://127.0.0.1:${url.port}`;
      let m = /^\/ht\/bulmaca\/gunluk\/(\d{4})\/(\d\d)\/(\d\d)$/.exec(path);
      if (m) {
        const date = `${m[1]}-${m[2]}-${m[3]}`;
        return new Response([day(0), day(1)].includes(date) ? htPage(7000 + Number(m[3]), HT_8) : "<html><title>Sayfa Bulunamadı</title></html>", { headers: { "content-type": "text/html" } });
      }
      if (path === "/cum/api/list") return Response.json({ today: {}, count: 2, puzzles: [day(1), day(2)].map((date) => ({ date, urlDate: date, no: "", title: "Günün Kare Bulmacası" })) });
      m = /^\/cum\/api\/puzzle\/(\d{4}-\d\d-\d\d)$/.exec(path);
      if (m) return [day(1), day(2)].includes(m[1]) ? Response.json({ ...((big?.cum as object) ?? CUM_SMALL), date: m[1] }) : Response.json({ error: "Bulmaca bulunamadı." }, { status: 404 });
      if (path === "/sabah/bulmaca-coz/getsliderarticles" && req.method === "POST") {
        const month = String(new URLSearchParams(await req.text()).get("selectedDate")).slice(5, 7);
        return new Response(month === "04" ? sabahSlider([{ date: "2025-04-28", n: 2 }, { date: "2025-04-28", n: 1 }, { date: "2025-04-27", n: 1 }]) : JSON.stringify({ Html: "" }));
      }
      m = /^\/sabah\/bulmaca-coz\/kare\/(\d{4})\/(\d\d)\/(\d\d)\/([\w-]+)$/.exec(path);
      if (m) return new Response(sabahArticle(`${base}/sabah/player/kare-${m[3]}-${m[4].slice(-1)}.html`));
      if (/^\/sabah\/player\/kare-\d+-\d\.html$/.test(path)) return new Response(sabahPlayer(SABAH_SMALL));
      return new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  return {
    hits, stop: () => server.stop(true), set down(v: boolean) { down = v; },
    env: { PAL_CROSSWORD_HT_URL: `${base}/ht`, PAL_CROSSWORD_CUM_URL: `${base}/cum`, PAL_CROSSWORD_SABAH_URL: `${base}/sabah` },
  };
}
