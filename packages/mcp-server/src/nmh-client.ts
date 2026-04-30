/**
 * UNIX socket client to the Conduit Native Messaging Host.
 *
 * Wire format: newline-delimited JSON. One Envelope per line.
 *
 * Responsibilities:
 *  - Connect to the NMH socket (path resolved from $HOME/.conduit/socket).
 *  - Frame outgoing requests, parse incoming responses, and route them back
 *    to the awaiting promise via a request-id map.
 *  - Auto-reconnect with exponential backoff (cap 5s) when the socket drops.
 *  - Surface EXTENSION_NOT_RUNNING when callers try to send while we're not
 *    connected (the NMH is launched by the browser extension; if the socket
 *    is missing, the extension isn't running).
 */

import { Socket, connect as netConnect } from "node:net";
import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type ErrorPayload,
  type Method,
  type MethodMap,
  type RequestEnvelope,
  type RequestId,
  type ResponseEnvelope,
} from "@conduit/protocol";
import { log } from "./log.js";

export class NmhError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "NmhError";
    this.code = code;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: Method;
}

const RECONNECT_INITIAL_MS = 200;
const RECONNECT_MAX_MS = 5000;

export interface NmhClientOptions {
  socketPath: string;
}

export class NmhClient {
  private socket: Socket | null = null;
  private connecting = false;
  private connected = false;
  private buffer = "";
  private pending = new Map<RequestId, PendingRequest>();
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shutdown = false;

  constructor(private readonly opts: NmhClientOptions) {}

  /**
   * Begin connecting to the NMH socket. Resolves on first successful connect.
   * Subsequent reconnect attempts run in the background and are not awaited.
   */
  connect(): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const onConnected = (): void => {
        if (resolved) return;
        resolved = true;
        this.off("connect", onConnected);
        resolve();
      };
      this.on("connect", onConnected);
      this.tryConnect();
      // We don't reject here — first-connect failures are converted into
      // background reconnect attempts so the MCP server stays up. Callers
      // that need to know the live status should check `isConnected()`.
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async request<M extends Method>(
    method: M,
    payload: MethodMap[M]["req"],
    timeoutMs = 30_000,
  ): Promise<MethodMap[M]["res"]> {
    if (!this.connected || !this.socket) {
      throw new NmhError(
        "EXTENSION_NOT_RUNNING",
        "Conduit could not reach the browser extension. Make sure the Conduit extension is installed and unlocked in your browser, then retry.",
      );
    }

    const id: RequestId = randomUUID();
    const envelope: RequestEnvelope<MethodMap[M]["req"]> = {
      kind: "request",
      id,
      protocol: PROTOCOL_VERSION,
      method,
      payload,
    };

    const line = JSON.stringify(envelope) + "\n";

    return new Promise<MethodMap[M]["res"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new NmhError(
            "TIMEOUT",
            `Conduit request '${method}' timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.socket!.write(line, (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
          }
          reject(
            new NmhError(
              "EXTENSION_NOT_RUNNING",
              `Failed to write to Conduit native host socket: ${err.message}`,
            ),
          );
        }
      });
    });
  }

  close(): void {
    this.shutdown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.connected = false;
    // Reject any in-flight requests.
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(
        new NmhError(
          "EXTENSION_NOT_RUNNING",
          "Conduit MCP server is shutting down.",
        ),
      );
      this.pending.delete(id);
    }
  }

  // --- internals ----------------------------------------------------------

  private listeners = new Map<string, Set<() => void>>();

  private on(event: "connect", cb: () => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  private off(event: "connect", cb: () => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: "connect"): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb();
      } catch (err) {
        log.warn("listener threw", { event, err: String(err) });
      }
    }
  }

  private tryConnect(): void {
    if (this.shutdown || this.connecting || this.connected) return;
    this.connecting = true;

    log.info("connecting to NMH socket", { path: this.opts.socketPath });

    const sock = netConnect(this.opts.socketPath);
    this.socket = sock;

    sock.on("connect", () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.buffer = "";
      log.info("NMH socket connected");
      this.emit("connect");
    });

    sock.on("data", (chunk: Buffer) => {
      this.onData(chunk);
    });

    sock.on("error", (err: Error & { code?: string }) => {
      log.warn("NMH socket error", { code: err.code, message: err.message });
    });

    sock.on("close", () => {
      const wasConnected = this.connected;
      this.connecting = false;
      this.connected = false;
      this.socket = null;
      this.buffer = "";

      // Fail in-flight requests so callers get a prompt error.
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(
          new NmhError(
            "EXTENSION_NOT_RUNNING",
            "Conduit native host socket closed before responding.",
          ),
        );
        this.pending.delete(id);
      }

      if (this.shutdown) return;

      if (wasConnected) {
        log.warn("NMH socket closed, will reconnect");
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.shutdown) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    log.info("scheduling NMH reconnect", { delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.tryConnect();
    }, delay);
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log.warn("dropped malformed NMH line", { err: String(err) });
      return;
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { kind?: unknown }).kind !== "response"
    ) {
      // M0 only supports responses on this hop. Drop other envelopes.
      return;
    }

    const env = parsed as ResponseEnvelope;
    const pending = this.pending.get(env.id);
    if (!pending) {
      log.warn("response for unknown request id", { id: env.id });
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(env.id);

    if (env.ok) {
      pending.resolve(env.result);
    } else {
      const errPayload: ErrorPayload = env.error ?? {
        code: "INTERNAL_ERROR",
        message: "NMH returned ok=false with no error payload.",
      };
      pending.reject(new NmhError(errPayload.code, errPayload.message));
    }
  }
}
