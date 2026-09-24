// Game surfaces (docs/design/game-surface.md): a page's TypeScript served
// as JavaScript. The app's `ext://` scheme (app/src-tauri/src/surface.rs)
// asks `surface/transpile` for every `*.ts` a page loads; the answer is
// Bun's transpiler on the one file (no bundling: its imports stay as
// written, `../game.ts` is another request), cached until the file's
// mtime moves. Type-only imports are dropped, so `import { apply, State }`
// with `State` a type still loads in a browser.
//
// Run as a script it is the same serving for a plain browser, where the
// kit's stub stands in for pal (`window.parent === window`):
//
//   bun host/src/surface.ts extensions/solitaire [port]
//
// then open http://<host>:<port>/surface/index.html.
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const transpiler = new Bun.Transpiler({ loader: "ts", trimUnusedImports: true });
const cache = new Map<string, { mtime: number; code: string }>();

/** `path` (absolute, a `.ts` file the scheme already vetted) as JavaScript. */
export async function transpile(path: string): Promise<string> {
  if (extname(path) !== ".ts") throw new Error(`surface/transpile: ${path} is not a .ts file`);
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path);
  if (hit?.mtime === mtimeMs) return hit.code;
  const code = transpiler.transformSync(await Bun.file(path).text());
  cache.set(path, { mtime: mtimeMs, code });
  return code;
}

/** What the scheme sends with every response (surface.rs `CSP`, kept the same): its own files and the kit, no network, no eval, no inline script. */
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? ".");
  const repo = resolve(import.meta.dir, "../..");
  const kit = join(repo, "app/src-tauri/surface-kit");
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: Number(process.argv[3] ?? 0),
    async fetch(req) {
      const path = normalize(decodeURIComponent(new URL(req.url).pathname));
      const file = path === "/__pal/tokens.css" ? join(repo, "app/src/ui/tokens.css") : path.startsWith("/__pal/") ? join(kit, path.slice(7)) : join(dir, path);
      if (path.split("/").some((s) => s.startsWith(".")) || !(await Bun.file(file).exists())) return new Response("not found", { status: 404 });
      const headers = { "Content-Security-Policy": CSP, "Cache-Control": "no-cache" };
      if (extname(file) === ".ts") return new Response(await transpile(file), { headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" } });
      return new Response(Bun.file(file), { headers });
    },
  });
  console.log(`serving ${dir} at http://${hostname()}:${server.port}/`);
}
