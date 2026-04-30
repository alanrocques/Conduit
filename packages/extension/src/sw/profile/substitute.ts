/**
 * `{paramName}` substitution for ExecutionStep string fields.
 *
 * Literal substitution only — no expressions, no escaping. Unknown params
 * throw so a typo in a profile fails loudly instead of running with empty
 * strings on the live page.
 */
import type { ToolArgs } from "@conduit/protocol";

const TEMPLATE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function substitute(template: string, args: ToolArgs): string {
  return template.replace(TEMPLATE, (_, name: string) => {
    if (!(name in args)) {
      throw new Error(`Profile template references unknown parameter "${name}"`);
    }
    return String(args[name]);
  });
}
