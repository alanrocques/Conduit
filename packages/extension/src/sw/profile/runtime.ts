/**
 * Profile-tool runtime.
 *
 * Locates the target tab, attaches CDP once, validates args against the
 * tool's parameter schema, then walks the executionPlan step-by-step.
 *
 * Output collection: any step with an `outputName` writes its return value
 * (extract_ax_tree → AxNode, extract_text → string) into a result map keyed
 * by that name. The final result returned to the caller is the merged map.
 *
 * Failure semantics: if any step throws, the tool fails and partial outputs
 * are discarded. Profiles must be designed so a failed step doesn't leave
 * destructive partial state on the page (e.g. don't put `click "Delete"` in
 * a 5-step plan unless the prior 4 steps are all idempotent).
 */

import type {
  AxNode,
  ExecutionStep,
  ParameterSchema,
  SiteProfile,
  StepWithOutput,
  ToolArgs,
  ToolDefinition,
} from "@conduit/protocol";

import { findMatchingTab } from "../url-match.js";
import { attachIfNeeded, sendCommand } from "../debugger-util.js";
import { HandlerError } from "../errors.js";
import {
  execClick,
  execExtractAxTree,
  execExtractText,
  execInput,
  execKey,
  execNavigate,
  execWaitForElement,
} from "./step-executor.js";

export type StepOutput = AxNode | string;

export interface RunProfileToolResult {
  url: string;
  tabId: number;
  outputs: Record<string, StepOutput>;
}

function validateArgs(
  toolName: string,
  parameters: ToolDefinition["parameters"],
  args: ToolArgs,
): void {
  // Required-presence + type-shape only. Schema-driven coercion is overkill
  // for v0 — profiles are authored in-tree and pass static-typed args.
  for (const [name, schema] of Object.entries(parameters)) {
    const present = name in args;
    if (!present) {
      if (schema.required) {
        throw new HandlerError(
          "SCHEMA_ERROR",
          `Tool "${toolName}" missing required parameter "${name}".`,
        );
      }
      continue;
    }
    const value = args[name];
    if (!matchesSchema(schema, value)) {
      throw new HandlerError(
        "SCHEMA_ERROR",
        `Tool "${toolName}" parameter "${name}" expected ${schema.type}, got ${typeof value}.`,
      );
    }
  }
  // Disallow unknown args — fail loud on typos.
  for (const name of Object.keys(args)) {
    if (!(name in parameters)) {
      throw new HandlerError(
        "SCHEMA_ERROR",
        `Tool "${toolName}" got unknown parameter "${name}".`,
      );
    }
  }
}

function matchesSchema(schema: ParameterSchema, value: unknown): boolean {
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    return true;
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  return typeof value === "boolean";
}

async function dispatchStep(
  tabId: number,
  step: ExecutionStep & StepWithOutput,
  args: ToolArgs,
  outputs: Record<string, StepOutput>,
): Promise<void> {
  switch (step.type) {
    case "navigate":
      await execNavigate(tabId, step, args);
      return;
    case "wait_for_element":
      await execWaitForElement(tabId, step, args);
      return;
    case "click":
      await execClick(tabId, step, args);
      return;
    case "input":
      await execInput(tabId, step, args);
      return;
    case "key":
      await execKey(tabId, step, args);
      return;
    case "extract_ax_tree": {
      const tree = await execExtractAxTree(tabId, step, args);
      if (step.outputName) outputs[step.outputName] = tree;
      return;
    }
    case "extract_text": {
      const text = await execExtractText(tabId, step, args);
      if (step.outputName) outputs[step.outputName] = text;
      return;
    }
  }
}

export async function runProfileTool(
  profile: SiteProfile,
  tool: ToolDefinition,
  args: ToolArgs,
  urlPattern: string,
): Promise<RunProfileToolResult> {
  validateArgs(tool.name, tool.parameters, args);

  const tab = await findMatchingTab(urlPattern);
  if (!tab || tab.id === undefined || !tab.url) {
    throw new HandlerError(
      "LOGIN_REQUIRED",
      `No open tab matches ${urlPattern} for profile "${profile.name}". ` +
        "Log in and open the page first.",
    );
  }
  const tabId = tab.id;

  await attachIfNeeded(tabId);
  await sendCommand(tabId, "DOM.enable");
  await sendCommand(tabId, "Accessibility.enable");

  const outputs: Record<string, StepOutput> = {};
  for (const step of tool.executionPlan) {
    await dispatchStep(tabId, step, args, outputs);
  }

  // Re-read tab.url after the plan in case a Navigate step changed it.
  const after = await chrome.tabs.get(tabId);

  return {
    url: after.url ?? tab.url,
    tabId,
    outputs,
  };
}
