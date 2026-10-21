import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
// Fixed file names and a relative base, so the committed output is served from any path.
export default defineConfig({
  plugins: [vue()],
  base: "./",
  build: { outDir: "../../../site/real/vue", emptyOutDir: true, sourcemap: true,
    rollupOptions: { output: { sourcemapExcludeSources: true, entryFileNames: "app.js", chunkFileNames: "[name].js", assetFileNames: "[name][extname]" } } },
});
