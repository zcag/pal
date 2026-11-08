import { defineConfig } from "vite";

/** `@zcag/pal-web`'s elements as one module the app serves at `/__pal/web.js` (remote.rs `web_module`), so a site imports the copy that matches the pal it frames. */
export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: "../web/src/index.ts", formats: ["es"], fileName: () => "web.js" },
    outDir: "dist/__pal",
    emptyOutDir: false,
    minify: true,
  },
});
