import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
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
        "offline.html",
      ]) {
        const src = join(__dirname, file);
        if (existsSync(src)) {
          cpSync(src, join(out, file));
        }
      }
    },
  };
}

const PWA_MANIFEST = {
  name: "BuyForMe — Shop the World",
  short_name: "BuyForMe",
  description:
    "Connect with verified personal shoppers worldwide. Request products, pay securely, and track delivery.",
  lang: "en",
  dir: "ltr",
  id: "./",
  start_url: "./buyers.html",
  scope: "./",
  display: "standalone",
  display_override: ["standalone", "minimal-ui", "browser"],
  orientation: "portrait-primary",
  theme_color: "#1a9e6e",
  background_color: "#faf8f3",
  categories: ["shopping", "business", "finance"],
  icons: [
    {
      src: "images/pwa/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "images/pwa/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "images/pwa/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  shortcuts: [
    {
      name: "Discover shoppers",
      short_name: "Discover",
      description: "Browse verified personal shoppers",
      url: "./buyers.html",
      icons: [{ src: "images/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "My orders",
      short_name: "Orders",
      description: "Track your purchases",
      url: "./my-orders.html",
      icons: [{ src: "images/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Messages",
      short_name: "Messages",
      description: "Chat with your shopper",
      url: "./chat.html",
      icons: [{ src: "images/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
  ],
  share_target: {
    action: "./request.html",
    method: "GET",
    enctype: "application/x-www-form-urlencoded",
    params: {
      title: "title",
      text: "text",
      url: "url",
    },
  },
  prefer_related_applications: false,
};

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
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: [
          "images/logo.png",
          "images/pwa/icon-192.png",
          "images/pwa/icon-512.png",
          "images/pwa/icon-maskable-512.png",
          "offline.html",
        ],
        manifest: PWA_MANIFEST,
        devOptions: {
          enabled: true,
          type: "module",
        },
        workbox: {
          globDirectory: "dist",
          globPatterns: ["**/*.{html,js,css,png,svg,ico,webmanifest,woff2}"],
          navigateFallback: "offline.html",
          navigateFallbackDenylist: [/^\/api\//],
          skipWaiting: false,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          mode: "production",
          globIgnores: [
            "**/phone-mockup.png",
            "**/Buyforme logo.png",
            "**/node_modules/**",
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: "NetworkOnly",
            },
            {
              urlPattern: /\/runtime-config\.js$/i,
              handler: "NetworkOnly",
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "google-fonts-stylesheets",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "cdnjs-assets",
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
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
