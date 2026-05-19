import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";

const BASE = "/BUYFORME/";

function renameDashboardHtml(out) {
  const devHtml = join(out, "shopper-dashboard.dev.html");
  const prodHtml = join(out, "shopper-dashboard.html");
  if (existsSync(devHtml)) {
    cpSync(devHtml, prodHtml);
    rmSync(devHtml);
  }
}

/** Copy legacy static assets (css/, images/) into dist on production build. */
function copyLegacyAssets() {
  return {
    name: "copy-legacy-assets",
    closeBundle() {
      const out = resolve(__dirname, "dist");
      renameDashboardHtml(out);
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

/** Copy built dashboard bundle to repo root for GitHub Pages (main branch). */
function syncGithubPagesRoot() {
  return {
    name: "sync-github-pages-root",
    closeBundle() {
      const out = resolve(__dirname, "dist");
      renameDashboardHtml(out);
      const builtHtml = join(out, "shopper-dashboard.html");
      const builtAssets = join(out, "assets");
      const rootAssets = resolve(__dirname, "assets");

      if (builtHtml) {
        cpSync(builtHtml, join(__dirname, "shopper-dashboard.html"));
      }
      if (existsSync(builtAssets)) {
        if (existsSync(rootAssets)) rmSync(rootAssets, { recursive: true });
        mkdirSync(rootAssets, { recursive: true });
        cpSync(builtAssets, rootAssets, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), copyLegacyAssets(), syncGithubPagesRoot()],
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "shopper-dashboard": resolve(__dirname, "shopper-dashboard.dev.html"),
      },
      output: {
        entryFileNames: "assets/shopper-dashboard.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 5173,
    open: "/shopper-dashboard.dev.html",
  },
});
