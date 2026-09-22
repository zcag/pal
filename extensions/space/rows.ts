// The list rows (`Item` in `@zcag/pal`), pure over a node or a suggestion:
// what Largest Files, Largest Folders and Cleanup Suggestions draw, shared
// with the gallery fixture. The glyphs are Material Design outlines in the
// bundled Nerd Font; the kind rides as a tag in its colour.
import { ago, bytes, tilde, type Action, type Item, type TagColor } from "@zcag/pal";
import { rootLabel, sizeOf, type Sizes } from "./render.ts";
import { KIND_LABEL, count, kindOf, pathOf, pct, type Kind, type Node } from "./scan.ts";
import { basename, dirname } from "node:path";

/** md-harddisk: the extension's glyph, and the hint rows'. */
export const ICON = "\u{f02ca}";
/** md-trash_can_outline. */
export const TRASH_GLYPH = "\u{f0a7a}";
export const GLYPH: Record<Kind, string> = { folder: "\u{f0256}", app: "\u{f0003}", image: "\u{f0976}", video: "\u{f0567}", audio: "\u{f075a}", document: "\u{f09ee}", code: "\u{f102b}", archive: "\u{f0ffa}", disk: "\u{f02ca}", package: "\u{f03d7}", file: "\u{f0224}", rest: "\u{f0224}" };
const TAG: Record<Kind, TagColor> = { folder: "blue", app: "violet", image: "pink", video: "violet", audio: "teal", document: "amber", code: "green", archive: "red", disk: "grey", package: "amber", file: "grey", rest: "grey" };

/** The actions of a file or folder row: the map on a folder, the file verbs, the trash (`multi` where several rows go together). */
export const rowActions = (dir: boolean, mac: boolean): Action[] => [
  ...(dir ? [{ id: "map", title: "Show in the map" }] : [{ id: "open", title: "Open", multi: true as const }]),
  { id: "reveal", title: mac ? "Reveal in Finder" : "Show in file manager", multi: true },
  ...(dir ? [{ id: "largest", title: "Largest files under it", shortcut: "cmd+l" }] : [{ id: "map", title: "Show in the map", shortcut: "cmd+m" }]),
  ...(mac && !dir ? [{ id: "look", title: "Quick Look", shortcut: "cmd+y" }] : []),
  { id: "copy", title: "Copy path", shortcut: "cmd+c", multi: true },
  { id: "info", title: "Info", shortcut: "cmd+shift+i" },
  { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move this to the Trash?", multi: true },
];

/** A file under `root`: its folder as the subtitle, the kind as a tag, the size; the pane has both sizes. */
export function fileRow(n: Node, root: string, sizes: Sizes, mac: boolean): Item {
  const k = kindOf(n);
  const path = pathOf(n);
  return {
    id: path, name: n.name, subtitle: tilde(dirname(path)), icon: GLYPH[k], keywords: [n.name],
    accessories: [{ tag: KIND_LABEL[k], color: TAG[k] }, { text: bytes(sizeOf(n, sizes)) }],
    actions: rowActions(false, mac),
    detail: { metadata: [{ label: "Path", value: tilde(path) }, { label: "On disk", value: bytes(n.alloc) }, { label: "Apparent", value: bytes(n.size) }, ...(n.mtime ? [{ label: "Modified", value: ago(n.mtime) }] : []), { label: "Root", value: rootLabel(root) }] },
  };
}

/** A folder under `under`: its count, its share of `under`, its size. */
export function folderRow(d: Node, under: Node, sizes: Sizes, mac: boolean): Item {
  const path = pathOf(d);
  return { id: path, name: d.name, subtitle: tilde(dirname(path)), icon: GLYPH[kindOf(d)], keywords: [d.name], accessories: [{ text: count(d.files) }, { text: pct(sizeOf(d, sizes), sizeOf(under, sizes)) }, { text: bytes(sizeOf(d, sizes)) }], actions: rowActions(true, mac) };
}

export type Suggestion = {
  id: string;
  name: string;
  path: string;
  /** Why it is safe, or what to know. */
  note: string;
  size?: number;
  files?: number;
  /** The walk is still on it. */
  measuring?: boolean;
  /** `trash`: the folder itself; `trash-contents`: everything in it; `trash-old`: the `targets`; `empty-trash`: Finder's Empty Trash. */
  action: "trash" | "trash-contents" | "empty-trash" | "trash-old";
  targets?: string[];
  section: string;
};

/** A suggestion as a row: the size (with an ellipsis while measuring), the count, and the one destructive action it offers, asked first. */
export function suggestionRow(g: Suggestion, staleDays: number, mac: boolean): Item {
  const size = bytes(g.size ?? 0);
  const destructive: Action = g.action === "empty-trash"
    ? { id: "empty-trash", title: "Empty Trash", shortcut: "cmd+d", style: "destructive", confirm: `Empty the Trash (${size})? This cannot be undone.` }
    : g.action === "trash" ? { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: `Move ${tilde(g.path)} (${size}) to the Trash?` }
    : g.action === "trash-old" ? { id: "trash-old", title: `Trash the ${count(g.files ?? 0)}`, shortcut: "cmd+d", style: "destructive", confirm: `Move ${count(g.files ?? 0)} (${size}) older than ${staleDays} days to the Trash?` }
    : { id: "trash-contents", title: "Trash the contents", shortcut: "cmd+d", style: "destructive", confirm: `Move everything in ${tilde(g.path)} (${size}) to the Trash?` };
  return {
    id: g.id, name: g.name, subtitle: g.measuring ? `Measuring… ${g.note}` : g.note, icon: g.action === "empty-trash" ? TRASH_GLYPH : GLYPH.folder, keywords: [basename(g.path)], section: g.section,
    accessories: [...(g.files !== undefined ? [{ text: count(g.files) }] : []), { text: g.measuring ? `${size}…` : size }],
    actions: [{ id: "map", title: "Show in the map" }, { id: "reveal", title: mac ? "Reveal in Finder" : "Show in file manager" }, destructive, { id: "copy", title: "Copy path", shortcut: "cmd+c" }],
  };
}
