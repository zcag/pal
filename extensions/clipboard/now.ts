// The `rows` palette ("Clipboard"): what is on the clipboard right now as
// the things it could be (rows.ts), for the root's Clipboard section
// (`suggest`) and as a palette of its own. The rows are built from the
// history entry for the current clipboard (`clipboard.current`: what
// history never recorded, a concealed copy or one from an excluded app,
// is not here either), so nothing leaves the machine except the page
// title fetch, and that only with `fetch_titles`. A pick reads the
// clipboard again and acts on what is there; "Hide" remembers the entry
// (id and copy time) in storage, and the section stays away until the
// clipboard changes.
import { stat } from "node:fs/promises";
import { clipboard, clock, colors, dayNameYear, failed, home, ocr, settings, storage, toast, type ClipboardEntry, type Effect, type Item, type ListPalette } from "@zcag/pal";
import { analyzeText, desktopName, fetchTitle, privateArgv, qrSvg, QR_SHOW_PX, rows, transform, type Analysis, type PathInfo } from "./rows.ts";
const { toHex, toHslString, toRgb } = colors;

const EXTENSION = "clipboard", PALETTE = "rows";
/** `[palettes.clipboard-rows].settings`, defaults in pal.json. */
type RowSettings = { fetch_titles: boolean; shortener: string; private_browser: string };
const conf = () => settings.palette<RowSettings>(PALETTE, EXTENSION);
/** Storage: the entry the user hid, as `id:at`; the section is back once another copy lands. */
const HIDDEN = "rows:hidden";
const HOME = home("~");
const MAC = process.platform === "darwin";
/** Lines a text may have and still be looked at as a list of paths. */
const PATH_LINES = 200;

/** Whether the core can OCR, asked once. */
const canOcr: Promise<boolean> = ocr.available().catch(() => false);
/** Page titles by url, for this host's life; a miss is remembered too (one fetch per url, whatever it answered). */
const titles = new Map<string, Promise<string | undefined>>();
const titleOf = (url: string) => { let p = titles.get(url); if (!p) { p = fetchTitle(url); titles.set(url, p); } return p; };

const mark = (e: ClipboardEntry) => `${e.id}:${e.at}`;

/** The lines that are paths that exist (`~` expanded), with what they are. */
async function statPaths(lines: string[]): Promise<PathInfo[]> {
  const out: PathInfo[] = [];
  for (const raw of lines.slice(0, PATH_LINES)) {
    const line = raw.trim();
    if (!/^(~|\/)/.test(line)) continue;
    const p = home(line);
    const st = await stat(p).catch(() => undefined);
    if (st) out.push({ path: p, dir: st.isDirectory(), bytes: st.isDirectory() ? 0 : st.size });
  }
  return out;
}

/** The current clipboard, read as everything it could be; nothing when history has no entry for it. */
async function analyzeCurrent(): Promise<Analysis | undefined> {
  const e = await clipboard.current();
  if (!e) return undefined;
  if (e.kind === "image") return { entry: e, paths: [], image: { width: e.width ?? undefined, height: e.height ?? undefined, bytes: e.bytes, ocr: await canOcr } };
  const text = e.kind === "files" ? (e.files ?? []).join("\n") : e.text ?? "";
  const paths = await statPaths(text.split("\n").filter((l) => l.trim()));
  const a = analyzeText(e, text, paths);
  if (a.url && conf().fetch_titles !== false) a.title = await titleOf(a.url);
  return a;
}

async function currentRows(a: Analysis): Promise<Item[]> {
  const s = conf();
  return rows(a, { shortener: s.shortener?.trim() || undefined, ocr: !!a.image?.ocr }, HOME);
}

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
const installed = (app: string) => (MAC ? Bun.file(`/Applications/${app}.app/Contents/Info.plist`).size > 0 : !!Bun.which(app.toLowerCase().replace(/ browser$/, "").replace(/ /g, "-")));
const changed: Effect = { keep: true, toast: { title: "The clipboard changed", message: "The rows are for what is on it now", style: "failure" } };

/** A pick on one of the rows: what is on the clipboard now is what it acts on. */
export async function pickRow(id: string, action?: string): Promise<Effect> {
  const a = await analyzeCurrent();
  if (!a) return changed;
  const e = a.entry;
  if (action === "hide") {
    await storage.set(HIDDEN, mark(e), EXTENSION);
    return { keep: true, toast: { title: "Hidden", message: "The Clipboard section is back with the next copy" } };
  }
  const text = a.text ?? "";
  const copy = (t: string): Effect => ({ copy: t });
  const kind = id.split(":")[0];
  switch (kind) {
    case "image": {
      if (!e.image) return changed;
      if (action === "copy-file") return { copy_files: [e.image] };
      if (action === "paste") return { paste: { entry: e.id } };
      const target = desktopName(HOME, "png");
      try { await Bun.write(target, Bun.file(e.image)); } catch (err) { return failed("save the image", err); }
      return { hud: `Saved to Desktop as ${target.slice(target.lastIndexOf("/") + 1)}` };
    }
    case "ocr": {
      if (!e.image) return changed;
      let t: string;
      try { t = await ocr.image({ path: e.image }); } catch (err) { return failed("read the text", err); }
      if (!t.trim()) return { keep: true, toast: { title: "No text in the image" } };
      return action === "ocr-paste" ? { paste: { text: t } } : { copy: t, hud: `Copied ${t.trim().split(/\s+/).length} words` };
    }
    case "url": {
      if (!a.url) return changed;
      switch (action) {
        case "copy": return copy(a.url);
        case "markdown": return copy(`[${a.title ?? a.url.replace(/^https?:\/\//, "")}](${a.url})`);
        case "private": {
          const argv = privateArgv(installed, a.url, conf().private_browser);
          if (!argv) return toast("No browser with a private window is installed", "Chrome, Brave, Edge, Chromium, Vivaldi or Firefox; Settings › Extensions › Clipboard names one to prefer", "failure");
          spawnDetached(argv);
          return { hide: true };
        }
        case "shorten": {
          const template = conf().shortener?.trim();
          if (!template) return toast("URL shortener is not set", "Settings › Extensions › Clipboard: a URL with {url} in it", "failure");
          try {
            const r = await fetch(template.replace("{url}", encodeURIComponent(a.url)), { signal: AbortSignal.timeout(5000) });
            const short = (await r.text()).trim().split("\n")[0];
            if (!r.ok || !/^https?:\/\/\S+$/.test(short)) throw new Error(short.slice(0, 120) || `HTTP ${r.status}`);
            return { copy: short, hud: `Copied ${short}` };
          } catch (err) { return failed("shorten the address", err); }
        }
        default: return { open: a.url };
      }
    }
    case "qr": {
      if (!a.url) return changed;
      if (action === "save-qr") {
        const svg = qrSvg(a.url, 8);
        if (!svg) return failed("make the QR code", "too long for a QR code");
        const target = desktopName(HOME, "svg");
        try { await Bun.write(target, decodeURIComponent(svg.slice("data:image/svg+xml;utf8,".length))); } catch (err) { return failed("save the QR code", err); }
        return { hud: `Saved to Desktop as ${target.slice(target.lastIndexOf("/") + 1)}` };
      }
      return { show: { title: "QR code", markdown: `![](${qrSvg(a.url, 10, QR_SHOW_PX)})\n\n\`${a.url}\`` } };
    }
    case "color": {
      if (!a.color) return changed;
      const c = a.color.rgb;
      switch (action) {
        case "hex": return copy(toHex(c));
        case "rgb": return copy(toRgb(c));
        case "hsl": return copy(toHslString(c));
        default: return { push: { extension: "colors", palette: "picker", args: { color: toHex(c), from: "typed" } } };
      }
    }
    case "path": {
      const p = a.paths[Number(id.split(":")[1])];
      if (!p) return changed;
      switch (action) {
        case "reveal": spawnDetached(MAC ? ["open", "-R", p.path] : ["xdg-open", p.path.replace(/\/[^/]*$/, "") || "/"]); return { hide: true };
        case "open-with": return { push: { extension: "files", palette: "files", args: { open_with: p.path } } };
        case "copy-name": return copy(p.path.split("/").pop() || p.path);
        case "copy": return copy(p.path);
        default: return { open: p.path };
      }
    }
    case "files": {
      if (!a.paths.length) return changed;
      switch (action) {
        case "copy-paths": return copy(a.paths.map((p) => p.path).join("\n"));
        case "copy-names": return copy(a.paths.map((p) => p.path.split("/").pop() || p.path).join("\n"));
        default: spawnDetached(MAC ? ["open", "-R", ...a.paths.map((p) => p.path)] : ["xdg-open", a.paths[0].path.replace(/\/[^/]*$/, "") || "/"]); return { hide: true };
      }
    }
    case "email": return !a.email ? changed : action === "copy" ? copy(a.email) : { open: `mailto:${a.email}` };
    case "phone": {
      if (!a.phone) return changed;
      if (action === "copy-digits") return copy(a.phone.digits);
      if (action === "facetime") return { open: `facetime://${a.phone.digits}` };
      return { open: `tel:${a.phone.digits}` };
    }
    case "json": return !a.json ? changed : action === "minify" ? { copy: a.json.minified, hud: "Copied minified JSON" } : { copy: a.json.pretty, hud: "Copied pretty JSON" };
    case "calc": {
      if (!a.expr) return changed;
      const answer = String(Number(a.expr.value.toPrecision(12)));
      if (action === "paste-answer") return { paste: { text: answer } };
      if (action === "copy-both") return copy(`${a.expr.expr} = ${answer}`);
      return copy(answer);
    }
    case "number": {
      if (!a.number) return changed;
      const v = a.number.value;
      if (action === "copy-hex") return copy(`0x${v.toString(16)}`);
      if (action === "copy-bin") return copy(`0b${v.toString(2)}`);
      return copy(String(v));
    }
    case "date": {
      if (!a.date) return changed;
      if (action === "copy-iso") return copy(a.date.at.toISOString());
      if (action === "copy-unix") return copy(String(Math.floor(a.date.at.getTime() / 1000)));
      return copy(`${dayNameYear(a.date.at)} ${clock(a.date.at)}`);
    }
    case "decoded": return !a.decoded ? changed : action === "paste-decoded" ? { paste: { text: a.decoded.text } } : copy(a.decoded.text);
    case "track": return a.tracking ? { open: a.tracking.url } : changed;
    case "git": {
      if (!a.git) return changed;
      if (action === "copy-short") return copy(a.git.short ?? text.trim());
      if (action === "copy-url" ) return copy(a.git.url ?? "");
      if (action === "copy") return copy(text.trim());
      return a.git.url ? { open: a.git.url } : copy(text.trim());
    }
    case "text": {
      if (action === "snippet") return { push: { extension: "snippets", palette: "snippets", args: { create: text } } };
      const t = action ? transform(action, text) : undefined;
      if (t !== undefined) return { copy: t, hud: `Copied ${action === "title" ? "Title Case" : action === "upper" ? "UPPERCASE" : action === "slug" ? "the slug" : action === "trim" ? "trimmed" : "lowercase"}` };
      return { paste: { text } };
    }
    default: return { keep: true };
  }
}

/** The palette: the rows for what is on the clipboard, narrowed by the query inside it; the root's Clipboard section through `suggest`. */
export const rowsPalette: ListPalette = {
  title: "Clipboard",
  input: true,
  placeholder: "What is on the clipboard",
  suggest: async () => {
    const a = await analyzeCurrent();
    if (!a) return [];
    if ((await storage.get<string>(HIDDEN, EXTENSION)) === mark(a.entry)) return [];
    return currentRows(a);
  },
  list: async (query = "") => {
    const a = await analyzeCurrent();
    if (!a) return [{ id: "empty", name: "Nothing on the clipboard", subtitle: "Or history did not record it: a concealed copy, or one from an excluded app", icon: "\u{f09a8}", actions: [] }];
    const q = query.trim().toLowerCase();
    const all = await currentRows(a);
    return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.subtitle?.toLowerCase().includes(q)) : all;
  },
  pick: async (id, action) => (id === "empty" ? { keep: true } : pickRow(id, action)),
};
