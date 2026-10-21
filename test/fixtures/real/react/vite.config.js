import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Fixed file names and a relative base, so the committed output is served from any path.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "../../../site/real/react", emptyOutDir: true, sourcemap: true,
    rollupOptions: { output: { sourcemapExcludeSources: true, entryFileNames: "app.js", chunkFileNames: "[name].js", assetFileNames: "[name][extname]" } } },
});
