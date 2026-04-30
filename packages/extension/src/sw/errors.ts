/**
 * Typed error class so handlers can short-circuit with a specific protocol
 * ErrorCode while still raising a normal exception. The dispatcher in
 * `src/sw/index.ts` converts these into ResponseEnvelope error payloads.
 */

import type { ErrorCode } from "@conduit/protocol";

export class HandlerError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "HandlerError";
  }
}
