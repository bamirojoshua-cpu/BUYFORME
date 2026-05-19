import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "fs";
import { join, resolve } from "path";

/** Copy legacy static assets (css/, images/) into dist on production build. */
function copyLegacyAssets() {
  return {
    name: "copy-legacy-assets",
    closeBundle() {
      const out = resolve(__dirname, "dist");
      for (const dir of ["css", "images"]) {
        const src = join(__dirname, dir);
        if (existsSync(src)) {
          cpSync(src, join(out, dir), { recursive: true });
        }
      }
      for (const file of ["auth.html", "index.html", "verify.html"]) {
        const src = join(__dirname, file);
        if (existsSync(src)) {
          cpSync(src, join(out, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyLegacyAssets()],
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        shopperDashboard: resolve(__dirname, "shopper-dashboard.html"),
      },
    },
  },
  server: {
    port: 5173,
    open: "/shopper-dashboard.html",
  },
});
