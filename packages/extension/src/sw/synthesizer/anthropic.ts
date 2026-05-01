/**
 * Minimal Anthropic /v1/messages client for the SW.
 *
 * Why raw fetch and not the SDK:
 *  - The SDK pulls in node-only deps (ReadableStream polyfills, Buffer, etc.)
 *    that bloat the SW bundle and have caused MV3 startup issues in the past.
 *  - We only need /v1/messages and just two niceties (caching headers + a
 *    retry wrapper). Both are 30 lines each.
 *
 * Browser-origin requests require `anthropic-dangerous-direct-browser-access`.
 * The "danger" is exposing the user's API key to client code — fine for BYOK
 * by design.
 */

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;

export interface AnthropicError extends Error {
  status?: number;
  type?: string;
}

function makeError(status: number, body: unknown): AnthropicError {
  const inner =
    typeof body === "object" && body !== null
      ? (body as { error?: { type?: string; message?: string } })
      : {};
  const err = new Error(
    inner.error?.message ?? `Anthropic API ${status}`,
  ) as AnthropicError;
  err.status = status;
  if (inner.error?.type) err.type = inner.error.type;
  return err;
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: unknown;
  output_config?: unknown;
  tools?: unknown;
}

export interface MessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  model: string;
  stop_reason:
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "refusal"
    | "pause_turn";
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function callMessages(
  apiKey: string,
  body: MessagesRequest,
): Promise<MessagesResponse> {
  let lastErr: AnthropicError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return (await res.json()) as MessagesResponse;
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = { error: { message: await res.text() } };
    }
    lastErr = makeError(res.status, parsed);

    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
      throw lastErr;
    }
    // Exponential backoff: 1s, 2s, 4s. Honor server's Retry-After if present.
    const headerDelay = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(headerDelay) && headerDelay > 0
      ? headerDelay * 1000
      : 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw lastErr ?? new Error("unreachable");
}
