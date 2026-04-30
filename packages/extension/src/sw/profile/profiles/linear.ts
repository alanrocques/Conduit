/**
 * Linear site profile.
 *
 * Starter set: read-only tools only. State-changing tools (create_issue,
 * comment, status change) need exploratory authoring against the live UI
 * since Linear's button names and AX structure can shift between releases.
 *
 * URL shape: Linear paths are `https://linear.app/<workspace>/...`.
 * The pattern below matches any Linear page; the runtime picks the first
 * matching tab.
 */

import type { SiteProfile } from "@conduit/protocol";

export const linearProfile: SiteProfile = {
  name: "linear",
  displayName: "Linear",
  urlPatterns: ["https://linear.app/*"],
  tools: [
    {
      name: "show_current_view",
      description:
        "Return the accessibility tree of the Linear page currently open in the user's tab. Use this to inspect what the user is looking at without navigating.",
      mutates: false,
      parameters: {},
      executionPlan: [
        {
          type: "extract_ax_tree",
          rootRole: "main",
          maxDepth: 6,
          outputName: "tree",
        },
      ],
    },
    {
      name: "list_my_issues",
      description:
        "Navigate to the user's assigned-issues view in Linear and return its accessibility tree.",
      mutates: false,
      parameters: {},
      executionPlan: [
        // Linear's "my issues" lives at /my-issues for the active workspace.
        { type: "navigate", url: "/my-issues" },
        // Wait for the issue list region to render — `main` is the most
        // reliable landmark Linear ships on this view.
        { type: "wait_for_element", role: "main" },
        {
          type: "extract_ax_tree",
          rootRole: "main",
          maxDepth: 6,
          outputName: "tree",
        },
      ],
    },
  ],
};
