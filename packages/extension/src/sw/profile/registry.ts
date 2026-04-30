/**
 * Profile registry — the in-extension catalog of `SiteProfile`s.
 *
 * For v0, profiles are static modules bundled with the extension. The
 * registry exists so the request dispatcher and (later) the popup UI can
 * look profiles up by name without each having to import every profile
 * module directly.
 *
 * Add a profile by importing it here and pushing it into REGISTERED.
 * Recorded user-defined profiles (M3+) will append to this list at runtime
 * via chrome.storage; the API stays the same.
 */

import type { SiteProfile, ToolDefinition } from "@conduit/protocol";

import { linearProfile } from "./profiles/linear.js";

const REGISTERED: SiteProfile[] = [linearProfile];

export function registerProfile(profile: SiteProfile): void {
  if (REGISTERED.some((p) => p.name === profile.name)) {
    throw new Error(`Profile "${profile.name}" is already registered`);
  }
  REGISTERED.push(profile);
}

export function getProfile(name: string): SiteProfile | undefined {
  return REGISTERED.find((p) => p.name === name);
}

export function getAllProfiles(): readonly SiteProfile[] {
  return REGISTERED;
}

export function getTool(
  profileName: string,
  toolName: string,
): { profile: SiteProfile; tool: ToolDefinition } | undefined {
  const profile = getProfile(profileName);
  if (!profile) return undefined;
  const tool = profile.tools.find((t) => t.name === toolName);
  if (!tool) return undefined;
  return { profile, tool };
}
