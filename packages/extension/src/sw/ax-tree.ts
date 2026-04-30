/**
 * AX-tree helpers shared by extract_ax_tree and click_by_role_name handlers.
 *
 * The CDP `Accessibility.getFullAXTree` command returns a flat list of nodes,
 * each shaped roughly like:
 *
 *   {
 *     nodeId: "1",
 *     parentId?: "0",
 *     backendDOMNodeId?: 42,
 *     role: { type: "internalRole", value: "button" },
 *     name?: { type: "computedString", value: "Submit" },
 *     value?: { type: "string", value: "..." },
 *     description?: { type: "computedString", value: "..." },
 *     childIds: ["3", "4"]
 *   }
 *
 * We build a nested AxNode tree from that. Roles like `none`/`presentation`/
 * `generic` are filtered out unless they contribute a name — they're noise.
 */

import type { AxNode } from "@conduit/protocol";

const NAME_TRUNCATE = 200;
const NOISE_ROLES = new Set(["none", "presentation", "generic"]);

interface CdpAxValue<T = string> {
  type: string;
  value?: T;
}

export interface CdpAxNode {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: CdpAxValue;
  name?: CdpAxValue;
  value?: CdpAxValue<string | number | boolean>;
  description?: CdpAxValue;
  childIds?: string[];
}

export interface CdpAxTreeResponse {
  nodes: CdpAxNode[];
}

function truncate(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= NAME_TRUNCATE) return s;
  return `${s.slice(0, NAME_TRUNCATE - 1)}...`;
}

function nodeRole(n: CdpAxNode): string {
  return n.role?.value ?? "unknown";
}

function nodeName(n: CdpAxNode): string | undefined {
  const v = n.name?.value;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function nodeValue(n: CdpAxNode): string | undefined {
  const v = n.value?.value;
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function nodeDesc(n: CdpAxNode): string | undefined {
  const v = n.description?.value;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/** Build a flat lookup keyed by nodeId. */
export function indexNodes(nodes: CdpAxNode[]): Map<string, CdpAxNode> {
  const m = new Map<string, CdpAxNode>();
  for (const n of nodes) m.set(n.nodeId, n);
  return m;
}

function rootCandidate(nodes: CdpAxNode[]): CdpAxNode | undefined {
  // The first node without a parentId, or the first node of role
  // RootWebArea, whichever comes first.
  return (
    nodes.find((n) => !n.parentId) ??
    nodes.find((n) => nodeRole(n) === "RootWebArea") ??
    nodes[0]
  );
}

/**
 * Find the first node (depth-first from the given root) with role `role`.
 * Used when the caller specified `rootRole` to scope output.
 */
export function findFirstByRole(
  nodes: CdpAxNode[],
  index: Map<string, CdpAxNode>,
  startId: string,
  role: string,
): CdpAxNode | undefined {
  // Iterative DFS.
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    const node = index.get(id);
    if (!node) continue;
    if (nodeRole(node) === role) return node;
    if (node.childIds) {
      // push in reverse so we visit children left-to-right.
      for (let i = node.childIds.length - 1; i >= 0; i--) {
        stack.push(node.childIds[i]!);
      }
    }
  }
  return undefined;
}

/**
 * Find the first node matching role+name (name compared case-insensitively,
 * trimmed) anywhere in the tree.
 */
export function findFirstByRoleAndName(
  nodes: CdpAxNode[],
  role: string,
  name: string,
): CdpAxNode | undefined {
  const target = name.trim().toLowerCase();
  const wantedRole = role.toLowerCase();
  for (const n of nodes) {
    if (nodeRole(n).toLowerCase() !== wantedRole) continue;
    const nm = nodeName(n);
    if (nm && nm.trim().toLowerCase() === target) return n;
  }
  return undefined;
}

export interface BuildOptions {
  maxDepth?: number;
  rootRole?: string;
}

/**
 * Build a hierarchical AxNode tree from the CDP node list.
 * Filters noise roles unless they have a name.
 */
export function buildAxTree(
  cdp: CdpAxTreeResponse,
  opts: BuildOptions = {},
): AxNode {
  const nodes = cdp.nodes ?? [];
  const index = indexNodes(nodes);

  const root = rootCandidate(nodes);
  if (!root) {
    return { role: "RootWebArea" };
  }

  let startId = root.nodeId;
  if (opts.rootRole) {
    const found = findFirstByRole(nodes, index, root.nodeId, opts.rootRole);
    if (found) startId = found.nodeId;
  }

  const maxDepth = opts.maxDepth ?? Infinity;

  // Visit returns an *array* of output nodes for a single CDP node, so that
  // ignored/noise wrappers can be dropped while their meaningful descendants
  // are lifted into the parent's child list. Without this, dropping an
  // ignored RootWebArea-child like `<div role="none">` (very common: GitHub
  // wraps the whole page in one) would erase the entire useful subtree.
  //
  // `outputDepth` counts only emitted nodes — wrappers we drop do not consume
  // depth budget. Without this, GitHub-style 6+ levels of generic divs eat
  // the budget before any semantic role (main, banner, button) is reached.
  const visit = (id: string, outputDepth: number): AxNode[] => {
    const cdpNode = index.get(id);
    if (!cdpNode) return [];

    const role = nodeRole(cdpNode);
    const name = truncate(nodeName(cdpNode));
    const value = truncate(nodeValue(cdpNode));
    const description = truncate(nodeDesc(cdpNode));

    const isNoise =
      NOISE_ROLES.has(role) && !name && !value && !description;
    const willEmit = !cdpNode.ignored && !isNoise;

    // If we're emitting this node AND we're at the depth limit, don't recurse.
    const recurse = !willEmit || outputDepth < maxDepth;
    const childOutputDepth = willEmit ? outputDepth + 1 : outputDepth;

    const childOutputs: AxNode[] = [];
    if (recurse && cdpNode.childIds) {
      for (const childId of cdpNode.childIds) {
        for (const c of visit(childId, childOutputDepth)) childOutputs.push(c);
      }
    }

    if (!willEmit) return childOutputs;

    const out: AxNode = { role };
    if (name !== undefined) out.name = name;
    if (value !== undefined) out.value = value;
    if (description !== undefined) out.description = description;
    if (childOutputs.length > 0) out.children = childOutputs;
    return [out];
  };

  const built = visit(startId, 0);
  if (built.length === 0) return { role: "RootWebArea" };
  if (built.length === 1) return built[0]!;
  return { role: "group", children: built };
}
