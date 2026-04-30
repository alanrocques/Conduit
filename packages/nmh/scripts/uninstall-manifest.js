#!/usr/bin/env node
/**
 * Remove the Chrome Native Messaging Host manifest for `com.conduit.bridge`
 * from the OS-appropriate location. No-op if the file does not exist.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST_NAME = "com.conduit.bridge";

function manifestPathForPlatform() {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
        `${HOST_NAME}.json`,
      );
    case "linux":
      return path.join(
        home,
        ".config",
        "google-chrome",
        "NativeMessagingHosts",
        `${HOST_NAME}.json`,
      );
    default:
      return null;
  }
}

async function main() {
  if (process.platform === "win32") {
    console.error(
      "Windows is not supported in M0 — unregister manually via the registry " +
        "(remove HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.conduit.bridge).",
    );
    process.exit(1);
  }

  const manifestPath = manifestPathForPlatform();
  if (!manifestPath) {
    console.error(`Unsupported platform: ${process.platform}.`);
    process.exit(1);
  }

  try {
    await fs.unlink(manifestPath);
    console.log(`Removed ${manifestPath}`);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log(`No manifest at ${manifestPath} (nothing to remove).`);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("uninstall-manifest failed:", err);
  process.exit(1);
});
