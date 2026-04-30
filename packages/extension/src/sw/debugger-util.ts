/**
 * Promisified wrappers around `chrome.debugger.*` plus shared helpers used by
 * AX-tree handlers. CDP commands return arbitrary JSON; we keep types loose
 * here and tighten where used.
 */

export interface DebuggeeId {
  tabId: number;
}

/** Track tabs we've already attached to so we don't double-attach. */
const attachedTabs = new Set<number>();

export async function attachIfNeeded(tabId: number, version = "1.3"): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({ tabId }, version, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        // "Another debugger is already attached" or our own previous attach
        // — treat as success if the message indicates already-attached.
        const msg = err.message ?? "";
        if (/already attached/i.test(msg)) {
          attachedTabs.add(tabId);
          resolve();
          return;
        }
        reject(new Error(msg || "debugger.attach failed"));
        return;
      }
      attachedTabs.add(tabId);
      resolve();
    });
  });
}

export function sendCommand<TResult = unknown>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message ?? `${method} failed`));
        return;
      }
      resolve(result as TResult);
    });
  });
}

// Detach listener: clear our attached set so we can re-attach later.
chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (typeof tabId === "number") {
    attachedTabs.delete(tabId);
  }
});
