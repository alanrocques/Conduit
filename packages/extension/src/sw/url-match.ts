/**
 * Tiny glob-to-regex matcher used to pick a tab from a `urlPattern`.
 *
 * Rules:
 *   - `*` matches any run of characters (including `/`).
 *   - All other regex metacharacters are escaped.
 *   - Pattern is anchored at start and end.
 *
 * Examples:
 *   compileUrlPattern("https://linear.app/*") matches "https://linear.app/team/eng"
 *   compileUrlPattern("*linear.app*") matches any URL containing "linear.app"
 */

const REGEX_META = /[.+?^${}()|[\]\\]/g;

export function compileUrlPattern(pattern: string): RegExp {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*";
    } else {
      out += ch.replace(REGEX_META, (m) => `\\${m}`);
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesUrl(pattern: string, url: string | undefined): boolean {
  if (!url) return false;
  return compileUrlPattern(pattern).test(url);
}

export async function findMatchingTab(
  pattern: string,
): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  const re = compileUrlPattern(pattern);
  for (const tab of tabs) {
    if (tab.url && re.test(tab.url)) {
      return tab;
    }
  }
  return null;
}
