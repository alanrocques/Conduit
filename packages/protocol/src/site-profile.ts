/**
 * Site-profile types — the contract M1 builds against.
 *
 * A SiteProfile is a TypeScript module that declares:
 *   - which sites it applies to (urlPatterns),
 *   - what tools it exposes to MCP clients (ToolDefinition[]),
 *   - and how each tool runs against the live page (ExecutionStep[]).
 *
 * The extension's profile runtime interprets the ExecutionStep[] using CDP +
 * the AX tree; the MCP server exposes each ToolDefinition as a top-level MCP
 * tool named `<profile.name>.<tool.name>`.
 *
 * What this file deliberately leaves out (will land in later M1 slices):
 *   - Full JSON-Schema for parameters. We only support string/number/boolean
 *     enum/required for now — enough for the three pre-built profiles.
 *   - Confirmation-modal copy and per-action approval state (W4).
 *   - User-recorded profile signature/provenance fields (M3+).
 */

// --- Parameters --------------------------------------------------------

/**
 * Subset of JSON Schema sufficient for the v0 tool surface. Each tool's
 * `parameters` is a flat record of name → ParameterSchema; nested objects
 * and arrays are deferred until a profile actually needs them.
 */
export type ParameterSchema =
  | StringParameter
  | NumberParameter
  | BooleanParameter;

export interface ParameterBase {
  description: string;
  required?: boolean;
}

export interface StringParameter extends ParameterBase {
  type: "string";
  enum?: readonly string[];
}

export interface NumberParameter extends ParameterBase {
  type: "number";
  minimum?: number;
  maximum?: number;
}

export interface BooleanParameter extends ParameterBase {
  type: "boolean";
}

/**
 * Concrete argument values handed to a tool at invocation time.
 * Matches the shape declared by `parameters` but loosely typed at the
 * boundary — runtime validation happens in the extension before any
 * ExecutionStep runs.
 */
export type ToolArgs = Record<string, string | number | boolean>;

// --- Execution plan ----------------------------------------------------

/**
 * Steps in an ExecutionPlan. String-valued fields support `{paramName}`
 * substitution from the tool's `args` at runtime. Substitution is literal —
 * no expression evaluation, no escaping helpers — to keep the surface small.
 *
 * Example: `{ type: "input", role: "searchbox", name: "Search", value: "{email}" }`
 * with args `{ email: "alice@x.com" }` becomes value `"alice@x.com"`.
 */
export type ExecutionStep =
  | NavigateStep
  | WaitForElementStep
  | ClickStep
  | InputStep
  | KeyStep
  | ExtractAxTreeStep
  | ExtractTextStep;

export interface NavigateStep {
  type: "navigate";
  /** Absolute URL or path relative to the current tab's origin. */
  url: string;
}

export interface WaitForElementStep {
  type: "wait_for_element";
  role: string;
  /** Omit to match any node with the given role (useful when waiting on a
   * landmark like `main` or `navigation` that has no AX name). */
  name?: string;
  /** Default 5000 ms if omitted. */
  timeoutMs?: number;
}

export interface ClickStep {
  type: "click";
  role: string;
  name: string;
}

export interface InputStep {
  type: "input";
  role: string;
  name: string;
  value: string;
}

export interface KeyStep {
  type: "key";
  /** Chrome `Input.dispatchKeyEvent` key name, e.g. "Enter", "Escape". */
  key: string;
}

export interface ExtractAxTreeStep {
  type: "extract_ax_tree";
  /** ARIA role to scope the extraction. Omit for whole document. */
  rootRole?: string;
  maxDepth?: number;
}

export interface ExtractTextStep {
  type: "extract_text";
  role: string;
  /** Returns the AX `name` of the matched node. */
  name: string;
}

/**
 * Per-step output collection: each step that produces output writes into a
 * named slot on a per-invocation result map. The final ExecutionPlan result
 * is the merged map. Currently only the two `extract_*` steps produce output.
 */
export interface StepWithOutput {
  /** Slot name to write the step's output into. Required for extract_*. */
  outputName?: string;
}

// --- Tools and profiles ------------------------------------------------

export interface ToolDefinition {
  /** Stable identifier; combined with profile name to form the MCP tool id. */
  name: string;
  description: string;
  /**
   * Whether the tool changes server-side state. State-changing tools are
   * gated by the confirmation modal (W4) unless the user has pre-approved
   * them for the current site.
   */
  mutates: boolean;
  parameters: Record<string, ParameterSchema>;
  /**
   * Steps run in order. If any step throws, the tool returns an error and
   * any partially-collected outputs are discarded.
   */
  executionPlan: readonly (ExecutionStep & StepWithOutput)[];
}

export interface SiteProfile {
  /**
   * Stable, lowercase identifier. Forms the prefix of every MCP tool this
   * profile exposes (`<name>.<tool>`). Should match the primary site's
   * brand (e.g. "linear", "notion", "gmail").
   */
  name: string;
  /**
   * Human-readable label shown in the popup / allowlist UI.
   */
  displayName: string;
  /**
   * URL patterns this profile applies to. Glob-style — same matcher as
   * `urlPattern` in the M0 methods.
   */
  urlPatterns: readonly string[];
  tools: readonly ToolDefinition[];
}
