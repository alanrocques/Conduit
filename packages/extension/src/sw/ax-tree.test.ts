/**
 * Regression tests for buildAxTree's lift/depth behavior. Both bugs were
 * found while wiring up real sites (Linear, GitHub) — symptoms were a
 * RootWebArea with zero children even though `Accessibility.getFullAXTree`
 * returned thousands of nodes.
 */

import { describe, expect, it } from "vitest";

import { buildAxTree, type CdpAxNode, type CdpAxTreeResponse } from "./ax-tree.js";

function node(
  id: string,
  role: string,
  childIds: string[],
  opts: {
    parentId?: string;
    name?: string;
    ignored?: boolean;
  } = {},
): CdpAxNode {
  const n: CdpAxNode = {
    nodeId: id,
    role: { type: "internalRole", value: role },
    childIds,
  };
  if (opts.parentId !== undefined) n.parentId = opts.parentId;
  if (opts.name !== undefined) n.name = { type: "computedString", value: opts.name };
  if (opts.ignored !== undefined) n.ignored = opts.ignored;
  return n;
}

function tree(...nodes: CdpAxNode[]): CdpAxTreeResponse {
  return { nodes };
}

describe("buildAxTree", () => {
  it("lifts descendants of an ignored wrapper into the parent", () => {
    // Real-world shape: RootWebArea -> <div role=none aria-hidden> -> button.
    // Regression: previously `if (cdpNode.ignored) return null` erased the
    // whole subtree, so the button never reached the output.
    const cdp = tree(
      node("1", "RootWebArea", ["2"]),
      node("2", "none", ["3"], { parentId: "1", ignored: true }),
      node("3", "button", [], { parentId: "2", name: "Click me" }),
    );

    const out = buildAxTree(cdp);

    expect(out.role).toBe("RootWebArea");
    expect(out.children).toHaveLength(1);
    expect(out.children?.[0]).toMatchObject({
      role: "button",
      name: "Click me",
    });
  });

  it("does not let noise wrappers consume the depth budget", () => {
    // Real-world shape on GitHub: 4+ wrapper divs (role=generic, no name)
    // sit between RootWebArea and the actual semantic element. Regression:
    // depth was counted on the input tree, so wrappers burned the budget
    // and `maxDepth: 1` would emit no children at all.
    const cdp = tree(
      node("1", "RootWebArea", ["2"]),
      node("2", "generic", ["3"], { parentId: "1" }),
      node("3", "generic", ["4"], { parentId: "2" }),
      node("4", "generic", ["5"], { parentId: "3" }),
      node("5", "generic", ["6"], { parentId: "4" }),
      node("6", "button", [], { parentId: "5", name: "Deep" }),
    );

    const out = buildAxTree(cdp, { maxDepth: 1 });

    expect(out.role).toBe("RootWebArea");
    expect(out.children).toHaveLength(1);
    expect(out.children?.[0]).toMatchObject({
      role: "button",
      name: "Deep",
    });
  });
});
