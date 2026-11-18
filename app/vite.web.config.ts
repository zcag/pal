import { defineConfig } from "vite";

/**
 * `@zcag/pal-web` as the single modules the app serves (remote.rs `module`):
 * `/__pal/web.js`, the elements, and with `--mode embed` `/__pal/embed.js`,
 * the one-tag layer with the elements inside it. A site imports the copy
 * that matches the pal it frames.
 */
export default defineConfig(({ mode }) => {
  const embed = mode === "embed";
  return {
    publicDir: false,
    build: {
      lib: { entry: embed ? "../web/src/embed.ts" : "../web/src/index.ts", formats: ["es"], fileName: () => (embed ? "embed.js" : "web.js") },
      outDir: "dist/__pal",
      emptyOutDir: false,
      minify: true,
    },
  };
});
