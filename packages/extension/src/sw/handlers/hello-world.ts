/**
 * `hello_world` handler — sanity check for the wire end-to-end.
 */

import type {
  HelloWorldRequest,
  HelloWorldResponse,
} from "@conduit/protocol";

export async function helloWorld(
  req: HelloWorldRequest,
): Promise<HelloWorldResponse> {
  return {
    greeting: `Hello, ${req.name ?? "world"} from Conduit extension`,
    from: "extension",
    receivedAt: Date.now(),
  };
}
