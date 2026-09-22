// The helpers the bundled extensions share through `@zcag/pal`: text.ts,
// clock.ts's ago, rows.ts, api.ts's tilde, png.ts, exec.ts, token.ts,
// image.ts. The
// expectations are the ones the extensions' own copies carried before the
// helpers moved here (polish round 3), so a move is proven equivalent.
import { afterAll, describe, expect, test } from "bun:test";
import { tilde } from "../../sdk/src/api.ts";
import { ago, parseDuration } from "../../sdk/src/clock.ts";
import { EXEC_MS, exec, run } from "../../sdk/src/exec.ts";
import { IMAGE_MISS_TTL, forgetImages, imageData } from "../../sdk/src/image.ts";
import { pngSize } from "../../sdk/src/png.ts";
import { HINT_GLYPH, column, failed, hint, keyHint, keycap, row, text, toast } from "../../sdk/src/rows.ts";
import { bytes, errorMessage, mdEscape, oneLine, slug, truncate } from "../../sdk/src/text.ts";
import { BARE_TOKEN_TTL, EXPIRY_MARGIN, TokenError, mintToken, parseToken } from "../../sdk/src/token.ts";

describe("text", () => {
  test("bytes: B, KB with a decimal under 10, MB, GB, TB", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(2.5 * 1024)).toBe("2.5 KB");
    expect(bytes(75 * 1024)).toBe("75 KB");
    expect(bytes(234 * 1024)).toBe("234 KB");
    expect(bytes(1.2 * 1024 ** 2)).toBe("1.2 MB");
    expect(bytes(25.3 * 1024 ** 2)).toBe("25.3 MB");
    expect(bytes(3 * 1024 ** 3)).toBe("3.00 GB");
    expect(bytes(1.5 * 1024 ** 4)).toBe("1.50 TB");
  });
  test("truncate and oneLine", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcd", 4)).toBe("abcd");
    expect(oneLine("  a \n\n b\tc ")).toBe("a b c");
    expect(oneLine("1 item was shared\u034F\u200C \u034F\u200C \u200B\uFEFF\u00ADto you")).toBe("1 item was shared to you");
  });
  test("slug", () => {
    expect(slug("Héllo, Wörld! 2026")).toBe("hello-world-2026");
    expect(slug("  --Already-slug-- ")).toBe("already-slug");
  });
  test("errorMessage", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ message: "shaped" })).toBe("shaped");
    expect(errorMessage(7)).toBe("7");
  });
  test("mdEscape: markup escaped, links whole", () => {
    expect(mdEscape("see <a@b> and #1 *now*")).toBe("see \\<a@b\\> and \\#1 \\*now\\*");
    expect(mdEscape("go https://x.example/a_b?c=1 now")).toBe("go https://x.example/a_b?c=1 now");
    expect(mdEscape("- item\n1. one\n+ plus")).toBe("\\- item\n1\\. one\n\\+ plus");
  });
});

describe("clock", () => {
  test("parseDuration: units chain, a bare number is minutes, junk is nothing", () => {
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("25m")).toBe(1500);
    expect(parseDuration("1h30m")).toBe(5400);
    expect(parseDuration("1 h")).toBe(3600);
    expect(parseDuration("25")).toBe(1500);
    expect(parseDuration("1d")).toBe(86400);
    expect(parseDuration("soon")).toBeUndefined();
    expect(parseDuration("2:30")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
  });
  test("ago: just now, then s / min / h / d / w / mo / y, a future moment as in; short is the column form", () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    const back = (ms: number, short = false) => ago(now - ms, { now, short });
    expect([back(2_000), back(23_000), back(4 * 60_000), back(2 * 3_600_000), back(26 * 3_600_000), back(3 * 86_400_000), back(10 * 86_400_000), back(90 * 86_400_000), back(400 * 86_400_000)]).toEqual(["just now", "23 s ago", "4 min ago", "2 h ago", "1 d ago", "3 d ago", "1 w ago", "3 mo ago", "1 y ago"]);
    expect([back(20_000, true), back(5 * 60_000, true), back(3 * 3_600_000, true), back(2 * 86_400_000, true), back(10 * 86_400_000, true), back(90 * 86_400_000, true)]).toEqual(["now", "5m", "3h", "2d", "1w", "3mo"]);
    expect([ago(now + 7_200_000, { now }), ago(now + 90_000, { now }), ago(now + 7_200_000, { now, short: true })]).toEqual(["in 2 h", "in 2 min", "in 2h"]);
    expect([back(59.6 * 60_000), back(23.6 * 3_600_000)]).toEqual(["1 h ago", "1 d ago"]);
    expect(ago(new Date(now - 5 * 60_000).toISOString(), { now })).toBe("5 min ago");
  });
});

describe("tilde", () => {
  test("the home folder and paths under it, nothing else", () => {
    const h = process.env.HOME!;
    expect(tilde(h)).toBe("~");
    expect(tilde(`${h}/Documents/a`)).toBe("~/Documents/a");
    expect(tilde(`${h}x/y`)).toBe(`${h}x/y`);
    expect(tilde("/tmp")).toBe("/tmp");
  });
});

describe("rows", () => {
  test("hint: the id prefixed once, the information glyph, no actions", () => {
    expect(hint("empty", "Nothing here", "Type to search")).toEqual({ id: "hint:empty", name: "Nothing here", subtitle: "Type to search", icon: HINT_GLYPH, actions: [] });
    expect(hint("hint:x", "X").id).toBe("hint:x");
    const a = [{ id: "settings", title: "Open Settings" }];
    expect(hint("token", "No token", undefined, { icon: "!", actions: a, section: "Setup" })).toEqual({ id: "hint:token", name: "No token", subtitle: undefined, icon: "!", section: "Setup", actions: a });
  });
  test("toast and failed keep the panel open", () => {
    expect(toast("Renamed", "a.txt")).toEqual({ keep: true, toast: { title: "Renamed", message: "a.txt" } });
    expect(toast("Done")).toEqual({ keep: true, toast: { title: "Done" } });
    expect(failed("close the tab", new Error("gone"))).toEqual({ keep: true, toast: { title: "Could not close the tab", message: "gone", style: "failure" } });
    expect(failed("x", "text").toast!.message).toBe("text");
  });
  test("the view builders", () => {
    expect(text("a", { size: "xs" })).toEqual({ type: "text", value: "a", size: "xs" });
    expect(row([text("a")], { gap: 1 })).toEqual({ type: "stack", direction: "row", align: "center", gap: 1, children: [text("a")] });
    expect(column([])).toEqual({ type: "stack", direction: "column", gap: 2, children: [] });
    expect(keycap("enter")).toEqual({ type: "keycap", keys: "enter" });
    expect(keycap("enter", "go")).toEqual({ type: "keycap", keys: "enter", action: "go" });
    expect(keyHint(["up", "down"], "Move")).toEqual([keycap("up"), keycap("down"), text("Move", { style: "muted", size: "xs" })]);
    expect(keyHint("enter", "Open", { action: "open", size: "sm" })).toEqual([keycap("enter", "open"), text("Open", { style: "muted", size: "sm" })]);
  });
});

describe("pngSize", () => {
  /** A PNG's first 24 bytes with the given IHDR size, plus some padding so the file has a size. */
  const png = (w: number, h: number): Buffer => {
    const b = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  test("reads the IHDR and refuses anything else", () => {
    expect(pngSize(png(1440, 900))).toEqual({ width: 1440, height: 900 });
    expect(pngSize(png(640, 480).subarray(0, 29))).toEqual({ width: 640, height: 480 });
    expect(pngSize(new Uint8Array(png(0, 10)))).toBeUndefined();
    expect(pngSize(Buffer.from("not a png at all, just some bytes"))).toBeUndefined();
    expect(pngSize(png(1, 1).subarray(0, 10))).toBeUndefined();
    expect(pngSize(new Uint8Array(30))).toBeUndefined();
  });
});

describe("exec", () => {
  test("the code and both streams; stdin when given", async () => {
    expect(await exec(["sh", "-c", "echo out; echo err >&2; exit 3"])).toEqual({ code: 3, out: "out\n", err: "err\n", timedOut: false });
    expect((await exec(["cat"], { stdin: "fed" })).out).toBe("fed");
    expect((await exec(["pwd"], { cwd: "/" })).out).toBe("/\n");
  });
  test("killed after ms", async () => {
    const r = await exec(["sleep", "5"], { ms: 50 });
    expect(r.timedOut).toBe(true);
    expect(r.code).not.toBe(0);
  });
  test("run: stdout, or stderr as the error, the code when stderr is empty, the seconds on a timeout", async () => {
    expect(await run(["echo", "hi"])).toBe("hi\n");
    await expect(run(["sh", "-c", "echo bad >&2; exit 1"])).rejects.toThrow("bad");
    await expect(run(["sh", "-c", "exit 4"])).rejects.toThrow("sh exited 4");
    await expect(run(["sleep", "5"], { ms: 50 })).rejects.toThrow("sleep did not finish in 0 s");
    expect(EXEC_MS).toBe(10_000);
  });
});

describe("token", () => {
  const MIN = 60_000;
  const now = 1_700_000_000_000;
  test("parseToken: a bare line, JSON with expires_in, expiry or expires_at, nothing", () => {
    expect(parseToken("ya29.abc\n", now)).toEqual({ token: "ya29.abc", until: now + BARE_TOKEN_TTL - EXPIRY_MARGIN });
    expect(parseToken('{"access_token":"t","expires_in":3385}', now)).toEqual({ token: "t", until: now + 3385_000 - MIN });
    expect(parseToken('{"token":"t","expires_in":"60"}', now)).toEqual({ token: "t", until: now + 60_000 - MIN });
    expect(parseToken(`{"access_token":"t","expiry":"${new Date(now + 5 * MIN).toISOString()}"}`, now)).toEqual({ token: "t", until: now + 4 * MIN });
    expect(parseToken(`{"access_token":"t","expires_at":${(now + 5 * MIN) / 1000}}`, now)).toEqual({ token: "t", until: now + 4 * MIN });
    expect(parseToken('{"access_token":"t"}', now)).toEqual({ token: "t", until: now + 29 * MIN });
    expect(parseToken("", now)).toBeUndefined();
    expect(parseToken("{not json", now)).toBeUndefined();
    expect(parseToken('{"error":"x"}', now)).toBeUndefined();
  });
  test("mintToken: the command's stdout, or a TokenError naming the exit or the missing token with stderr's last line", async () => {
    expect((await mintToken("echo tok", now)).token).toBe("tok");
    const e = await mintToken("echo one >&2; echo two >&2; exit 7", now).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(TokenError);
    const te = e as TokenError;
    expect(te.message).toBe("Token command exited 7: two");
    expect(te.stderr).toBe("one\ntwo");
    expect(te.code).toBe(7);
    await expect(mintToken("true", now)).rejects.toThrow("Token command printed no token");
    await expect(mintToken("echo why >&2", now)).rejects.toThrow("Token command printed no token: why");
  });
});

describe("imageData", () => {
  const server = Bun.serve({ port: 0, fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/pic") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    if (p === "/big") return new Response(new Uint8Array(100 * 1024), { headers: { "content-type": "image/png" } });
    if (p === "/text") return new Response("hi", { headers: { "content-type": "text/plain" } });
    return new Response("no", { status: 404 });
  } });
  afterAll(() => server.stop(true));
  const at = (p: string) => `http://127.0.0.1:${server.port}${p}`;
  test("an image as a data url, once; a miss, an oversize or a non-image as undefined", async () => {
    forgetImages();
    expect(await imageData(at("/pic"))).toBe("data:image/png;base64,AQID");
    expect(await imageData(at("/pic"))).toBe("data:image/png;base64,AQID");
    expect(await imageData(at("/big"))).toBeUndefined();
    expect(await imageData(at("/text"))).toBeUndefined();
    expect(await imageData(at("/gone"))).toBeUndefined();
    expect(IMAGE_MISS_TTL).toBe(15 * 60_000);
  });
});
