/**
 * `click_by_role_name` handler.
 *
 * Strategy:
 *   1. Find tab matching `urlPattern`.
 *   2. Attach CDP, fetch full AX tree.
 *   3. Find first node with matching role + name (case-insensitive).
 *   4. Resolve node -> backendDOMNodeId -> DOM box -> center point.
 *   5. Dispatch trusted mousePressed + mouseReleased via Input.dispatchMouseEvent.
 */

import type {
  ClickByRoleNameRequest,
  ClickByRoleNameResponse,
} from "@conduit/protocol";

import { findMatchingTab } from "../url-match.js";
import { attachIfNeeded, sendCommand } from "../debugger-util.js";
import {
  findFirstByRoleAndName,
  type CdpAxNode,
  type CdpAxTreeResponse,
} from "../ax-tree.js";
import { HandlerError } from "../errors.js";

interface ResolveNodeResult {
  object: { objectId?: string };
}

interface BoxModelResult {
  model: {
    content: number[]; // [x1,y1,x2,y2,x3,y3,x4,y4]
    width: number;
    height: number;
  };
}

function quadCenter(content: number[]): { x: number; y: number } {
  // content is 8 numbers — 4 points clockwise. Average for the centroid.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < 8; i += 2) {
    sx += content[i] ?? 0;
    sy += content[i + 1] ?? 0;
  }
  return { x: sx / 4, y: sy / 4 };
}

async function getCenterForNode(
  tabId: number,
  cdpNode: CdpAxNode,
): Promise<{ x: number; y: number }> {
  if (cdpNode.backendDOMNodeId === undefined) {
    throw new HandlerError(
      "INTERNAL_ERROR",
      "Matched AX node has no backendDOMNodeId; cannot click.",
    );
  }

  // Try the cheap path first: get the box model directly from the backend node.
  try {
    const box = await sendCommand<BoxModelResult>(tabId, "DOM.getBoxModel", {
      backendNodeId: cdpNode.backendDOMNodeId,
    });
    return quadCenter(box.model.content);
  } catch {
    // Fall back to resolveNode -> getBoxModel by objectId.
  }

  const resolved = await sendCommand<ResolveNodeResult>(
    tabId,
    "DOM.resolveNode",
    { backendNodeId: cdpNode.backendDOMNodeId },
  );
  const objectId = resolved.object.objectId;
  if (!objectId) {
    throw new HandlerError(
      "INTERNAL_ERROR",
      "Failed to resolve AX node to a DOM object.",
    );
  }
  const box = await sendCommand<BoxModelResult>(tabId, "DOM.getBoxModel", {
    objectId,
  });
  return quadCenter(box.model.content);
}

export async function clickByRoleName(
  req: ClickByRoleNameRequest,
): Promise<ClickByRoleNameResponse> {
  const tab = await findMatchingTab(req.urlPattern);
  if (!tab || tab.id === undefined || !tab.url) {
    throw new HandlerError(
      "LOGIN_REQUIRED",
      `No open tab matches ${req.urlPattern}. Log in and open the page first.`,
    );
  }

  const tabId = tab.id;
  await attachIfNeeded(tabId);

  // Required prerequisite for DOM.* commands.
  await sendCommand(tabId, "DOM.enable");
  await sendCommand(tabId, "Accessibility.enable");

  const cdp = await sendCommand<CdpAxTreeResponse>(
    tabId,
    "Accessibility.getFullAXTree",
    {},
  );

  const match = findFirstByRoleAndName(cdp.nodes ?? [], req.role, req.name);
  if (!match) {
    throw new HandlerError(
      "SCHEMA_ERROR",
      `No AX node matches role="${req.role}" name="${req.name}" on ${tab.url}. ` +
        `Re-extract the AX tree to see what's currently on the page.`,
    );
  }

  const center = await getCenterForNode(tabId, match);

  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });

  return {
    tabId,
    url: tab.url,
    clickedAt: Date.now(),
  };
}
