// A Bun mock of Google's `translate_a/single` and DeepL's `/v2/translate`
// for the translate tests and the screenshot fixture: the canned Google
// replies are what the real endpoint answered on 2026-09-17 for the same
// texts (trimmed to the fields read), so the parser is exercised on the
// true shape; anything else gets a `[tl] text` stand-in. `refuse` gets
// Google's "Sorry..." page, `slow` waits 400 ms, and DeepL answers only
// the key `good:fx`.

export const HELLO_TR = { sentences: [{ trans: "Selam Dünya", orig: "hello world", backend: 10 }], src: "en", alternative_translations: [{ src_phrase: "hello world", alternative: [{ word_postproc: "Selam Dünya" }, { word_postproc: "merhaba dünya" }], srcunicodeoffsets: [{ begin: 0, end: 11 }] }], confidence: 0.76348495, spell: {}, ld_result: { srclangs: ["en"], srclangs_confidences: [0.76348495], extended_srclangs: ["en"] } };
export const MERHABA_EN = { sentences: [{ trans: "hello world. ", orig: "merhaba dünya. ", backend: 10 }, { trans: "How are you?", orig: "Nasılsın?", backend: 10 }], src: "tr", alternative_translations: [{ src_phrase: "merhaba dünya.", alternative: [{ word_postproc: "hello world." }, { word_postproc: "hi world." }] }, { src_phrase: "Nasılsın?", alternative: [{ word_postproc: "How are you?" }, { word_postproc: "how are you" }] }], confidence: 1, ld_result: { srclangs: ["tr"], srclangs_confidences: [1] } };
export const HELLO_JA = { sentences: [{ trans: "こんにちは", orig: "hello", backend: 10 }, { translit: "Kon'nichiwa", src_translit: "həˈlō" }], dict: [{ pos: "noun", terms: ["今日は"], entry: [{ word: "今日は", reverse_translation: ["hello", "good day"] }], base_form: "hello", pos_enum: 1 }], src: "en", alternative_translations: [{ src_phrase: "hello", alternative: [{ word_postproc: "こんにちは" }, { word_postproc: "こんにちは。" }] }], confidence: 1, ld_result: { srclangs: ["en"], srclangs_confidences: [1] } };
export const HELLO_EN = { sentences: [{ trans: "hello world", orig: "hello world", backend: 10 }], src: "en", confidence: 0.76, ld_result: { srclangs: ["en"], srclangs_confidences: [0.76] } };
export const SORRY = `<html><head><title>Sorry...</title></head><body><h1>We're sorry...</h1><p>... but your computer or network may be sending automated queries.</p></body></html>`;

export type Seen = { path: string; q: string; sl: string; tl: string; auth?: string; body?: unknown };

/** Starts the mock on a free port; `requests` records every call. */
export function startMock() {
  const requests: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/translate_a/single") {
        const form = new URLSearchParams(await req.text());
        const q = form.get("q") ?? "", sl = url.searchParams.get("sl") ?? "", tl = url.searchParams.get("tl") ?? "";
        requests.push({ path: url.pathname, q, sl, tl });
        if (q === "refuse") return new Response(SORRY, { headers: { "content-type": "text/html" } });
        if (q === "slow") await Bun.sleep(400);
        const reply = q === "hello world" && tl === "tr" ? HELLO_TR : q === "hello world" && tl === "en" ? HELLO_EN : q === "merhaba dünya. Nasılsın?" && tl === "en" ? MERHABA_EN : q === "hello" && tl === "ja" ? HELLO_JA
          : { sentences: [{ trans: `[${tl}] ${q}`, orig: q }], src: sl === "auto" ? (/[çğıöşü]/i.test(q) ? "tr" : "en") : sl, alternative_translations: [], confidence: 0.9 };
        return Response.json(reply);
      }
      if (url.pathname === "/v2/translate") {
        const body = (await req.json()) as { text?: string[]; source_lang?: string; target_lang: string };
        const auth = req.headers.get("authorization") ?? "";
        requests.push({ path: url.pathname, q: body.text?.[0] ?? "", sl: body.source_lang ?? "", tl: body.target_lang, auth, body });
        if (auth !== "DeepL-Auth-Key good:fx") return Response.json({ message: "Forbidden" }, { status: 403 });
        return Response.json({ translations: [{ detected_source_language: "TR", text: `DeepL ${body.text?.[0]} → ${body.target_lang}` }] });
      }
      return new Response("no", { status: 404 });
    },
  });
  return { server, requests, base: `http://127.0.0.1:${server.port}` };
}
