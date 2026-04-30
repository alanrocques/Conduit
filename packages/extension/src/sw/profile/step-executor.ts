/**
 * Per-step executors. Each takes (tabId, step, args) and either:
 *   - performs a side effect (navigate, click, input, key) and returns void, or
 *   - returns an output value (extract_ax_tree, extract_text) the runtime
 *     stashes under `step.outputName` in the result map.
 *
 * All step executors assume `Accessibility.enable` and `DOM.enable` have
 * already been issued by the caller (the runtime). Per-step CDP enables
 * would multiply round-trips with no benefit.
 */

import type {
  AxNode,
  ClickStep,
  ExtractAxTreeStep,
  ExtractTextStep,
  InputStep,
  KeyStep,
  NavigateStep,
  ToolArgs,
  WaitForElementStep,
} from "@conduit/protocol";

import { sendCommand } from "../debugger-util.js";
import {
  buildAxTree,
  findFirstByRoleAndName,
  type CdpAxNode,
  type CdpAxTreeResponse,
} from "../ax-tree.js";
import { HandlerError } from "../errors.js";
import { substitute } from "./substitute.js";

const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const WAIT_POLL_INTERVAL_MS = 200;

// --- helpers ------------------------------------------------------------

async function fetchAxTree(tabId: number): Promise<CdpAxNode[]> {
  const cdp = await sendCommand<CdpAxTreeResponse>(
    tabId,
    "Accessibility.getFullAXTree",
    {},
  );
  return cdp.nodes ?? [];
}

interface ResolveNodeResult {
  object: { objectId?: string };
}

interface BoxModelResult {
  model: {
    content: number[];
    width: number;
    height: number;
  };
}

function quadCenter(content: number[]): { x: number; y: number } {
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
  node: CdpAxNode,
): Promise<{ x: number; y: number }> {
  if (node.backendDOMNodeId === undefined) {
    throw new HandlerError(
      "INTERNAL_ERROR",
      "Matched AX node has no backendDOMNodeId; cannot interact.",
    );
  }
  try {
    const box = await sendCommand<BoxModelResult>(tabId, "DOM.getBoxModel", {
      backendNodeId: node.backendDOMNodeId,
    });
    return quadCenter(box.model.content);
  } catch {
    /* fall through to resolveNode */
  }
  const resolved = await sendCommand<ResolveNodeResult>(
    tabId,
    "DOM.resolveNode",
    { backendNodeId: node.backendDOMNodeId },
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

async function dispatchClickAt(
  tabId: number,
  point: { x: number; y: number },
): Promise<void> {
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

// --- executors ----------------------------------------------------------

export async function execNavigate(
  tabId: number,
  step: NavigateStep,
  args: ToolArgs,
): Promise<void> {
  const target = substitute(step.url, args);
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    throw new HandlerError(
      "INTERNAL_ERROR",
      "Cannot navigate: tab has no current URL.",
    );
  }
  // Resolve relative paths against the tab's current origin.
  const url = target.startsWith("/")
    ? new URL(tab.url).origin + target
    : target;
  // No-op if we're already on the target URL. chrome.tabs.update with a
  // matching URL doesn't reload (and doesn't fire onUpdated 'complete'),
  // which would otherwise leave us hanging until the deadline. This makes
  // re-running a tool on the same view idempotent.
  if (tab.url === url) return;

  // Register the listener BEFORE issuing the update, otherwise the
  // 'complete' event can fire (and be missed) before we attach.
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        new HandlerError("TIMEOUT", `Navigation to ${url} did not complete in 15s.`),
      );
    }, 15_000);
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ): void => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        clearTimeout(deadline);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((err: unknown) => {
      clearTimeout(deadline);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        err instanceof Error
          ? err
          : new HandlerError("INTERNAL_ERROR", `Navigation failed: ${String(err)}`),
      );
    });
  });
}

export async function execWaitForElement(
  tabId: number,
  step: WaitForElementStep,
  args: ToolArgs,
): Promise<void> {
  const role = substitute(step.role, args);
  const hasName = step.name !== undefined && step.name !== "";
  const name = hasName ? substitute(step.name as string, args) : undefined;
  const timeoutMs = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await fetchAxTree(tabId);
    // Note: don't filter on `ignored` here. SPAs (Linear, GitHub, etc.) can
    // mark landmarks as ignored mid-transition; if the profile says "wait
    // for role=X", trust it and accept any node with that role.
    const found = name !== undefined
      ? findFirstByRoleAndName(nodes, role, name)
      : nodes.find((n) => (n.role?.value ?? "") === role);
    if (found) return;
    await new Promise((r) => setTimeout(r, WAIT_POLL_INTERVAL_MS));
  }
  const desc = name !== undefined
    ? `role="${role}" name="${name}"`
    : `role="${role}"`;
  throw new HandlerError(
    "TIMEOUT",
    `Timed out after ${timeoutMs}ms waiting for ${desc}.`,
  );
}

export async function execClick(
  tabId: number,
  step: ClickStep,
  args: ToolArgs,
): Promise<void> {
  const role = substitute(step.role, args);
  const name = substitute(step.name, args);
  const nodes = await fetchAxTree(tabId);
  const node = findFirstByRoleAndName(nodes, role, name);
  if (!node) {
    throw new HandlerError(
      "SCHEMA_ERROR",
      `No AX node matches role="${role}" name="${name}" for click step.`,
    );
  }
  const center = await getCenterForNode(tabId, node);
  await dispatchClickAt(tabId, center);
}

export async function execInput(
  tabId: number,
  step: InputStep,
  args: ToolArgs,
): Promise<void> {
  const role = substitute(step.role, args);
  const name = substitute(step.name, args);
  const value = substitute(step.value, args);
  const nodes = await fetchAxTree(tabId);
  const node = findFirstByRoleAndName(nodes, role, name);
  if (!node) {
    throw new HandlerError(
      "SCHEMA_ERROR",
      `No AX node matches role="${role}" name="${name}" for input step.`,
    );
  }
  // Click to focus, then insert text. insertText preserves IME state, fires
  // composition events, and reaches React-controlled inputs reliably.
  const center = await getCenterForNode(tabId, node);
  await dispatchClickAt(tabId, center);
  await sendCommand(tabId, "Input.insertText", { text: value });
}

export async function execKey(
  tabId: number,
  step: KeyStep,
  _args: ToolArgs,
): Promise<void> {
  // Send keyDown + keyUp. For text-producing keys the caller should use an
  // Input step instead — Input.dispatchKeyEvent doesn't actually type chars
  // unless `text` is set, which gets fiddly. Keep this for control keys.
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: step.key,
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: step.key,
  });
}

export async function execExtractAxTree(
  tabId: number,
  step: ExtractAxTreeStep,
  _args: ToolArgs,
): Promise<AxNode> {
  const cdp = await sendCommand<CdpAxTreeResponse>(
    tabId,
    "Accessibility.getFullAXTree",
    {},
  );
  const buildOpts: { maxDepth?: number; rootRole?: string } = {};
  if (step.maxDepth !== undefined) buildOpts.maxDepth = step.maxDepth;
  if (step.rootRole !== undefined) buildOpts.rootRole = step.rootRole;
  return buildAxTree(cdp, buildOpts);
}

export async function execExtractText(
  tabId: number,
  step: ExtractTextStep,
  args: ToolArgs,
): Promise<string> {
  const role = substitute(step.role, args);
  const name = substitute(step.name, args);
  const nodes = await fetchAxTree(tabId);
  const node = findFirstByRoleAndName(nodes, role, name);
  if (!node) {
    throw new HandlerError(
      "SCHEMA_ERROR",
      `No AX node matches role="${role}" name="${name}" for extract_text step.`,
    );
  }
  return node.name?.value ?? "";
}
