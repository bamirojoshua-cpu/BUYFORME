#!/usr/bin/env node
/**
 * Syntax-check all app JavaScript modules before dev/build.
 * Catches errors like invalid ?? / || mixing that break entire import chains.
 */
import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["css/js", "scripts"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

const files = dirs.flatMap((d) => walk(join(root, d)));
const failures = [];

for (const file of files) {
  if (file.endsWith("check-syntax.js")) continue;
  try {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
  } catch (e) {
    failures.push({ file, err: e.stderr?.toString() || e.message });
  }
}

// HTML asset paths referenced by pages must exist (case-sensitive safe)
const htmlFiles = readdirSync(root).filter((f) => f.endsWith(".html"));
const assetRe = /(?:href|src)="((?:css|images)\/[^"]+)"/g;
const missingAssets = [];

for (const html of htmlFiles) {
  const content = readFileSync(join(root, html), "utf8");
  let m;
  while ((m = assetRe.exec(content))) {
    const rel = m[1];
    try {
      statSync(join(root, rel));
    } catch {
      missingAssets.push({ html, path: rel });
    }
  }
}

if (failures.length) {
  console.error("JavaScript syntax errors:\n");
  for (const f of failures) {
    console.error(f.file);
    console.error(f.err.trim());
    console.error("");
  }
}

if (missingAssets.length) {
  console.error("Missing assets referenced in HTML:\n");
  for (const m of missingAssets) {
    console.error(`  ${m.html} → ${m.path}`);
  }
  console.error("");
}

if (failures.length || missingAssets.length) {
  process.exit(1);
}

console.log(`check-syntax OK (${files.length} JS files, ${htmlFiles.length} HTML pages)`);
