/**
 * UNIX socket server for the MCP server side of the bridge.
 *
 * Wire format: newline-delimited JSON. Each `\n`-terminated line is one
 * envelope. A line that fails to parse is logged and dropped.
 *
 * Connection identity: each accepted socket is assigned a numeric `connId`
 * exposed via the `SocketConn` handle, plus a `send()` to address replies.
 * The server itself does not interpret envelopes; the caller (index.ts) is
 * responsible for routing requests vs responses vs events using `connId`
 * and the request `id` field.
 */

import { createServer, type Server, type Socket } from "node:net";
import { promises as fs } from "node:fs";

import { log } from "./log.js";

export interface SocketConn {
  readonly connId: number;
  send(obj: unknown): void;
  close(): void;
}

export type SocketMessageHandler = (
  msg: unknown,
  conn: SocketConn,
) => void;

export type SocketCloseHandler = (conn: SocketConn) => void;

export interface SocketServer {
  listen(): Promise<void>;
  onMessage(cb: SocketMessageHandler): void;
  onConnectionClose(cb: SocketCloseHandler): void;
  broadcast(obj: unknown): void;
  close(): Promise<void>;
}

export function createSocketServer(socketPath: string): SocketServer {
  let messageHandler: SocketMessageHandler | null = null;
  let closeHandler: SocketCloseHandler | null = null;

  const conns = new Map<number, { socket: Socket; conn: SocketConn }>();
  let nextConnId = 1;
  let server: Server | null = null;
  let closed = false;

  function makeConn(socket: Socket, connId: number): SocketConn {
    return {
      connId,
      send(obj: unknown): void {
        if (socket.destroyed || !socket.writable) {
          log.warn(`send() on dead socket conn ${connId}; dropping message`);
          return;
        }
        let line: string;
        try {
          line = JSON.stringify(obj) + "\n";
        } catch (err) {
          log.error(
            `failed to JSON.stringify outbound socket message on conn ${connId}`,
            err,
          );
          return;
        }
        socket.write(line);
      },
      close(): void {
        socket.end();
      },
    };
  }

  function onSocket(socket: Socket): void {
    const connId = nextConnId++;
    const conn = makeConn(socket, connId);
    conns.set(connId, { socket, conn });
    log.info(`socket connection opened (conn ${connId})`);

    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // Split on newline; last element is the (possibly incomplete) tail.
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch (err) {
            log.error(
              `failed to parse JSON line from conn ${connId}: ${line.slice(0, 200)}`,
              err,
            );
            idx = buffer.indexOf("\n");
            continue;
          }
          if (messageHandler) {
            try {
              messageHandler(parsed, conn);
            } catch (err) {
              log.error(
                `socket onMessage handler threw on conn ${connId}`,
                err,
              );
            }
          }
        }
        idx = buffer.indexOf("\n");
      }
    });

    socket.on("error", (err) => {
      log.warn(`socket conn ${connId} error`, err);
    });

    socket.on("close", () => {
      conns.delete(connId);
      log.info(`socket connection closed (conn ${connId})`);
      if (closeHandler) {
        try {
          closeHandler(conn);
        } catch (err) {
          log.error(`socket onConnectionClose handler threw`, err);
        }
      }
    });
  }

  return {
    async listen(): Promise<void> {
      // Best-effort unlink of stale socket file. ENOENT is fine; anything else
      // is surfaced.
      try {
        await fs.unlink(socketPath);
        log.info(`removed stale socket at ${socketPath}`);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") {
          throw err;
        }
      }
      server = createServer(onSocket);
      await new Promise<void>((resolve, reject) => {
        const onError = (err: unknown): void => reject(err);
        server!.once("error", onError);
        server!.listen(socketPath, () => {
          server!.off("error", onError);
          resolve();
        });
      });
      // Tighten permissions on the socket: owner-only read/write.
      try {
        await fs.chmod(socketPath, 0o600);
      } catch (err) {
        log.warn(`failed to chmod 0600 on socket ${socketPath}`, err);
      }
      log.info(`socket server listening at ${socketPath}`);
    },

    onMessage(cb) {
      messageHandler = cb;
    },

    onConnectionClose(cb) {
      closeHandler = cb;
    },

    broadcast(obj: unknown): void {
      for (const { conn } of conns.values()) {
        conn.send(obj);
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const { socket } of conns.values()) {
        socket.destroy();
      }
      conns.clear();
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
        server = null;
      }
      try {
        await fs.unlink(socketPath);
      } catch {
        /* ignore */
      }
    },
  };
}
