/**
 * Conduit MV3 service worker entry point.
 *
 * Responsibilities:
 *   - Open a long-lived native messaging port to the NMH (`com.conduit.bridge`).
 *   - Route incoming RequestEnvelopes to per-method handlers.
 *   - Send back matching ResponseEnvelopes via the same port.
 *   - Mirror connection state into chrome.storage.session so the popup can read
 *     it without holding a port of its own.
 *   - Respond to popup's runtime.sendMessage("conduit/popup-test-hello") for
 *     the "Test hello_world" button.
 *
 * MV3 SWs can be terminated when idle. We don't bother with a heartbeat in M0;
 * any incoming wakeUp event re-runs this top-level code which reconnects.
 */

import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@conduit/protocol";

import { connectNmh } from "./nmh-port.js";
import { HandlerError } from "./errors.js";
import { helloWorld } from "./handlers/hello-world.js";
import { extractAxTree } from "./handlers/extract-ax-tree.js";
import { clickByRoleName } from "./handlers/click-by-role-name.js";
import { runProfileToolHandler } from "./handlers/run-profile-tool.js";

interface ConnectionState {
  connected: boolean;
  reason?: string;
  updatedAt: number;
}

const SESSION_KEY = "conduit:nmh-state";

async function setConnectionState(state: ConnectionState): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: state });
  } catch (err) {
    // session storage may not be available very early on cold start; ignore.
    // eslint-disable-next-line no-console
    console.warn("[conduit] failed to write session state", err);
  }
}

function makeErrorResponse(
  id: string,
  code: ErrorCode,
  message: string,
): ResponseEnvelope {
  return {
    kind: "response",
    id,
    protocol: PROTOCOL_VERSION,
    ok: false,
    error: { code, message },
  };
}

function makeOkResponse<T>(id: string, result: T): ResponseEnvelope<T> {
  return {
    kind: "response",
    id,
    protocol: PROTOCOL_VERSION,
    ok: true,
    result,
  };
}

/**
 * Dispatch a request to a handler by method name. Wraps every handler call in
 * try/catch so that exceptions surface as INTERNAL_ERROR responses by default,
 * unless the handler threw a HandlerError with a more specific ErrorCode.
 */
export async function dispatch(
  req: RequestEnvelope,
): Promise<ResponseEnvelope> {
  try {
    switch (req.method) {
      case "hello_world": {
        const result = await helloWorld(
          (req.payload ?? {}) as Parameters<typeof helloWorld>[0],
        );
        return makeOkResponse(req.id, result);
      }
      case "extract_ax_tree": {
        const result = await extractAxTree(
          req.payload as Parameters<typeof extractAxTree>[0],
        );
        return makeOkResponse(req.id, result);
      }
      case "click_by_role_name": {
        const result = await clickByRoleName(
          req.payload as Parameters<typeof clickByRoleName>[0],
        );
        return makeOkResponse(req.id, result);
      }
      case "run_profile_tool": {
        const result = await runProfileToolHandler(
          req.payload as Parameters<typeof runProfileToolHandler>[0],
        );
        return makeOkResponse(req.id, result);
      }
      default:
        return makeErrorResponse(
          req.id,
          "INVALID_REQUEST",
          `Unknown method: ${req.method}`,
        );
    }
  } catch (err) {
    if (err instanceof HandlerError) {
      return makeErrorResponse(req.id, err.code, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return makeErrorResponse(req.id, "INTERNAL_ERROR", message);
  }
}

// --- Boot ---------------------------------------------------------------

const conn = connectNmh(
  async (req) => {
    const res = await dispatch(req);
    conn.send(res);
  },
  (connected, reason) => {
    const state: ConnectionState = {
      connected,
      updatedAt: Date.now(),
    };
    if (reason !== undefined) state.reason = reason;
    void setConnectionState(state);
  },
);

// --- Popup bridge -------------------------------------------------------
//
// The popup sends a runtime message to call `hello_world` directly through
// the in-SW handler (no NMH round-trip required). This lets the user verify
// the extension is alive even when the NMH isn't installed yet.

interface PopupTestHelloMsg {
  kind: "conduit/popup-test-hello";
  name?: string;
}

interface PopupGetStateMsg {
  kind: "conduit/popup-get-state";
}

type PopupMsg = PopupTestHelloMsg | PopupGetStateMsg;

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const m = msg as PopupMsg;
  if (!m || typeof m !== "object" || !("kind" in m)) {
    return false;
  }

  if (m.kind === "conduit/popup-test-hello") {
    helloWorld({ name: m.name ?? "popup" })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: message });
      });
    return true; // async response
  }

  if (m.kind === "conduit/popup-get-state") {
    chrome.storage.session
      .get(SESSION_KEY)
      .then((store) => {
        const state = (store[SESSION_KEY] as ConnectionState | undefined) ?? {
          connected: conn.isConnected(),
          updatedAt: Date.now(),
        };
        sendResponse({ ok: true, state });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: message });
      });
    return true;
  }

  return false;
});
