/**
 * `run_profile_tool` handler — dispatches a profile tool through the runtime.
 */

import type {
  RunProfileToolRequest,
  RunProfileToolResponse,
} from "@conduit/protocol";

import { HandlerError } from "../errors.js";
import { getTool } from "../profile/registry.js";
import { runProfileTool } from "../profile/runtime.js";

export async function runProfileToolHandler(
  req: RunProfileToolRequest,
): Promise<RunProfileToolResponse> {
  const found = getTool(req.profileName, req.toolName);
  if (!found) {
    throw new HandlerError(
      "INVALID_REQUEST",
      `Unknown profile tool: ${req.profileName}.${req.toolName}`,
    );
  }
  const { profile, tool } = found;

  const urlPattern = req.urlPattern ?? profile.urlPatterns[0];
  if (!urlPattern) {
    throw new HandlerError(
      "INTERNAL_ERROR",
      `Profile "${profile.name}" has no urlPatterns and caller didn't supply one.`,
    );
  }

  const result = await runProfileTool(
    profile,
    tool,
    req.args ?? {},
    urlPattern,
  );

  return {
    url: result.url,
    tabId: result.tabId,
    ranAt: Date.now(),
    outputs: result.outputs,
  };
}
