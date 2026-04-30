/**
 * Chrome native messaging stdio framing.
 *
 * Wire format (both directions):
 *   [4-byte little-endian uint32 length] [UTF-8 JSON payload]
 *
 * Constraints (per Chrome docs):
 *   - Max single message size: 1 MB (1024 * 1024 bytes) in either direction.
 *   - stdin closes when Chrome wants the host to exit.
 *
 * The reader is stream-safe: stdin may deliver a single message across many
 * `data` events, or many messages in one event, so we maintain an internal
 * buffer and only emit complete messages.
 */

import type { Readable, Writable } from "node:stream";

import { log } from "./log.js";

export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024; // 1 MB, Chrome's limit.

export interface NativeMessagingChannel {
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  send(obj: unknown): void;
  close(): void;
}

export function createNativeMessagingChannel(
  stdin: Readable,
  stdout: Writable,
): NativeMessagingChannel {
  let messageHandler: ((msg: unknown) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let closed = false;

  // Accumulator for partial reads.
  let buffer: Buffer = Buffer.alloc(0);

  const drainBuffer = (): void => {
    while (true) {
      if (buffer.length < 4) return;
      const len = buffer.readUInt32LE(0);
      if (len > MAX_NATIVE_MESSAGE_BYTES) {
        log.error(
          `inbound native message exceeds ${MAX_NATIVE_MESSAGE_BYTES} bytes (got ${len}); aborting channel`,
        );
        // Drop everything; this is unrecoverable — Chrome would not send this.
        buffer = Buffer.alloc(0);
        close();
        return;
      }
      if (buffer.length < 4 + len) return; // wait for the rest
      const payload = buffer.subarray(4, 4 + len);
      buffer = buffer.subarray(4 + len);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.toString("utf8"));
      } catch (err) {
        log.error("failed to parse native messaging payload as JSON", err);
        continue;
      }
      if (messageHandler) {
        try {
          messageHandler(parsed);
        } catch (err) {
          log.error("native messaging onMessage handler threw", err);
        }
      }
    }
  };

  const onData = (chunk: Buffer): void => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    drainBuffer();
  };

  const onEnd = (): void => {
    log.info("native messaging stdin ended (Chrome closed the host)");
    close();
  };

  const onError = (err: unknown): void => {
    log.error("native messaging stdin error", err);
    close();
  };

  stdin.on("data", onData);
  stdin.on("end", onEnd);
  stdin.on("error", onError);

  function send(obj: unknown): void {
    if (closed) {
      log.warn("attempted to send on closed native messaging channel");
      return;
    }
    let json: string;
    try {
      json = JSON.stringify(obj);
    } catch (err) {
      log.error("failed to JSON.stringify outbound native message", err);
      return;
    }
    const payload = Buffer.from(json, "utf8");
    if (payload.length > MAX_NATIVE_MESSAGE_BYTES) {
      const msg = `outbound native message exceeds ${MAX_NATIVE_MESSAGE_BYTES} bytes (got ${payload.length}); refusing to send`;
      log.error(msg);
      throw new Error(msg);
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    // Use cork/uncork so the header and payload land in one write where possible.
    stdout.cork();
    stdout.write(header);
    stdout.write(payload);
    process.nextTick(() => stdout.uncork());
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stdin.off("data", onData);
    stdin.off("end", onEnd);
    stdin.off("error", onError);
    if (closeHandler) {
      try {
        closeHandler();
      } catch (err) {
        log.error("native messaging onClose handler threw", err);
      }
    }
  }

  return {
    onMessage(cb) {
      messageHandler = cb;
    },
    onClose(cb) {
      closeHandler = cb;
    },
    send,
    close,
  };
}
