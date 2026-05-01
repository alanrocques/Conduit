/**
 * Trace -> ToolDefinition synthesizer.
 *
 * Loads a stored TraceRecord, builds the prompt, calls Anthropic with
 * structured outputs, returns the parsed ToolDefinition.
 *
 * The system prompt + JSON schema are byte-stable across calls (see
 * prompt.ts) so the prompt cache reads on every invocation after the first.
 * The trace itself is the volatile suffix in the user message.
 */

import type { ToolDefinition } from "@conduit/protocol";

import { getApiKey } from "../settings.js";
import { listTraces } from "../recorder/recorder.js";
import type { TraceRecord } from "../recorder/types.js";
import { callMessages, type AnthropicError } from "./anthropic.js";
import {
  SYNTHESIZER_SYSTEM_PROMPT,
  TOOL_DEFINITION_SCHEMA,
} from "./prompt.js";

const MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 4096;

export interface SynthesizeResult {
  tool: ToolDefinition;
  /** Tokens billed at full rate. */
  inputTokens: number;
  /** Tokens written to cache (~1.25x rate). */
  cacheCreationTokens: number;
  /** Tokens read from cache (~0.1x rate). */
  cacheReadTokens: number;
  outputTokens: number;
  model: string;
}

export class SynthesizerError extends Error {
  readonly code:
    | "NO_API_KEY"
    | "TRACE_NOT_FOUND"
    | "API_ERROR"
    | "PARSE_ERROR";
  constructor(code: SynthesizerError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function buildUserMessage(trace: TraceRecord): string {
  // Compact JSON keeps token usage down; the schema is what carries shape,
  // not whitespace.
  return JSON.stringify({
    startUrl: trace.startUrl,
    endUrl: trace.endUrl,
    initialAxTree: trace.initialAxTree,
    events: trace.steps.map((s) => s.event),
  });
}

export async function synthesizeFromTrace(
  traceId: string,
): Promise<SynthesizeResult> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new SynthesizerError(
      "NO_API_KEY",
      "Anthropic API key not set. Open Conduit options and add your key.",
    );
  }

  const traces = await listTraces();
  const trace = traces.find((t) => t.id === traceId);
  if (!trace) {
    throw new SynthesizerError(
      "TRACE_NOT_FOUND",
      `No saved trace with id ${traceId}.`,
    );
  }

  let res;
  try {
    res = await callMessages(apiKey, {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        {
          type: "text",
          text: SYNTHESIZER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: TOOL_DEFINITION_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: buildUserMessage(trace),
        },
      ],
    });
  } catch (err) {
    const e = err as AnthropicError;
    throw new SynthesizerError(
      "API_ERROR",
      `Anthropic API call failed${e.status ? ` (${e.status})` : ""}: ${e.message}`,
    );
  }

  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new SynthesizerError(
      "PARSE_ERROR",
      `Model returned no text block (stop_reason=${res.stop_reason}).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new SynthesizerError(
      "PARSE_ERROR",
      `Model output was not valid JSON: ${(err as Error).message}`,
    );
  }

  // Structured outputs guarantee schema match, but defend against the model
  // returning something the runtime can't actually execute.
  const tool = parsed as ToolDefinition;
  if (
    typeof tool.name !== "string" ||
    typeof tool.description !== "string" ||
    typeof tool.mutates !== "boolean" ||
    !Array.isArray(tool.executionPlan)
  ) {
    throw new SynthesizerError(
      "PARSE_ERROR",
      "Synthesized output is missing required ToolDefinition fields.",
    );
  }

  return {
    tool,
    inputTokens: res.usage.input_tokens,
    cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    outputTokens: res.usage.output_tokens,
    model: res.model,
  };
}
