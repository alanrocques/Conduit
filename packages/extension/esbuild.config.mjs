// esbuild configuration for the Conduit extension.
//
// Bundles three entrypoints:
//   - src/sw/index.ts         -> dist/sw.js      (service worker, ESM)
//   - src/popup/index.tsx     -> dist/popup.js   (React popup)
//   - src/options/index.tsx   -> dist/options.js (React options)
//
// Static assets in `public/` (manifest.json, popup.html, options.html, icons)
// are copied verbatim into `dist/`.

import * as esbuild from "esbuild";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateIcons } from "./scripts/gen-icons.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const distDir = path.join(root, "dist");
const publicDir = path.join(root, "public");
const iconsDir = path.join(publicDir, "icons");

const watch = process.argv.includes("--watch");

async function ensureIcons() {
  const sizes = [16, 48, 128];
  const allExist = sizes.every((s) => existsSync(path.join(iconsDir, `icon-${s}.png`)));
  if (!allExist) {
    await mkdir(iconsDir, { recursive: true });
    await generateIcons(iconsDir);
  }
}

async function copyPublic() {
  // Recursively copy `public/` -> `dist/`.
  await cp(publicDir, distDir, { recursive: true });
}

async function clean() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  platform: "browser",
  target: ["chrome120"],
  external: [],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
};

const swOptions = {
  ...sharedOptions,
  entryPoints: [path.join(root, "src/sw/index.ts")],
  outfile: path.join(distDir, "sw.js"),
  format: "esm",
};

const popupOptions = {
  ...sharedOptions,
  entryPoints: [path.join(root, "src/popup/index.tsx")],
  outfile: path.join(distDir, "popup.js"),
  format: "iife",
  jsx: "automatic",
};

const optionsOptions = {
  ...sharedOptions,
  entryPoints: [path.join(root, "src/options/index.tsx")],
  outfile: path.join(distDir, "options.js"),
  format: "iife",
  jsx: "automatic",
};

async function buildOnce() {
  await clean();
  await ensureIcons();
  await copyPublic();
  await Promise.all([
    esbuild.build(swOptions),
    esbuild.build(popupOptions),
    esbuild.build(optionsOptions),
  ]);
  // eslint-disable-next-line no-console
  console.log("[esbuild] build complete ->", distDir);
}

async function buildWatch() {
  await clean();
  await ensureIcons();
  await copyPublic();
  const ctxs = await Promise.all([
    esbuild.context(swOptions),
    esbuild.context(popupOptions),
    esbuild.context(optionsOptions),
  ]);
  await Promise.all(ctxs.map((c) => c.watch()));
  // eslint-disable-next-line no-console
  console.log("[esbuild] watching for changes...");
}

if (watch) {
  await buildWatch();
} else {
  await buildOnce();
}

// Touch unused import to keep tree-shake happy on some node setups.
void stat;
