import { defineConfig, transformWithOxc, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

const REPO = resolve(__dirname, "..");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };

/**
 * The gallery's game surfaces (docs/design/screenshots.md): a surface page
 * as the app's `ext://` scheme serves it (surface.rs), for the gallery's
 * Launcher to frame. `/__ext/<extension>/<path>` is a file of the
 * extension's folder, a `.ts` one transpiled as surface.rs does (no
 * bundling); `/__pal/<path>` is the kit. The frame is sandboxed (an opaque
 * origin), so every answer allows any origin, as surface.rs's do. Dev only.
 */
function surfaces(): Plugin {
  return {
    name: "pal-gallery-surfaces",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        const ext = /^\/__ext\/([\w-]+)\/(.+)$/.exec(url);
        const kit = /^\/__pal\/(.+)$/.exec(url);
        if (!ext && !kit) return next();
        // The design faces are the app's own copies (surface.rs serves the same files).
        const fonts = kit && kit[1].startsWith("fonts/");
        const base = ext ? join(REPO, "extensions", ext[1]) : fonts ? join(REPO, "app/src/assets/fonts") : join(REPO, "app/src-tauri/surface-kit");
        const file = normalize(join(base, ext ? ext[2] : fonts ? kit![1].slice(6) : kit![1]));
        if (!file.startsWith(base)) { res.statusCode = 403; return res.end(); }
        try {
          let body: Buffer | string = await readFile(file);
          if (file.endsWith(".ts")) body = (await transformWithOxc(body.toString(), file, { lang: "ts" })).code;
          res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), surfaces()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Reachable as http://hornet:1420 from the LAN so the gallery can be reviewed off-box.
    host: host || true,
    allowedHosts: ["hornet", "hornet.lan"],
    // `make shots` runs a private server (PAL_SHOTS): no hot reload and no watcher, so a fixture written mid-render does not reload the page it is shooting.
    hmr: process.env.PAL_SHOTS
      ? false
      : host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
    watch: process.env.PAL_SHOTS
      ? null
      : {
          // 3. tell Vite to ignore watching `src-tauri`
          ignored: ["**/src-tauri/**"],
        },
  },
}));
