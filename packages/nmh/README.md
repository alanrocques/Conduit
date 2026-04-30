# @conduit/nmh

The Conduit Native Messaging Host (NMH). Launched by Chrome when the
extension calls `chrome.runtime.connectNative('com.conduit.bridge')`. Speaks
Chrome's native messaging stdio protocol on stdin/stdout, and forwards
envelopes to/from a UNIX socket consumed by the Conduit MCP server.

In M0 the NMH is a dumb pipe. Routing rules:

- `request` from MCP-server socket → forwarded to extension via stdout. The
  originating connection is tracked by `id` so the matching `response` is
  delivered back to that same socket.
- `response` from extension → routed to the socket that sent the request,
  falling back to broadcast if the id is unknown.
- `event` from extension → broadcast to all connected sockets.

## Build

```sh
npm install                          # from repo root, once
npm run build --workspace @conduit/nmh
```

This produces:

- `packages/nmh/dist/index.js` (the Node entrypoint, with `#!/usr/bin/env node`).
- `packages/nmh/dist/conduit-nmh.sh` (a 0755 bash wrapper Chrome can exec).

## Install the Chrome NMH manifest

Chrome locates the host via a JSON manifest in an OS-specific directory.
The `install:manifest` script writes one for you.

```sh
# If you already know the unpacked extension's ID:
CONDUIT_EXTENSION_ID=<32-char-id> npm run install:manifest --workspace @conduit/nmh

# Or write a placeholder now and edit the manifest later:
npm run install:manifest --workspace @conduit/nmh
```

Manifest paths the script writes:

- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.conduit.bridge.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.conduit.bridge.json`
- Windows: not supported in M0 — register manually via the registry under
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.conduit.bridge`.

### Finding the extension ID

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and pick the Conduit extension's `dist/`.
4. The extension's card now shows an `ID` field. Copy that 32-character
   lowercase string.
5. Either re-run `install:manifest` with `CONDUIT_EXTENSION_ID=<id>`, or
   hand-edit the installed manifest's `allowed_origins` entry to replace
   `REPLACE_ME` with the ID.

## Uninstall

```sh
npm run uninstall:manifest --workspace @conduit/nmh
```

## Socket location

Default: `~/.conduit/socket` (mode 0600, parent dir mode 0700). Override
with the `CONDUIT_SOCKET_PATH` env var if needed for testing.

## Diagnostics

The NMH writes all logs to **stderr**. Stdout is reserved for Chrome's
length-prefixed native messaging frames; any stray bytes there will desync
the channel and crash the connection. Chrome captures host stderr; check
Chrome's stderr logs (or run the host yourself for inspection).
