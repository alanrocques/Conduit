#!/usr/bin/env node
/**
 * Conduit MCP server entrypoint.
 *
 * Wires up:
 *  - StdioServerTransport (talks to the MCP client over stdin/stdout)
 *  - NmhClient (talks to the Conduit Native Messaging Host over a UNIX socket)
 *  - Tool handlers that bridge MCP tool calls into NMH requests
 *
 * Stdout is reserved for the MCP transport. All diagnostics go to stderr.
 */

import { homedir } from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SOCKET_PATH_DEFAULT } from "@conduit/protocol";
import { NmhClient } from "./nmh-client.js";
import { registerTools } from "./tools.js";
import { log } from "./log.js";

async function main(): Promise<void> {
  const socketPath =
    process.env["CONDUIT_SOCKET_PATH"] ??
    path.join(homedir(), SOCKET_PATH_DEFAULT);

  const nmh = new NmhClient({ socketPath });
  // Kick off connection attempts in the background. We don't await — if the
  // extension isn't running yet, individual tool calls will fail with
  // EXTENSION_NOT_RUNNING and the reconnect loop will pick it up later.
  void nmh.connect();

  const server = new Server(
    {
      name: "conduit",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerTools(server, nmh);

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    try {
      await server.close();
    } catch (err) {
      log.warn("error closing MCP server", { err: String(err) });
    }
    nmh.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  // Surface unhandled errors on stderr instead of stdout.
  process.on("uncaughtException", (err: Error) => {
    log.error("uncaughtException", {
      message: err.message,
      stack: err.stack,
    });
  });
  process.on("unhandledRejection", (reason: unknown) => {
    log.error("unhandledRejection", { reason: String(reason) });
  });

  await server.connect(transport);
  log.info("MCP server listening on stdio", { socketPath });
}

main().catch((err: unknown) => {
  log.error("fatal startup error", {
    err: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  process.exit(1);
});
