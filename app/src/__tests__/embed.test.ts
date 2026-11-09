import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const w = ((globalThis as { window?: unknown }).window ??= globalThis) as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = { convertFileSrc: (path: string, scheme: string) => `https://pal.lan/__${scheme}/${encodeURIComponent(path)}` };
});
import { embedOf, passOn, picked, themeOf } from "../embed";
import { isFromPal, isToPal } from "../../../web/src/protocol";
import { pictureUrl, servedSrc } from "../ui/icons";
import { sheetLine, sheetSrc } from "../sheet";

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

describe("a remote page", () => {
  it("loads an icon:// url an extension spelled out, and a bar picture on disk, from the server's route, and opens a glance line in its item's sheet", () => {
    expect(servedSrc("icon://localhost/file?path=%2Fa.png&size=0")).toBe("https://pal.lan/__icon/file?path=%2Fa.png&size=0");
    expect(servedSrc("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(pictureUrl("~/icons/w.svg", 36)).toBe("https://pal.lan/__icon/file?path=~%2Ficons%2Fw.svg&size=36");
    expect(sheetSrc("gmail/unread", 2)).toBe("?bar&key=gmail%2Funread&line=2");
    expect(sheetLine("?bar&key=a&line=2")).toBe(2);
    expect(sheetLine("?bar&key=a")).toBeNull();
  });
});
