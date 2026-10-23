// Surfaces (docs/design/game-surface.md): a page's TypeScript served
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
//   bun host/src/surface.ts ../pal-games/solitaire [port]
//
// then open http://<host>:<port>/surface/index.html. A name in its
// `requires` is served at /__ext/<name>/ from the folder beside it, else
// from the extension repos (app/scripts/extension-repos.mjs).
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";

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

/** What the scheme sends with every response (surface.rs `CSP`, kept the same): its own files and the kit, no network, no eval but WebAssembly's, no inline script. */
export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? ".");
  const repo = resolve(import.meta.dir, "../..");
  const kit = join(repo, "app/src-tauri/surface-kit");
  const requires: string[] = (await Bun.file(join(dir, "pal.json")).json().catch(() => ({}))).requires ?? [];
  const { extensionDirs } = await import("../../app/scripts/extension-repos.mjs");
  const repos: Map<string, { dir: string }> = extensionDirs();
  const required = async (name: string) => (requires.includes(name) ? ((await Bun.file(join(dirname(dir), name, "pal.json")).exists()) ? join(dirname(dir), name) : repos.get(name)?.dir) : undefined);
  const route = async (path: string) => {
    if (path === "/__pal/tokens.css") return join(repo, "app/src/ui/tokens.css");
    if (path.startsWith("/__pal/fonts/")) return join(repo, "app/src/assets/fonts", path.slice(13));
    if (path.startsWith("/__pal/")) return join(kit, path.slice(7));
    const ext = path.match(/^\/__ext\/([^/]+)\/(.+)$/);
    if (!ext) return join(dir, path);
    const root = await required(ext[1]);
    return root && join(root, ext[2]);
  };
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: Number(process.argv[3] ?? 0),
    async fetch(req) {
      const url = new URL(req.url);
      const path = normalize(decodeURIComponent(url.pathname));
      const file = await route(path);
      if (!file || path.split("/").some((s) => s.startsWith(".")) || !(await Bun.file(file).exists())) return new Response("not found", { status: 404 });
      const headers = { "Content-Security-Policy": CSP.replaceAll("'self'", `'self' ${url.origin}`), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" };
      if (extname(file) === ".ts") return new Response(await transpile(file), { headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" } });
      if (extname(file) === ".wasm") return new Response(Bun.file(file), { headers: { ...headers, "Content-Type": "application/wasm" } });
      return new Response(Bun.file(file), { headers });
    },
  });
  console.log(`serving ${dir} at http://${hostname()}:${server.port}/`);
}
