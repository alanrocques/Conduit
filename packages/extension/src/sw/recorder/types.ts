/**
 * Recorder types — extension-internal for now. When the synthesizer (W3.T3)
 * lands, the LLM-facing wire shape will live in `@conduit/protocol`; what's
 * here is the raw capture format that buffers everything we might want for
 * synthesis (full AX trees, event coords, target hints).
 *
 * We deliberately keep events flat and self-describing so a recorded trace
 * can be replayed offline without the originating browser session.
 */

import type { AxNode } from "@conduit/protocol";

/**
 * Description of an event target as seen from the page. The recorder
 * gathers everything cheap enough to capture in the page; the SW joins
 * it with an AX-tree snapshot taken right after the event.
 */
export interface RecordedTarget {
  tagName: string;
  id?: string;
  classList?: readonly string[];
  /** ARIA role attribute or implicit role we could compute in-page. */
  role?: string;
  /** Accessible name we could compute in-page (aria-label, label, text). */
  ariaLabel?: string;
  /** First ~80 chars of textContent. */
  text?: string;
  /** name attribute of form fields. */
  name?: string;
  /** type attribute of inputs. */
  inputType?: string;
}

interface RecordedEventBase {
  /** Monotonic ms since recording start. */
  t: number;
}

export interface RecordedClickEvent extends RecordedEventBase {
  type: "click";
  target: RecordedTarget;
  /** Viewport-coord click point (CSS px). */
  x: number;
  y: number;
}

export interface RecordedInputEvent extends RecordedEventBase {
  type: "input";
  target: RecordedTarget;
  /** Final value at the time of the event. Sensitive types are redacted. */
  value: string;
}

export interface RecordedKeydownEvent extends RecordedEventBase {
  type: "keydown";
  /** key value, e.g. "Enter", "Escape", "a" */
  key: string;
  target: RecordedTarget;
}

export interface RecordedSubmitEvent extends RecordedEventBase {
  type: "submit";
  target: RecordedTarget;
}

export interface RecordedNavigationEvent extends RecordedEventBase {
  type: "navigation";
  url: string;
}

export type RecordedEvent =
  | RecordedClickEvent
  | RecordedInputEvent
  | RecordedKeydownEvent
  | RecordedSubmitEvent
  | RecordedNavigationEvent;

/**
 * One step in the trace pairs an event with a snapshot of the AX tree
 * captured immediately after it. The "before" tree is the previous step's
 * "after" tree (or the initial snapshot at index 0).
 */
export interface TraceStep {
  event: RecordedEvent;
  /** Trimmed AX tree (bounded depth) captured right after the event. */
  axTreeAfter: AxNode;
}

export interface TraceRecord {
  /** uuid */
  id: string;
  /** Best-effort label derived from the starting URL's path. User-renamable later. */
  name: string;
  /** URL when recording started. */
  startUrl: string;
  /** URL when recording stopped (may differ from startUrl after navigations). */
  endUrl: string;
  /** Wall-clock start time. */
  startedAt: number;
  /** Wall-clock end time. */
  endedAt: number;
  /** AX tree captured at recording start, before any user action. */
  initialAxTree: AxNode;
  steps: readonly TraceStep[];
}

export interface RecordingStateActive {
  status: "recording";
  tabId: number;
  startUrl: string;
  startedAt: number;
  eventCount: number;
}

export interface RecordingStateIdle {
  status: "idle";
}

export type RecordingState = RecordingStateActive | RecordingStateIdle;
