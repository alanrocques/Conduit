/**
 * Stderr-only logger for the Conduit MCP server.
 *
 * The MCP stdio transport owns this process's stdout — anything written there
 * that isn't a JSON-RPC frame will corrupt the wire and disconnect the client.
 * All diagnostics MUST go to stderr instead.
 */

type Level = "info" | "warn" | "error";

function format(level: Level, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [conduit-mcp] [${level}] ${msg}`;
  if (meta === undefined) return base;
  let metaStr: string;
  try {
    metaStr = typeof meta === "string" ? meta : JSON.stringify(meta);
  } catch {
    metaStr = String(meta);
  }
  return `${base} ${metaStr}`;
}

function write(line: string): void {
  // Always stderr. Never stdout.
  process.stderr.write(line + "\n");
}

export const log = {
  info(msg: string, meta?: unknown): void {
    write(format("info", msg, meta));
  },
  warn(msg: string, meta?: unknown): void {
    write(format("warn", msg, meta));
  },
  error(msg: string, meta?: unknown): void {
    write(format("error", msg, meta));
  },
};
