import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";

/** Relative base works on GitHub Pages (/BUYFORME/) and localhost. */
const PROD_BASE = "./";

function generateRuntimeConfig() {
  return {
    name: "generate-runtime-config",
    buildStart() {
      execSync("node scripts/generate-runtime-config.js", {
        cwd: __dirname,
        stdio: "inherit",
      });
    },
  };
}

function renameDashboardHtml(out) {
  const devHtml = join(out, "shopper-dashboard.dev.html");
  const prodHtml = join(out, "shopper-dashboard.html");
  if (existsSync(devHtml)) {
    cpSync(devHtml, prodHtml);
    rmSync(devHtml);
  }
}

/** Static buyer/auth pages must not get React Fast Refresh (breaks ES modules locally). */
function stripReactRefreshFromLegacyHtml() {
  const keepRefresh = /shopper-dashboard(\.dev)?\.html$/i;
  const refreshBlock =
    /<script type="module">\s*import\s+\{\s*injectIntoGlobalHook\s*\}\s+from\s+["']\/@react-refresh["'];[\s\S]*?<\/script>\s*/i;

  return {
    name: "strip-react-refresh-legacy-html",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const file = (ctx.filename || "").replace(/\\/g, "/");
        if (keepRefresh.test(file)) return html;
        return html.replace(refreshBlock, "");
      },
    },
  };
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
      for (const file of [
        "auth.html",
        "index.html",
        "verify.html",
        "buyers.html",
        "shopper-profile.html",
        "request.html",
        "my-orders.html",
        "chat.html",
        "admin.html",
        "tracking.html",
        "wishlist.html",
        "cart.html",
      ]) {
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

export default defineConfig(({ command }) => {
  const isBuild = command === "build";

  return {
    /* Dev: /  |  Build: relative ./assets so login → dashboard works everywhere */
    base: isBuild ? PROD_BASE : "/",
    plugins: [
      generateRuntimeConfig(),
      react({ include: /\.(jsx|tsx)$/ }),
      stripReactRefreshFromLegacyHtml(),
      copyLegacyAssets(),
      syncGithubPagesRoot(),
    ],
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
      strictPort: true,
      open: "/index.html",
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});
