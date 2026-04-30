/**
 * stderr-only logger.
 *
 * The NMH process speaks the Chrome native messaging protocol on stdout
 * (4-byte LE length prefix + UTF-8 JSON). Any non-framed bytes written to
 * stdout will desync the channel and crash the connection. All diagnostic
 * output therefore goes to stderr, which Chrome captures separately.
 */

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, args: unknown[]): void {
  const ts = new Date().toISOString();
  const prefix = `[conduit-nmh ${ts} ${level}]`;
  // Stringify everything ourselves so we don't depend on console behavior.
  const parts: string[] = [prefix];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.stack ?? `${a.name}: ${a.message}`);
    } else if (typeof a === "string") {
      parts.push(a);
    } else {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    }
  }
  process.stderr.write(parts.join(" ") + "\n");
}

export const log = {
  debug: (...args: unknown[]): void => emit("debug", args),
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
};
