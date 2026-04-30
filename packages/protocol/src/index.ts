/**
 * Wire protocol shared between Conduit MCP server, Native Messaging Host,
 * and browser extension. All three components import these types so that
 * messages stay structurally compatible.
 *
 * Transport summary:
 *   MCP server  <--JSON over UNIX socket-->  NMH  <--Chrome native messaging-->  Extension
 *
 * Both hops carry the same Envelope payload; the NMH is a dumb pipe in M0.
 */

export const PROTOCOL_VERSION = "0.0.1";

export const SOCKET_PATH_DEFAULT = ".conduit/socket";
export const NMH_HOST_NAME = "com.conduit.bridge";

export type RequestId = string;

export type EnvelopeKind = "request" | "response" | "event";

export interface RequestEnvelope<TPayload = unknown> {
  kind: "request";
  id: RequestId;
  protocol: typeof PROTOCOL_VERSION;
  method: string;
  payload: TPayload;
}

export interface ResponseEnvelope<TResult = unknown> {
  kind: "response";
  id: RequestId;
  protocol: typeof PROTOCOL_VERSION;
  ok: boolean;
  result?: TResult;
  error?: ErrorPayload;
}

export interface EventEnvelope<TPayload = unknown> {
  kind: "event";
  protocol: typeof PROTOCOL_VERSION;
  topic: string;
  payload: TPayload;
}

export type Envelope =
  | RequestEnvelope
  | ResponseEnvelope
  | EventEnvelope;

export type ErrorCode =
  | "EXTENSION_NOT_RUNNING"
  | "SITE_NOT_ALLOWLISTED"
  | "LOGIN_REQUIRED"
  | "CONFIRMATION_DENIED"
  | "TIMEOUT"
  | "SCHEMA_ERROR"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

// --- M0 methods -----------------------------------------------------------

/**
 * Sanity-check round trip. Used by the spike to prove the wire end-to-end.
 */
export interface HelloWorldRequest {
  name?: string;
}

export interface HelloWorldResponse {
  greeting: string;
  from: "extension";
  receivedAt: number;
}

/**
 * Extract the accessibility tree of an open tab matching `urlPattern`.
 * The extension picks the first matching tab; if none exists in M0 we
 * surface LOGIN_REQUIRED rather than opening one ourselves.
 */
export interface ExtractAxTreeRequest {
  urlPattern: string;
  rootRole?: string;
  maxDepth?: number;
}

export interface AxNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AxNode[];
}

export interface ExtractAxTreeResponse {
  url: string;
  tabId: number;
  capturedAt: number;
  tree: AxNode;
}

/**
 * Click the first AX node matching role+name on a tab matching `urlPattern`.
 * Uses CDP Input.dispatchMouseEvent at the node's center to get isTrusted=true.
 */
export interface ClickByRoleNameRequest {
  urlPattern: string;
  role: string;
  name: string;
}

export interface ClickByRoleNameResponse {
  tabId: number;
  url: string;
  clickedAt: number;
}

export type Method =
  | "hello_world"
  | "extract_ax_tree"
  | "click_by_role_name";

export interface MethodMap {
  hello_world: { req: HelloWorldRequest; res: HelloWorldResponse };
  extract_ax_tree: { req: ExtractAxTreeRequest; res: ExtractAxTreeResponse };
  click_by_role_name: {
    req: ClickByRoleNameRequest;
    res: ClickByRoleNameResponse;
  };
}

// --- Type guards ----------------------------------------------------------

export function isRequest(e: Envelope): e is RequestEnvelope {
  return e.kind === "request";
}

export function isResponse(e: Envelope): e is ResponseEnvelope {
  return e.kind === "response";
}

export function isEvent(e: Envelope): e is EventEnvelope {
  return e.kind === "event";
}
