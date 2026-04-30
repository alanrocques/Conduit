# Conduit

Turn any authenticated website in your browser into an MCP server, so any AI agent (Claude Desktop, Cursor, Claude Code, ChatGPT) can read and act on the tools you're already logged into — without API keys, OAuth integrations, or sending data to a cloud.

> **Status:** M0 spike. Not ready for use.

## Architecture

Three-process system spanning the local machine:

```
MCP Client  <-stdio->  MCP Server  <-UNIX sock->  NMH  <-native msg->  Extension  <-CDP->  Tab
```

- `packages/protocol` — shared message types between MCP server, NMH, and extension.
- `packages/mcp-server` — Node daemon that speaks MCP over stdio, forwards to NMH.
- `packages/nmh` — Native Messaging Host, bridges MCP server (UNIX socket) to extension (Chrome native messaging stdio).
- `packages/extension` — Chrome MV3 extension, owns `chrome.debugger` and the user-facing UI.

## Development (M0 spike)

Requires Node 20+.

```sh
npm install
npm run build
```

Then follow the per-package READMEs to install the NMH manifest and load the unpacked extension.

## License

MIT.
