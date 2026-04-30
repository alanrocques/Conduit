#!/usr/bin/env node
/**
 * Conduit Native Messaging Host (NMH) — M0 dumb-pipe entrypoint.
 *
 * Runtime topology:
 *
 *     MCP server  <--JSON over UNIX socket-->  NMH  <--Chrome native messaging-->  Extension
 *                       (this process)
 *
 * Behaviors:
 *   - Listens on `~/.conduit/socket` (mode 0600). Parent dir is created
 *     mode 0700 if missing.
 *   - Speaks Chrome's native messaging protocol on stdin/stdout
 *     (4-byte LE length prefix + UTF-8 JSON).
 *   - Routes messages between the two sides:
 *       - request from socket -> stdout (extension), tracking originating
 *         connId in a Map<RequestId, connId> so the response gets back to
 *         the right MCP-server connection.
 *       - response from extension -> the socket conn that sent the request,
 *         falling back to broadcast if the id is unknown.
 *       - event from extension -> broadcast to all sockets.
 *       - request from extension (unusual in M0) -> broadcast to all sockets.
 *   - Diagnostics go exclusively to stderr; stdout is reserved for the
 *     Chrome native messaging frame stream.
 *   - Exits cleanly on SIGINT, SIGTERM, or stdin EOF, unlinking the socket.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SOCKET_PATH_DEFAULT,
  type Envelope,
  type RequestId,
} from "@conduit/protocol";

import { createNativeMessagingChannel } from "./native-messaging.js";
import { createSocketServer, type SocketConn } from "./socket-server.js";
import { log } from "./log.js";

function resolveSocketPath(): string {
  // Honor an env override for testing / non-default deployments, otherwise
  // use the protocol-shared default rooted in $HOME.
  const override = process.env["CONDUIT_SOCKET_PATH"];
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), SOCKET_PATH_DEFAULT);
}

function isEnvelope(v: unknown): v is Envelope {
  if (typeof v !== "object" || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return k === "request" || k === "response" || k === "event";
}

async function main(): Promise<void> {
  const socketPath = resolveSocketPath();
  const socketDir = path.dirname(socketPath);

  // Ensure parent dir exists with tight permissions before opening the socket.
  await fs.mkdir(socketDir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(socketDir, 0o700);
  } catch (err) {
    log.warn(`failed to chmod 0700 on ${socketDir}`, err);
  }

  const sockServer = createSocketServer(socketPath);
  const nm = createNativeMessagingChannel(process.stdin, process.stdout);

  // Track which socket connection originated each in-flight request id, so
  // responses from the extension are returned to that exact connection.
  const inflight = new Map<RequestId, SocketConn>();

  sockServer.onMessage((msg, conn) => {
    if (!isEnvelope(msg)) {
      log.warn(`dropping non-envelope from socket conn ${conn.connId}`, msg);
      return;
    }
    if (msg.kind === "request") {
      inflight.set(msg.id, conn);
    }
    nm.send(msg);
  });

  sockServer.onConnectionClose((conn) => {
    // Drop any in-flight ids that belonged to this connection so we don't
    // hold a dangling reference. Pending responses for them will be dropped
    // (or broadcast) when they arrive.
    for (const [id, c] of inflight) {
      if (c.connId === conn.connId) inflight.delete(id);
    }
  });

  nm.onMessage((msg) => {
    if (!isEnvelope(msg)) {
      log.warn("dropping non-envelope from extension", msg);
      return;
    }
    switch (msg.kind) {
      case "response": {
        const conn = inflight.get(msg.id);
        if (conn) {
          inflight.delete(msg.id);
          conn.send(msg);
        } else {
          log.warn(
            `response with unknown id ${msg.id}; broadcasting to all sockets`,
          );
          sockServer.broadcast(msg);
        }
        return;
      }
      case "event": {
        sockServer.broadcast(msg);
        return;
      }
      case "request": {
        // M0 doesn't define extension-initiated requests, but be permissive.
        log.warn(
          `extension-initiated request id=${msg.id} method=${msg.method}; broadcasting`,
        );
        sockServer.broadcast(msg);
        return;
      }
    }
  });

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`shutting down: ${reason}`);
    try {
      nm.close();
    } catch (err) {
      log.warn("error while closing native messaging channel", err);
    }
    try {
      await sockServer.close();
    } catch (err) {
      log.warn("error while closing socket server", err);
    }
    // Give logs a tick to flush, then exit.
    process.nextTick(() => process.exit(0));
  };

  nm.onClose(() => {
    void shutdown("stdin EOF / native channel closed");
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", err);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", reason);
  });

  await sockServer.listen();
  log.info(
    `conduit-nmh ready (pid=${process.pid}, socket=${socketPath}, node=${process.version})`,
  );
}

main().catch((err) => {
  log.error("fatal startup error", err);
  process.exit(1);
});
