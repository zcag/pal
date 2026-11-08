import type { FromPal } from "../../web/src/protocol";

/**
 * A bar item's popover on a remote page is a sheet: a frame of `?bar&key=`
 * (its own connection, page `bar`) over the panel. The frame and the page
 * around it talk in these messages: the frame's height as its content asks,
 * its hide, and the HUD and Large Type lines its picks raise, which belong
 * to the page around it.
 */
export type SheetMessage =
  | { pal: "sheet"; size: number }
  | { pal: "sheet"; hide: true }
  | { pal: "sheet"; event: "pal://hud" | "pal://large"; payload: unknown }
  /** What an embed tells its host (embed.ts), from a sheet inside it. */
  | { pal: "sheet"; embed: FromPal };

/** The bar item this page is the sheet of (`?bar&key=`), when it is one. */
export const sheetKey = (search: string): string | null => new URLSearchParams(search).get("key");

/** The glance card line a sheet runs instead of opening its item (`&line=`). */
export const sheetLine = (search: string): number | null => { const n = Number(new URLSearchParams(search).get("line") ?? NaN); return Number.isInteger(n) && n >= 0 ? n : null; };

/** The frame's address for a bar item's sheet, or for one line of its glance card. */
export const sheetSrc = (key: string, line?: number) => `?bar&key=${encodeURIComponent(key)}${line === undefined ? "" : `&line=${line}`}`;

export const toParent = (msg: SheetMessage) => { if (window.parent !== window) window.parent.postMessage(msg, location.origin); };

export const isSheetMessage = (data: unknown): data is SheetMessage => !!data && typeof data === "object" && (data as { pal?: unknown }).pal === "sheet";
