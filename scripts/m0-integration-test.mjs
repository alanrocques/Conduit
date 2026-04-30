#!/usr/bin/env node
/**
 * M0 integration smoke test (no Chrome needed).
 *
 * Spawns the NMH with a controllable stdin/stdout, then connects to its
 * UNIX socket as if we were the MCP server, sends a request envelope,
 * and verifies the NMH frames it correctly onto stdout (which is where
 * Chrome's native messaging would receive it).
 *
 * Then we simulate the extension by writing a length-prefixed response
 * back into the NMH's stdin, and verify it routes to our socket.
 *
 * If this passes, the entire MCP-server <-> NMH <-> extension wire is
 * structurally correct; only the actual Chrome attach + AX-tree extract
 * remains to be tested manually with a loaded extension.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const nmhPath = join(repoRoot, "packages/nmh/dist/index.js");
const socketPath = join(homedir(), ".conduit/socket");

let failed = false;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label} ${detail}`);
    failed = true;
  }
}

function frameToStdin(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

function readFramedFromStdout(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let need = null;
    const onData = (buf) => {
      chunks.push(buf);
      total += buf.length;
      const all = Buffer.concat(chunks, total);
      if (need === null && all.length >= 4) {
        need = all.readUInt32LE(0);
      }
      if (need !== null && all.length >= 4 + need) {
        const json = all.subarray(4, 4 + need).toString("utf8");
        stream.off("data", onData);
        try {
          resolve(JSON.parse(json));
        } catch (e) {
          reject(e);
        }
      }
    };
    stream.on("data", onData);
    setTimeout(() => {
      stream.off("data", onData);
      reject(new Error("timeout reading framed stdout"));
    }, 5000);
  });
}

async function main() {
  console.log("M0 integration smoke test");

  const nmh = spawn("node", [nmhPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  // give NMH a moment to set up its socket
  await new Promise((r) => setTimeout(r, 300));

  // 1) connect as MCP server
  const sock = await new Promise((resolve, reject) => {
    const s = connect(socketPath, () => resolve(s));
    s.once("error", reject);
  });
  check("MCP-server socket connects to NMH", true);

  // 2) send a request envelope through the socket -> NMH should frame it onto its stdout
  const requestId = "test-1";
  const envelope = {
    kind: "request",
    id: requestId,
    protocol: "0.0.1",
    method: "hello_world",
    payload: { name: "spike" },
  };
  const stdoutMsgPromise = readFramedFromStdout(nmh.stdout);
  sock.write(JSON.stringify(envelope) + "\n");
  const fromStdout = await stdoutMsgPromise;
  check(
    "request flows socket -> NMH stdout (length-prefixed JSON)",
    fromStdout.id === requestId && fromStdout.method === "hello_world",
    JSON.stringify(fromStdout),
  );

  // 3) simulate extension responding via stdin -> NMH should route to our socket
  const response = {
    kind: "response",
    id: requestId,
    protocol: "0.0.1",
    ok: true,
    result: {
      greeting: "Hello, spike from Conduit extension",
      from: "extension",
      receivedAt: Date.now(),
    },
  };
  const responseFromSocket = new Promise((resolve, reject) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        try {
          resolve(JSON.parse(buf.slice(0, idx)));
        } catch (e) {
          reject(e);
        }
      }
    });
    setTimeout(() => reject(new Error("timeout reading socket response")), 5000);
  });
  nmh.stdin.write(frameToStdin(response));
  const sockMsg = await responseFromSocket;
  check(
    "response flows NMH stdin -> originating socket (newline JSON)",
    sockMsg.id === requestId && sockMsg.ok === true,
    JSON.stringify(sockMsg),
  );

  // shutdown
  sock.end();
  nmh.stdin.end();
  await new Promise((r) => nmh.once("exit", r));

  if (failed) {
    console.log("\nFAILED");
    process.exit(1);
  }
  console.log("\nAll M0 wire checks passed.");
}

main().catch((err) => {
  console.error("integration test crashed:", err);
  process.exit(2);
});
