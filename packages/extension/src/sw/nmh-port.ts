/**
 * Wraps `chrome.runtime.connectNative` with reconnect-on-disconnect logic and a
 * typed message API. The NMH host name is `com.conduit.bridge`.
 *
 * Reconnect uses exponential backoff capped at 5s. Each onMessage payload is an
 * Envelope; we only forward `request` envelopes to the consumer — responses are
 * sent via `port.postMessage` directly from handlers.
 */

import {
  NMH_HOST_NAME,
  type Envelope,
  type RequestEnvelope,
  type ResponseEnvelope,
  isRequest,
} from "@conduit/protocol";

export interface NmhConnection {
  /** Send a response envelope back through the active port. */
  send: (env: ResponseEnvelope) => void;
  /** True when there is an active port. */
  isConnected: () => boolean;
}

type OnRequest = (req: RequestEnvelope) => void | Promise<void>;
type OnConnectionStateChange = (connected: boolean, reason?: string) => void;

export function connectNmh(
  onRequest: OnRequest,
  onStateChange: OnConnectionStateChange,
): NmhConnection {
  let port: chrome.runtime.Port | null = null;
  let backoffMs = 250;
  const MAX_BACKOFF_MS = 5_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      port = chrome.runtime.connectNative(NMH_HOST_NAME);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      onStateChange(false, reason);
      scheduleReconnect();
      return;
    }

    onStateChange(true);
    backoffMs = 250;

    port.onMessage.addListener((msg: unknown) => {
      // Native messaging hands us a parsed JSON object.
      const env = msg as Envelope;
      if (env && typeof env === "object" && isRequest(env)) {
        Promise.resolve(onRequest(env)).catch((err) => {
          // Swallow handler errors here; handlers are expected to convert
          // exceptions into ResponseEnvelopes themselves.
          // eslint-disable-next-line no-console
          console.error("[conduit] onRequest dispatch failed", err);
        });
      }
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message;
      port = null;
      onStateChange(false, lastError);
      scheduleReconnect();
    });
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const send = (env: ResponseEnvelope): void => {
    if (!port) {
      // Drop the response if the port is gone — the caller (NMH) will time out.
      // eslint-disable-next-line no-console
      console.warn("[conduit] send dropped: no NMH port", env.id);
      return;
    }
    try {
      port.postMessage(env);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[conduit] postMessage failed", err);
    }
  };

  connect();

  return {
    send,
    isConnected: () => port !== null,
  };
}
