/**
 * `extract_ax_tree` handler.
 *
 * 1. Find a tab whose URL matches `urlPattern`. If none -> LOGIN_REQUIRED.
 * 2. Attach chrome.debugger (CDP 1.3) to the tab.
 * 3. Enable Accessibility, fetch full AX tree, build a hierarchical AxNode.
 *
 * We deliberately leave the debugger attached after the call. The yellow
 * "DevTools is debugging this tab" banner is expected for the M0 spike.
 */

import type {
  ExtractAxTreeRequest,
  ExtractAxTreeResponse,
} from "@conduit/protocol";

import { findMatchingTab } from "../url-match.js";
import { attachIfNeeded, sendCommand } from "../debugger-util.js";
import {
  buildAxTree,
  type CdpAxTreeResponse,
} from "../ax-tree.js";
import { HandlerError } from "../errors.js";

export async function extractAxTree(
  req: ExtractAxTreeRequest,
): Promise<ExtractAxTreeResponse> {
  const tab = await findMatchingTab(req.urlPattern);
  if (!tab || tab.id === undefined || !tab.url) {
    throw new HandlerError(
      "LOGIN_REQUIRED",
      `No open tab matches ${req.urlPattern}. Log in and open the page first.`,
    );
  }

  const tabId = tab.id;
  await attachIfNeeded(tabId);

  await sendCommand(tabId, "Accessibility.enable");
  const cdp = await sendCommand<CdpAxTreeResponse>(
    tabId,
    "Accessibility.getFullAXTree",
    {},
  );

  const buildOpts: { maxDepth?: number; rootRole?: string } = {};
  if (req.maxDepth !== undefined) buildOpts.maxDepth = req.maxDepth;
  if (req.rootRole !== undefined) buildOpts.rootRole = req.rootRole;
  const tree = buildAxTree(cdp, buildOpts);

  return {
    url: tab.url,
    tabId,
    capturedAt: Date.now(),
    tree,
  };
}
