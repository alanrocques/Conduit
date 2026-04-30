/**
 * MCP tool definitions for Conduit M0.
 *
 * Three tools are exposed: hello_world, extract_ax_tree, click_by_role_name.
 * Each tool's input is validated against a JSON Schema, then forwarded to the
 * NMH client. Errors from the NMH (e.g. EXTENSION_NOT_RUNNING) are converted
 * into MCP error results (`isError: true` + a friendly text message) instead
 * of being thrown — that's what the MCP spec recommends for tool failures so
 * the model can recover.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ClickByRoleNameRequest,
  ErrorCode,
  ExtractAxTreeRequest,
  HelloWorldRequest,
  RunProfileToolRequest,
} from "@conduit/protocol";
import { NmhClient, NmhError } from "./nmh-client.js";
import { log } from "./log.js";

const TOOLS: Tool[] = [
  {
    name: "hello_world",
    description:
      "Sanity check that proves the Conduit pipeline is wired end-to-end (MCP server -> native host -> browser extension). Returns a greeting from the extension.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Optional name to include in the greeting.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "extract_ax_tree",
    description:
      "Extract the accessibility tree of the first open browser tab whose URL matches `urlPattern`. Returns a JSON-serialized AX tree. Requires the user to have the matching site open and authenticated.",
    inputSchema: {
      type: "object",
      properties: {
        urlPattern: {
          type: "string",
          description:
            "Substring or glob-like pattern matched against the tab URL (e.g. 'linear.app' or 'github.com/issues').",
        },
        rootRole: {
          type: "string",
          description:
            "Optional ARIA role to anchor the subtree (e.g. 'main', 'navigation'). Defaults to the page root.",
        },
        maxDepth: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description:
            "Optional maximum tree depth. Useful for keeping responses small.",
        },
      },
      required: ["urlPattern"],
      additionalProperties: false,
    },
  },
  {
    name: "click_by_role_name",
    description:
      "Click the first accessibility node with the given `role` and `name` in the first browser tab matching `urlPattern`. The click is dispatched via Chrome DevTools Protocol so it is a trusted user gesture.",
    inputSchema: {
      type: "object",
      properties: {
        urlPattern: {
          type: "string",
          description:
            "Substring/glob pattern matched against the tab URL.",
        },
        role: {
          type: "string",
          description: "ARIA role of the target node (e.g. 'button', 'link').",
        },
        name: {
          type: "string",
          description:
            "Accessible name of the target node (matched case-insensitively, with leading/trailing whitespace trimmed).",
        },
      },
      required: ["urlPattern", "role", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "run_profile_tool",
    description:
      "Run a tool from a registered site profile (e.g. 'linear.list_my_issues'). The extension finds a tab matching the profile's urlPattern, walks the tool's executionPlan against the live page, and returns any extracted outputs. Site profiles are pre-built recipes for common workflows on supported sites.",
    inputSchema: {
      type: "object",
      properties: {
        profileName: {
          type: "string",
          description: "Profile id, e.g. 'linear', 'notion', 'gmail'.",
        },
        toolName: {
          type: "string",
          description:
            "Tool id within the profile, e.g. 'show_current_view', 'list_my_issues'.",
        },
        urlPattern: {
          type: "string",
          description:
            "Optional override for which tab to act on. Defaults to the profile's first urlPattern.",
        },
        args: {
          type: "object",
          description:
            "Arguments for the tool, matching its parameter schema. Pass {} for tools with no parameters.",
          additionalProperties: true,
        },
      },
      required: ["profileName", "toolName"],
      additionalProperties: false,
    },
  },
];

export function registerTools(server: Server, nmh: NmhClient): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "hello_world":
          return await handleHelloWorld(nmh, args);
        case "extract_ax_tree":
          return await handleExtractAxTree(nmh, args);
        case "click_by_role_name":
          return await handleClickByRoleName(nmh, args);
        case "run_profile_tool":
          return await handleRunProfileTool(nmh, args);
        default:
          return errorResult(
            "INVALID_REQUEST",
            `Conduit: unknown tool '${name}'.`,
          );
      }
    } catch (err) {
      if (err instanceof NmhError) {
        return errorResult(err.code, err.message);
      }
      log.error("tool handler threw", { tool: name, err: String(err) });
      return errorResult(
        "INTERNAL_ERROR",
        `Conduit: internal error while running '${name}'. Please file an issue with the debug log.`,
      );
    }
  });
}

// --- handlers -------------------------------------------------------------

async function handleHelloWorld(
  nmh: NmhClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const payload: HelloWorldRequest = {};
  if (typeof args["name"] === "string") {
    payload.name = args["name"];
  } else if (args["name"] !== undefined) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'name' must be a string if provided.",
    );
  }
  const res = await nmh.request("hello_world", payload);
  return textResult(res.greeting);
}

async function handleExtractAxTree(
  nmh: NmhClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const urlPattern = args["urlPattern"];
  if (typeof urlPattern !== "string" || urlPattern.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'urlPattern' is required and must be a non-empty string.",
    );
  }

  const payload: ExtractAxTreeRequest = { urlPattern };

  const rootRole = args["rootRole"];
  if (typeof rootRole === "string") {
    payload.rootRole = rootRole;
  } else if (rootRole !== undefined) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'rootRole' must be a string if provided.",
    );
  }

  const maxDepth = args["maxDepth"];
  if (typeof maxDepth === "number" && Number.isInteger(maxDepth) && maxDepth > 0) {
    payload.maxDepth = maxDepth;
  } else if (maxDepth !== undefined) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'maxDepth' must be a positive integer if provided.",
    );
  }

  const res = await nmh.request("extract_ax_tree", payload);
  return textResult(JSON.stringify(res, null, 2));
}

async function handleClickByRoleName(
  nmh: NmhClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const urlPattern = args["urlPattern"];
  const role = args["role"];
  const name = args["name"];
  if (typeof urlPattern !== "string" || urlPattern.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'urlPattern' is required and must be a non-empty string.",
    );
  }
  if (typeof role !== "string" || role.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'role' is required and must be a non-empty string.",
    );
  }
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'name' is required and must be a non-empty string.",
    );
  }

  const payload: ClickByRoleNameRequest = { urlPattern, role, name };
  const res = await nmh.request("click_by_role_name", payload);
  return textResult(
    `Clicked ${role} "${name}" on tab ${res.tabId} (${res.url}) at ${new Date(
      res.clickedAt,
    ).toISOString()}.`,
  );
}

async function handleRunProfileTool(
  nmh: NmhClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const profileName = args["profileName"];
  const toolName = args["toolName"];
  if (typeof profileName !== "string" || profileName.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'profileName' is required and must be a non-empty string.",
    );
  }
  if (typeof toolName !== "string" || toolName.length === 0) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'toolName' is required and must be a non-empty string.",
    );
  }

  const payload: RunProfileToolRequest = { profileName, toolName };

  const urlPattern = args["urlPattern"];
  if (typeof urlPattern === "string" && urlPattern.length > 0) {
    payload.urlPattern = urlPattern;
  } else if (urlPattern !== undefined) {
    return errorResult(
      "INVALID_REQUEST",
      "Conduit: 'urlPattern' must be a non-empty string if provided.",
    );
  }

  const rawArgs = args["args"];
  if (rawArgs !== undefined) {
    if (
      typeof rawArgs !== "object" ||
      rawArgs === null ||
      Array.isArray(rawArgs)
    ) {
      return errorResult(
        "INVALID_REQUEST",
        "Conduit: 'args' must be an object if provided.",
      );
    }
    // Trust the SiteProfile's own parameter validation in the extension.
    payload.args = rawArgs as Record<string, string | number | boolean>;
  }

  const res = await nmh.request("run_profile_tool", payload);
  return textResult(JSON.stringify(res, null, 2));
}

// --- helpers --------------------------------------------------------------

function textResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

function errorResult(code: ErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: friendlyMessage(code, message) }],
  };
}

function friendlyMessage(code: ErrorCode, fallback: string): string {
  switch (code) {
    case "EXTENSION_NOT_RUNNING":
      return "Conduit: the browser extension isn't reachable. Make sure the Conduit extension is installed and your browser is open, then retry.";
    case "SITE_NOT_ALLOWLISTED":
      return `Conduit: this site isn't in your allowlist. Open the Conduit extension popup to authorize it. (${fallback})`;
    case "LOGIN_REQUIRED":
      return `Conduit: you need to be logged in to that site in your browser before Conduit can act on it. (${fallback})`;
    case "CONFIRMATION_DENIED":
      return "Conduit: you denied the action in the confirmation modal.";
    case "TIMEOUT":
      return `Conduit: the action timed out. ${fallback}`;
    case "SCHEMA_ERROR":
      return `Conduit: the page structure didn't match what was expected. The tool may need to be re-recorded. (${fallback})`;
    case "INVALID_REQUEST":
      return fallback;
    case "INTERNAL_ERROR":
    default:
      return `Conduit: internal error. Please file an issue with the debug log. (${fallback})`;
  }
}
