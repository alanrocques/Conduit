#!/usr/bin/env node
/**
 * Install the Chrome Native Messaging Host manifest for `com.conduit.bridge`.
 *
 * Manifest path by OS:
 *   - macOS:   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.conduit.bridge.json
 *              (and per-browser variants — see manifestDirsForPlatform)
 *   - Linux:   ~/.config/google-chrome/NativeMessagingHosts/com.conduit.bridge.json
 *   - Windows: not supported in M0; instructions printed for manual registry registration.
 *
 * Deployment layout:
 *   - The wrapper + bundle are copied into ~/.conduit/bin/, NOT left in the
 *     repo's dist/. macOS TCC (Privacy → Files & Folders → Documents) silently
 *     blocks browsers like Arc from executing files inside ~/Documents/, which
 *     is where this repo typically lives. Putting the runtime under
 *     ~/.conduit/ avoids the protected-folder check entirely.
 *   - The bundle (`conduit-nmh.bundle.js`) is the esbuild output from the
 *     postbuild step; it inlines `@conduit/protocol` so we don't need to copy
 *     node_modules alongside it.
 *   - Each manifest's `path` field points at the deployed wrapper.
 *
 * Extension ID:
 *   - Read from env var `CONDUIT_EXTENSION_ID`.
 *   - If unset, the manifest is written with a placeholder
 *     `chrome-extension://REPLACE_ME/` and a warning is printed; the user
 *     must edit the manifest after loading the unpacked extension to learn
 *     its assigned ID (chrome://extensions, with Developer mode enabled).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.conduit.bridge";
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const builtWrapperPath = path.join(pkgRoot, "dist", "conduit-nmh.sh");
const builtBundlePath = path.join(pkgRoot, "dist", "index.bundle.js");

// Runtime location — outside ~/Documents/ so macOS TCC doesn't block browsers
// from executing the wrapper.
const deployDir = path.join(os.homedir(), ".conduit", "bin");
const deployedWrapperPath = path.join(deployDir, "conduit-nmh.sh");
const deployedBundlePath = path.join(deployDir, "conduit-nmh.bundle.js");

// Returns every Chromium-derived browser's NMH dir we should install into,
// across the user's installed browsers. We install into all of them because
// a developer often loads the unpacked extension into more than one browser
// (Chrome + Arc, etc.) and there's no harm in having stale manifests sitting
// in a browser the extension isn't loaded in — they're a few hundred bytes.
function manifestDirsForPlatform() {
  const home = os.homedir();
  const appSupport = path.join(home, "Library", "Application Support");
  const candidates = {
    darwin: [
      path.join(appSupport, "Google", "Chrome", "NativeMessagingHosts"),
      path.join(appSupport, "Google", "Chrome Beta", "NativeMessagingHosts"),
      path.join(appSupport, "Google", "Chrome Canary", "NativeMessagingHosts"),
      path.join(appSupport, "Google", "Chrome Dev", "NativeMessagingHosts"),
      path.join(appSupport, "Chromium", "NativeMessagingHosts"),
      path.join(appSupport, "Microsoft Edge", "NativeMessagingHosts"),
      path.join(
        appSupport,
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
      ),
      // Arc nests its NMH dir under "User Data".
      path.join(appSupport, "Arc", "User Data", "NativeMessagingHosts"),
    ],
    linux: [
      path.join(home, ".config", "google-chrome", "NativeMessagingHosts"),
      path.join(home, ".config", "chromium", "NativeMessagingHosts"),
      path.join(
        home,
        ".config",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
      ),
      path.join(home, ".config", "microsoft-edge", "NativeMessagingHosts"),
    ],
  };
  return candidates[process.platform] ?? null;
}

async function main() {
  if (process.platform === "win32") {
    console.error(
      "Windows is not supported in M0 — register manually via registry " +
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.conduit.bridge",
    );
    console.error(
      "Point its default value at the absolute path of a JSON manifest you author by hand.",
    );
    process.exit(1);
  }

  const dirs = manifestDirsForPlatform();
  if (!dirs) {
    console.error(
      `Unsupported platform: ${process.platform}. Only darwin and linux are supported in M0.`,
    );
    process.exit(1);
  }

  // Verify the build artifacts exist; nudge the user to build first if not.
  for (const p of [builtWrapperPath, builtBundlePath]) {
    try {
      await fs.access(p);
    } catch {
      console.error(
        `Could not find ${p}. Run \`npm run build --workspace @conduit/nmh\` first.`,
      );
      process.exit(1);
    }
  }

  // Deploy wrapper + bundle to ~/.conduit/bin/ (outside ~/Documents/).
  await fs.mkdir(deployDir, { recursive: true });
  await fs.copyFile(builtBundlePath, deployedBundlePath);
  await fs.chmod(deployedBundlePath, 0o755);
  await fs.copyFile(builtWrapperPath, deployedWrapperPath);
  await fs.chmod(deployedWrapperPath, 0o755);

  const extensionId = process.env.CONDUIT_EXTENSION_ID;
  const allowedOrigin = extensionId
    ? `chrome-extension://${extensionId}/`
    : "chrome-extension://REPLACE_ME/";

  const manifest = {
    name: HOST_NAME,
    description: "Conduit Native Messaging Host",
    path: deployedWrapperPath,
    type: "stdio",
    allowed_origins: [allowedOrigin],
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

  const written = [];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    await fs.writeFile(manifestPath, manifestJson, { encoding: "utf8" });
    written.push(manifestPath);
  }

  console.log(`Deployed runtime to ${deployDir}`);
  for (const p of written) console.log(`Wrote ${p}`);
  console.log(`  path            = ${deployedWrapperPath}`);
  console.log(`  allowed_origins = ${allowedOrigin}`);

  if (!extensionId) {
    console.warn("");
    console.warn(
      "WARNING: CONDUIT_EXTENSION_ID was not set, so allowed_origins contains the placeholder " +
        '"chrome-extension://REPLACE_ME/".',
    );
    console.warn(
      "  1. Load the unpacked extension via chrome://extensions (enable Developer mode).",
    );
    console.warn(
      "  2. Copy its assigned ID (looks like a 32-char lowercase string).",
    );
    console.warn("  3. Either:");
    console.warn(
      `     - Re-run with: CONDUIT_EXTENSION_ID=<id> npm run install:manifest --workspace @conduit/nmh`,
    );
    console.warn(`     - Or hand-edit each manifest file above and replace REPLACE_ME.`);
  }
}

main().catch((err) => {
  console.error("install-manifest failed:", err);
  process.exit(1);
});
