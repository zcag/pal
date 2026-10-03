// The web build (src/web): the panel as a static page, `node:*` mapped to the
// shim the host and the SDK need in a browser. `scripts/build-web.ts` runs it.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const shim = resolve(__dirname, "src/web/node.ts");

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: { alias: [{ find: /^node:(fs|fs\/promises|path|os|async_hooks)$/, replacement: shim }] },
  build: { outDir: "dist-web", emptyOutDir: true, rollupOptions: { input: resolve(__dirname, "web.html") } },
});
