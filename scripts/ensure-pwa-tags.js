#!/usr/bin/env node
/** Idempotently inject PWA meta tags and registration script into HTML pages. */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PWA_HEAD = `
    <link rel="manifest" href="manifest.webmanifest">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="BuyForMe">
    <link rel="apple-touch-icon" href="images/pwa/icon-192.png">
    <link rel="stylesheet" href="css/pwa.css">`;

const PWA_SCRIPT = `    <script type="module" src="css/js/pwa-register.js"></script>\n`;

const THEME_COLOR = `    <meta name="theme-color" content="#1a9e6e">`;
const VIEW_TRANSITION = `    <meta name="view-transition" content="same-origin">`;

const htmlFiles = readdirSync(root).filter(
  (f) =>
    f.endsWith(".html") &&
    f !== "offline.html" &&
    f !== "shopper-dashboard.dev.html" &&
    f !== "shopper-dashboard.html"
);

let updated = 0;

for (const file of htmlFiles) {
  const path = join(root, file);
  let html = readFileSync(path, "utf8");
  let changed = false;

  if (!html.includes("manifest.webmanifest")) {
    const iconMatch = html.match(/<link rel="icon"[^>]+>/);
    if (iconMatch) {
      html = html.replace(iconMatch[0], iconMatch[0] + PWA_HEAD);
      changed = true;
    }
  }

  if (!html.includes('name="theme-color"')) {
    const viewport = html.match(/<meta name="viewport"[^>]+>/);
    if (viewport) {
      html = html.replace(viewport[0], viewport[0] + "\n" + THEME_COLOR);
      changed = true;
    }
  }

  if (html.includes('class="buyer-app') && !html.includes("view-transition")) {
    const viewport = html.match(/<meta name="viewport"[^>]+>/);
    if (viewport) {
      html = html.replace(viewport[0], viewport[0] + "\n" + VIEW_TRANSITION);
      changed = true;
    }
  }

  if (!html.includes("pwa-register.js")) {
    html = html.replace("</body>", PWA_SCRIPT + "</body>");
    changed = true;
  }

  if (changed) {
    writeFileSync(path, html);
    updated += 1;
    console.log("PWA tags:", file);
  }
}

console.log(updated ? `Updated ${updated} HTML file(s).` : "All HTML pages already have PWA tags.");
