import { describe, expect, it } from "vitest";
import { embedOf, passOn, picked, themeOf } from "../embed";
import { isFromPal, isToPal } from "../../../web/src/protocol";

describe("a page framed by another site", () => {
  it("reads what the host element asked for off its address", () => {
    expect(embedOf("?token=t")).toBeNull();
    expect(embedOf("?embed=settings")).toBeNull();
    expect(embedOf("?embed=bar")).toEqual({ kind: "bar", palette: undefined });
    expect(embedOf("?embed=panel&palette=clipboard/history")).toEqual({ kind: "panel", palette: "clipboard/history" });
    expect(embedOf("?embed=panel&palette=history")?.palette, "a palette is ext/palette").toBeUndefined();
    expect(themeOf("?theme=dark")).toBe("dark");
    expect(themeOf("?theme=blue")).toBeNull();
  });

  it("hands a sheet the token and the look, nothing else", () => {
    expect(passOn("?embed=bar&token=a%20b&theme=light&palette=x/y&links=host")).toBe("&token=a+b&theme=light&links=host");
    expect(passOn("?embed=bar")).toBe("");
  });

  it("tells the host a pick by the row's words and the palette it came from", () => {
    expect(picked({ id: "1", name: "Copy", subtitle: "s", source: { extension: "clip", palette: "history" }, detail: { markdown: "secret" } }, "paste")).toEqual({ id: "1", name: "Copy", subtitle: "s", palette: "clip/history", action: "paste" });
  });

  it("knows its own messages from anything else on the window", () => {
    expect(isToPal({ pal: "embed", hello: true })).toBe(true);
    expect(isToPal({ pal: "embed", call: "focus" })).toBe(true);
    expect(isToPal({ pal: "sheet", hide: true })).toBe(false);
    expect(isFromPal({ pal: "embed", event: "pick", detail: {} })).toBe(true);
    expect(isFromPal({ pal: "embed", hello: true })).toBe(false);
    expect(isFromPal("hello")).toBe(false);
  });
});
