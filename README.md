# Conduit

Turn any authenticated website in your browser into an MCP server, so any AI agent (Claude Desktop, Cursor, Claude Code, ChatGPT) can read and act on the tools you're already logged into — without API keys, OAuth integrations, or sending data to a cloud.

> **Status:** M1 in progress. Spike pipeline works end-to-end against Linear; not ready for general use.

## Architecture

Three-process system spanning the local machine:

```
MCP Client  <-stdio->  MCP Server  <-UNIX sock->  NMH  <-native msg->  Extension  <-CDP->  Tab
```

- `packages/protocol` — shared message types + the `SiteProfile` / `ToolDefinition` / `ExecutionStep` contract that the runtime, recorder, and synthesizer all build against.
- `packages/mcp-server` — Node daemon that speaks MCP over stdio and forwards to the NMH.
- `packages/nmh` — Native Messaging Host. Bridges the MCP server's UNIX socket to the extension's Chrome native messaging stdio. Bundled with esbuild so it deploys self-contained outside `~/Documents/` (macOS TCC blocks browsers from executing files there).
- `packages/extension` — Chrome MV3 extension. Owns `chrome.debugger`, the profile runtime, the workflow recorder, and the synthesizer.

## What works today

**MCP tools exposed by the server:**

- `hello_world` — pipeline sanity check
- `extract_ax_tree` — accessibility tree for any open tab matching a URL pattern
- `click_by_role_name` — CDP-trusted click on an AX node
- `run_profile_tool` — execute a tool from a registered site profile

**In-extension features:**

- **Site profiles** — TypeScript modules declaring URL patterns + tool definitions + execution plans. One profile shipped: Linear (`show_current_view`, `list_my_issues`).
- **Profile runtime** — interprets `ExecutionStep[]` (navigate, wait_for_element, click, input, key, extract_ax_tree, extract_text) against a live tab via CDP, with `{paramName}` substitution and per-step output collection.
- **Workflow recorder** — content script captures clicks/inputs/keydowns/navigations on a target tab; the SW pairs each event with a post-action AX-tree snapshot and persists the trace to `chrome.storage.local`. Sensitive inputs (password/email/tel/cc) are redacted in-page.
- **Tool synthesizer (BYOK)** — sends a recorded trace to the Anthropic Messages API with structured outputs, gets back a `ToolDefinition` matching the profile schema. Bring your own `sk-ant-…` key in the options page; key lives in `chrome.storage.session` (in-memory, cleared on browser restart).
- **Popup UI** — connection status, registered profiles + clickable tools, recorder controls with live event count, expandable trace cards with event lists, "Synthesize tool" button.

## Development

Requires Node 20+. Tested on macOS with Arc and Chrome.

```sh
npm install
npm run build
```

Then:

1. Install the NMH manifest:
   ```sh
   CONDUIT_EXTENSION_ID=<your-unpacked-extension-id> \
     npm run install:manifest --workspace @conduit/nmh
   ```
   The script writes the manifest into every Chromium-derived browser's NMH dir it finds (Chrome, Chrome Beta/Canary/Dev, Chromium, Edge, Brave, Arc) and copies the runtime into `~/.conduit/bin/`.
2. Load `packages/extension/dist` as an unpacked extension.
3. (Optional, for the synthesizer) open the extension's options page and paste your Anthropic API key.

The Conduit MCP server registers itself via `.mcp.json` — point your MCP client at `node packages/mcp-server/dist/index.js`.

## Tests

```sh
npm test --workspace @conduit/extension
```

## License

MIT.
