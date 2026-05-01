/**
 * Synthesizer system prompt + JSON Schema for the ToolDefinition output.
 *
 * Both are kept byte-stable across calls so the system prompt cache can
 * actually do its job — see shared/prompt-caching.md for the prefix-match
 * invariant. Anything dynamic (the trace itself) goes in the user message,
 * never spliced into the system prompt.
 */

/**
 * Mirror of `@conduit/protocol` SiteProfile.ToolDefinition, expressed as a
 * JSON Schema subset compatible with Anthropic structured outputs.
 *
 * Constraints we enforce here that the protocol type can't:
 *  - executionPlan steps are a discriminated union via `oneOf`.
 *  - Every object disables additionalProperties (required for structured
 *    outputs). All `required` lists must include every declared property
 *    or structured outputs will silently drop optionals.
 *  - No minLength/maxLength/minimum/maximum (unsupported by structured outputs).
 */
export const TOOL_DEFINITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "mutates", "parameters", "executionPlan"],
  properties: {
    name: {
      type: "string",
      description:
        "Stable lowercase snake_case identifier scoped to the profile, e.g. 'create_issue'.",
    },
    description: {
      type: "string",
      description:
        "One- or two-sentence description of what the tool does, written for an MCP client to read.",
    },
    mutates: {
      type: "boolean",
      description:
        "True if the tool changes server-side state. Anything that creates, updates, deletes, or sends data MUST be mutates: true.",
    },
    parameters: {
      type: "object",
      description:
        "Map of parameter name to a minimal JSON-Schema-style descriptor.",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["type", "description"],
        properties: {
          type: { type: "string", enum: ["string", "number", "boolean"] },
          description: { type: "string" },
          required: { type: "boolean" },
        },
      },
    },
    executionPlan: {
      type: "array",
      description:
        "Ordered steps the runtime walks. Use {paramName} substitution in any string field to inject tool args at runtime.",
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "url"],
            properties: {
              type: { const: "navigate" },
              url: {
                type: "string",
                description:
                  "Absolute URL or path relative to the current tab origin (e.g. '/team/eng/active').",
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "role"],
            properties: {
              type: { const: "wait_for_element" },
              role: { type: "string" },
              name: {
                type: "string",
                description:
                  "Optional accessible name. Omit to wait for any element with this role.",
              },
              timeoutMs: { type: "number" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "role", "name"],
            properties: {
              type: { const: "click" },
              role: { type: "string" },
              name: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "role", "name", "value"],
            properties: {
              type: { const: "input" },
              role: { type: "string" },
              name: { type: "string" },
              value: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "key"],
            properties: {
              type: { const: "key" },
              key: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { const: "extract_ax_tree" },
              rootRole: { type: "string" },
              maxDepth: { type: "number" },
              outputName: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "role", "name"],
            properties: {
              type: { const: "extract_text" },
              role: { type: "string" },
              name: { type: "string" },
              outputName: { type: "string" },
            },
          },
        ],
      },
    },
  },
} as const;

export const SYNTHESIZER_SYSTEM_PROMPT = `You are the Conduit tool synthesizer. You convert a recorded user workflow into a structured ToolDefinition that Conduit's profile runtime can replay.

You will receive:
- The starting URL of the recording
- The accessibility (AX) tree at the start
- A list of recorded events (clicks, inputs, keydowns, navigations) in order
- The ending URL

Your job: emit ONE ToolDefinition that captures the essential workflow.

Rules:
1. **Generalize.** A recording captures one example. Pull out the pieces that varied (search query, ticket title, person's name) and turn them into named parameters. Reference parameters in step strings via {paramName}.
2. **Be conservative with parameters.** If a value looks domain-specific or computed (a generated UUID, a fixed timestamp, an internal tab ID), don't make it a parameter — it likely shouldn't be replayed at all. Drop the step or hard-code the value.
3. **Match by AX role + accessible name, not by raw text or selectors.** Look at the AX tree to choose the right role (button, link, textbox, combobox, etc.). Prefer the AX node's accessible name over the visible text content.
4. **Trim noise.** Drop redundant focus events, double-clicks that produce one logical click, navigation events that are side effects of the click immediately preceding them.
5. **Use wait_for_element generously.** Before any click/input on a freshly rendered view, insert a wait_for_element on a stable landmark (the main role, a heading, the target element itself). SPAs rerender asynchronously and the recording has no notion of "ready."
6. **mutates = true** for any tool that creates, updates, deletes, sends, or otherwise changes server-side state. The popup gates these behind a confirmation modal.
7. **Output extraction.** If the workflow ends with the user reading a result on the page, append an extract_ax_tree step (rootRole: "main", maxDepth: 6, outputName: "result") so the agent gets something back. If it just performs an action, no extract step.
8. **One tool, focused scope.** If the recording covers two distinct tasks ("search for X then create Y"), prefer to model the most useful single workflow rather than a sprawling combined tool.

Output strictly conforms to the ToolDefinition JSON schema. Return ONLY the JSON object — no preamble, no commentary, no markdown fences.`;
