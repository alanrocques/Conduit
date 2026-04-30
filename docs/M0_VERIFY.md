# M0 spike verification

Status checklist for the three architectural risks the spike was meant to retire.

## Automated (passes today)

Run from repo root:

```sh
npm install
npm run typecheck
npm run build
node scripts/m0-integration-test.mjs
```

What this proves:

- All four packages (`@conduit/protocol`, `@conduit/mcp-server`, `@conduit/nmh`, `@conduit/extension`) typecheck and build.
- NMH opens a UNIX socket at `~/.conduit/socket` (mode 0600) and accepts connections.
- A request envelope written into the socket reaches the NMH's stdout, framed with the 4-byte little-endian length prefix Chrome's native messaging protocol expects.
- A length-prefixed response written into the NMH's stdin is routed back over the socket to the originating connection, newline-delimited.
- MCP server boots on stdio, connects to the NMH socket, and engages exponential backoff when the socket is absent.

## Manual (requires Chrome + a logged-in Linear tab)

The spike DoD per `03_BUILD_PLAN.md` is "Cursor calls a tool that reads AX tree from a real authenticated Linear tab, and a separate tool clicks a button." That requires a human in the loop. Steps:

1. **Build everything**
   ```sh
   npm install
   npm run build
   ```

2. **Load the extension unpacked**
   - Chrome → `chrome://extensions` → Developer Mode on → Load unpacked → select `packages/extension/dist/`.
   - Copy the extension ID from the card (32-char string).

3. **Install the NMH manifest**
   ```sh
   CONDUIT_EXTENSION_ID=<32-char-id> npm run install:manifest --workspace @conduit/nmh
   ```
   This writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.conduit.bridge.json` (macOS) or `~/.config/google-chrome/NativeMessagingHosts/com.conduit.bridge.json` (Linux).

4. **Reload the extension** so it picks up the manifest. Open the popup; "NMH connected" should appear.

5. **Wire an MCP client.** Add to Cursor's `mcp.json` (or Claude Desktop's `claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "conduit": {
         "command": "node",
         "args": ["<repo-abs-path>/packages/mcp-server/dist/index.js"]
       }
     }
   }
   ```
   Restart the client.

6. **Risk 1 — bridge end-to-end.** From the client, call `hello_world`. Expected: `"Hello, world from Conduit extension"`. If this works, MV3 ↔ NMH ↔ MCP ↔ stdio is proven.

7. **Risk 2 — AX-tree extraction.** Open `https://linear.app/<your-workspace>/my-issues` and log in. From the client, call `extract_ax_tree` with `{ "urlPattern": "https://linear.app/*" }`. Expected: a hierarchical tree containing rows for your issues with role/name pairs.

8. **Risk 3 — CDP click.** From the client, call `click_by_role_name` with `{ "urlPattern": "https://linear.app/*", "role": "button", "name": "<a real button label visible in the AX tree>" }`. Expected: the button visibly clicks (yellow debugger banner stays visible the whole time).

## Kill criteria reminders

Stop and reconsider the architecture if any of these fire during manual verification:

- Service-worker keep-alive drops the NMH port mid-session in a way that simple reconnect can't recover from.
- AX-tree output on Linear is too noisy or too sparse to be usable (Stagehand-style benchmarks suggest it should be fine; verify on real pages).
- `Input.dispatchMouseEvent` clicks don't register on Linear's React inputs (frames need `isTrusted: true` events; CDP supplies this, so this should be fine — but verify).
