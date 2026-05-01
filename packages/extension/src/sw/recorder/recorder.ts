/**
 * SW-side recorder state machine.
 *
 * Lifecycle:
 *   1. start(tabId)
 *      - injects the content script via chrome.scripting.executeScript
 *      - attaches CDP, takes the initial AX-tree snapshot
 *      - creates an in-memory recording buffer
 *   2. handleEvent(event)  (called from chrome.runtime.onMessage)
 *      - takes an AX-tree snapshot
 *      - appends a TraceStep to the buffer
 *   3. stop()
 *      - finalizes a TraceRecord, persists it via chrome.storage.local
 *      - returns the record (popup uses the summary)
 *
 * Single-active-recording invariant: only one tab can be recording at a
 * time. start() while already recording rejects. (M1 only — multi-tab
 * recording is a "no" until we have UI to disambiguate which one to stop.)
 *
 * Storage shape: chrome.storage.local["conduit:traces"] = TraceRecord[]
 * Newest first. We cap at 50 to avoid unbounded growth — older traces are
 * trimmed on save.
 */

import type { AxNode } from "@conduit/protocol";

import { attachIfNeeded, sendCommand } from "../debugger-util.js";
import { buildAxTree, type CdpAxTreeResponse } from "../ax-tree.js";
import type {
  RecordedEvent,
  RecordingState,
  TraceRecord,
  TraceStep,
} from "./types.js";

const STORAGE_KEY = "conduit:traces";
const MAX_TRACES = 50;
const AX_SNAPSHOT_MAX_DEPTH = 8;

interface ActiveRecording {
  tabId: number;
  startUrl: string;
  startedAt: number;
  startedAtMonotonic: number;
  initialAxTree: AxNode;
  steps: TraceStep[];
}

let active: ActiveRecording | null = null;

async function snapshotAxTree(tabId: number): Promise<AxNode> {
  const cdp = await sendCommand<CdpAxTreeResponse>(
    tabId,
    "Accessibility.getFullAXTree",
    {},
  );
  return buildAxTree(cdp, { maxDepth: AX_SNAPSHOT_MAX_DEPTH });
}

function uuid(): string {
  return crypto.randomUUID();
}

function deriveTraceName(startUrl: string): string {
  try {
    const u = new URL(startUrl);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname}${path}`;
  } catch {
    return startUrl.slice(0, 60);
  }
}

export function getRecordingState(): RecordingState {
  if (!active) return { status: "idle" };
  return {
    status: "recording",
    tabId: active.tabId,
    startUrl: active.startUrl,
    startedAt: active.startedAt,
    eventCount: active.steps.length,
  };
}

export async function start(tabId: number): Promise<void> {
  if (active) {
    throw new Error(
      `Already recording on tab ${active.tabId}. Stop that recording first.`,
    );
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    throw new Error(`Tab ${tabId} has no URL; cannot record.`);
  }

  await attachIfNeeded(tabId);
  await sendCommand(tabId, "DOM.enable");
  await sendCommand(tabId, "Accessibility.enable");

  // Inject the content script. It self-guards against double-injection.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ["content-script-recorder.js"],
  });

  const initialAxTree = await snapshotAxTree(tabId);
  const now = Date.now();

  active = {
    tabId,
    startUrl: tab.url,
    startedAt: now,
    startedAtMonotonic: performance.now(),
    initialAxTree,
    steps: [],
  };
}

/**
 * Called from chrome.runtime.onMessage when the content script reports an
 * event. Idempotent: silently drops events for non-active tabs (the SW may
 * have stopped recording while the page was queueing events).
 */
export async function handleEvent(
  event: RecordedEvent,
  senderTabId: number | undefined,
): Promise<void> {
  if (!active) return;
  if (senderTabId !== undefined && senderTabId !== active.tabId) return;

  // Snapshot AFTER the event so the model sees post-action state.
  // If the snapshot fails (debugger detached, tab closed), stop the recording.
  let axTreeAfter: AxNode;
  try {
    axTreeAfter = await snapshotAxTree(active.tabId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[conduit/recorder] AX snapshot failed; ending recording", err);
    await stop().catch(() => {
      /* swallow */
    });
    return;
  }

  active.steps.push({ event, axTreeAfter });
}

export async function stop(): Promise<TraceRecord | null> {
  if (!active) return null;
  const a = active;
  active = null;

  const tab = await chrome.tabs.get(a.tabId).catch(() => null);
  const endUrl = tab?.url ?? a.startUrl;
  const endedAt = Date.now();

  const record: TraceRecord = {
    id: uuid(),
    name: deriveTraceName(a.startUrl),
    startUrl: a.startUrl,
    endUrl,
    startedAt: a.startedAt,
    endedAt,
    initialAxTree: a.initialAxTree,
    steps: a.steps,
  };

  await persistTrace(record);
  return record;
}

async function persistTrace(record: TraceRecord): Promise<void> {
  const store = await chrome.storage.local.get(STORAGE_KEY);
  const prior = (store[STORAGE_KEY] as TraceRecord[] | undefined) ?? [];
  const next = [record, ...prior].slice(0, MAX_TRACES);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export async function listTraces(): Promise<readonly TraceRecord[]> {
  const store = await chrome.storage.local.get(STORAGE_KEY);
  return (store[STORAGE_KEY] as TraceRecord[] | undefined) ?? [];
}

export async function deleteTrace(id: string): Promise<void> {
  const store = await chrome.storage.local.get(STORAGE_KEY);
  const prior = (store[STORAGE_KEY] as TraceRecord[] | undefined) ?? [];
  const next = prior.filter((t) => t.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
