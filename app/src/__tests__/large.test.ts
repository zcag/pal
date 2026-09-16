import { describe, expect, it } from "vitest";
import { MAX_SIZE, MIN_SIZE, display, fit, groupDigits, isCode } from "../large";

const W = 1440, H = 450;

describe("large type: fit", () => {
  it("a short code fills the window up to the ceiling, a sentence is smaller, a paragraph smaller still", () => {
    const code = fit("483 920", W, H);
    const sentence = fit("The quick brown fox jumps over the lazy dog", W, H);
    const para = fit("word ".repeat(60).trim(), W, H);
    expect(code).toBe(MAX_SIZE);
    expect(sentence).toBeLessThan(code);
    expect(para).toBeLessThan(sentence);
    expect(para).toBeGreaterThanOrEqual(MIN_SIZE);
  });
  it("never leaves the bounds", () => {
    expect(fit("x".repeat(400), 800, 200)).toBe(MIN_SIZE);
    expect(fit("7", 4000, 4000)).toBe(MAX_SIZE);
    expect(fit("", W, H)).toBe(MAX_SIZE);
  });
  it("grows with the window and shrinks with more lines", () => {
    expect(fit("192.168.1.10", 2000, H)).toBeGreaterThan(fit("192.168.1.10", 1000, H));
    expect(fit("one\ntwo\nthree", W, H)).toBeLessThan(fit("one", W, H));
    expect(fit("one\ntwo\nthree\nfour\nfive\nsix", W, H)).toBeLessThan(fit("one\ntwo\nthree", W, H));
  });
  it("a long single line wraps instead of dropping under the floor: its size comes from the area", () => {
    const text = "a".repeat(120);
    // One row would be W*0.86/(120*0.56) = 18 px, under the floor; wrapped it is larger.
    expect(fit(text, W, H)).toBeGreaterThan(MIN_SIZE);
    expect(fit(text, W, H)).toBeLessThan(fit("a".repeat(30), W, H));
    expect(fit("a".repeat(30), W, H)).toBeLessThan(fit("a".repeat(10), W, H));
  });
  it("mono glyphs are wider, so a mono line is set smaller", () => {
    expect(fit("abcdefghijklmnopqrstuvwxyz", W, H, true)).toBeLessThan(fit("abcdefghijklmnopqrstuvwxyz", W, H, false));
  });
});

describe("large type: codes and digit groups", () => {
  it("a token with a digit or a symbol is a code; words are not", () => {
    for (const t of ["483920", "192.168.1.10", "#ff6b35", "a1b2c3", "sk-live_9f8e", "user@example.com", "https://x.y/z", "3f2a9c"]) expect(isCode(t), t).toBe(true);
    for (const t of ["Hello", "hello world", "The quick brown fox", "483 920", ""]) expect(isCode(t), t).toBe(false);
  });
  it("six digits as two threes, nine as three, otherwise fours from the left", () => {
    expect(groupDigits("483920")).toBe("483 920");
    expect(groupDigits("123456789")).toBe("123 456 789");
    expect(groupDigits("12345678")).toBe("1234 5678");
    expect(groupDigits("1234567")).toBe("1234 567");
    expect(groupDigits("12345")).toBe("1234 5");
    expect(groupDigits("1234567890123456")).toBe("1234 5678 9012 3456");
    expect(groupDigits(" 483920 ")).toBe("483 920");
  });
  it("leaves anything that is not a run of 5 to 16 digits alone", () => {
    for (const t of ["1234", "12345678901234567", "483 920", "4839a20", "192.168.1.10", "hello"]) expect(groupDigits(t), t).toBe(t);
    expect(display("483920")).toBe("483 920");
    expect(display("The code is 483920")).toBe("The code is 483920");
  });
});
