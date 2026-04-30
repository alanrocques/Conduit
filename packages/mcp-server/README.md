# @conduit/mcp-server

The MCP server half of [Conduit](../../README.md). Speaks JSON-RPC MCP over
stdio to clients like Cursor and Claude Desktop, and bridges tool calls
through a UNIX socket to the Conduit Native Messaging Host (which forwards
them to the browser extension).

```
MCP Client  <-- stdio MCP -->  conduit-mcp-server  <-- UNIX socket -->  NMH  <-- native messaging -->  Extension
```

## Install / build

This package lives inside the Conduit npm workspace. From the repo root:

```bash
npm install --workspace @conduit/mcp-server
npm run build --workspace @conduit/mcp-server
```

The build emits `dist/index.js`, which is also the binary entry
(`conduit-mcp-server`).

## Run

```bash
node packages/mcp-server/dist/index.js
```

You should see a single line on **stderr**:

```
[2026-...] [conduit-mcp] [info] MCP server listening on stdio { ... }
```

Stdout is reserved for the MCP wire protocol — the server never writes
diagnostics there.

The NMH socket path defaults to `$HOME/.conduit/socket`. Override with the
`CONDUIT_SOCKET_PATH` env var if needed.

## Wiring into MCP clients

### Cursor / Claude Desktop

Add an entry to your client's `mcpServers` config. Use an **absolute path** to
the built `dist/index.js`:

```json
{
  "mcpServers": {
    "conduit": {
      "command": "node",
      "args": ["/absolute/path/to/conduit/packages/mcp-server/dist/index.js"]
    }
  }
}
```

For Claude Desktop on macOS the file is at:
`~/Library/Application Support/Claude/claude_desktop_config.json`

For Cursor: Settings → MCP → "Edit in settings.json".

After editing, restart the client. The three M0 tools (`hello_world`,
`extract_ax_tree`, `click_by_role_name`) should appear in the tool picker.

## M0 tools

| Tool | Input | Notes |
| --- | --- | --- |
| `hello_world` | `{ name? }` | End-to-end pipeline check. |
| `extract_ax_tree` | `{ urlPattern, rootRole?, maxDepth? }` | Returns the AX tree of the first matching open tab. |
| `click_by_role_name` | `{ urlPattern, role, name }` | Dispatches a trusted CDP click on the first matching node. |

If the browser extension isn't running, tool calls return an MCP error result
(`isError: true`) with a friendly message rather than crashing the server.

## Development

```bash
npm run typecheck --workspace @conduit/mcp-server
npm run build     --workspace @conduit/mcp-server
npm run start     --workspace @conduit/mcp-server
```
