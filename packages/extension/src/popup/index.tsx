/**
 * Conduit popup.
 *
 * Shows:
 *   - NMH connection state (read from chrome.storage.session, populated by SW)
 *   - The hardcoded M0 allowlist (display-only)
 *   - A "Test hello_world" button that round-trips through the SW
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

const ALLOWLIST = ["linear.app/*", "notion.so/*", "mail.google.com/*"];

interface ConnectionState {
  connected: boolean;
  reason?: string;
  updatedAt: number;
}

interface HelloResult {
  greeting: string;
  from: string;
  receivedAt: number;
}

interface SwResp<T> {
  ok: boolean;
  result?: T;
  error?: string;
  state?: ConnectionState;
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 14, margin: "0 0 8px", fontWeight: 600 },
  status: { padding: "8px 10px", borderRadius: 6, marginBottom: 10, fontWeight: 500 },
  connected: { background: "#e8f7ee", color: "#0a6d2c" },
  disconnected: { background: "#fdecea", color: "#8a1c1c" },
  section: { marginTop: 12 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 4 },
  list: { margin: 0, paddingLeft: 18, color: "#333" },
  button: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #d0d0d0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 8,
  },
  resultBox: {
    marginTop: 8,
    padding: 8,
    background: "#f3f4f6",
    borderRadius: 6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};

function App(): React.ReactElement {
  const [state, setState] = React.useState<ConnectionState | null>(null);
  const [helloResult, setHelloResult] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = () => {
      chrome.runtime.sendMessage(
        { kind: "conduit/popup-get-state" },
        (resp: SwResp<unknown>) => {
          if (cancelled) return;
          if (chrome.runtime.lastError) {
            const next: ConnectionState = {
              connected: false,
              updatedAt: Date.now(),
            };
            const reason = chrome.runtime.lastError.message;
            if (reason !== undefined) next.reason = reason;
            setState(next);
            return;
          }
          if (resp?.ok && resp.state) {
            setState(resp.state);
          }
        },
      );
    };
    fetchState();
    const id = window.setInterval(fetchState, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const onTestHello = (): void => {
    setBusy(true);
    setHelloResult("");
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-test-hello", name: "popup" },
      (resp: SwResp<HelloResult>) => {
        setBusy(false);
        if (chrome.runtime.lastError) {
          setHelloResult(`error: ${chrome.runtime.lastError.message}`);
          return;
        }
        if (resp?.ok && resp.result) {
          setHelloResult(JSON.stringify(resp.result, null, 2));
        } else {
          setHelloResult(`error: ${resp?.error ?? "unknown"}`);
        }
      },
    );
  };

  const connected = state?.connected === true;

  return (
    <div>
      <h1 style={styles.h1}>Conduit</h1>
      <div
        style={{
          ...styles.status,
          ...(connected ? styles.connected : styles.disconnected),
        }}
      >
        {connected ? "NMH connected" : "NMH not connected"}
        {!connected && state?.reason ? (
          <div style={{ fontWeight: 400, marginTop: 4, fontSize: 11 }}>
            {state.reason}
          </div>
        ) : null}
      </div>

      <div style={styles.section}>
        <div style={styles.label}>M0 allowlist (display only)</div>
        <ul style={styles.list}>
          {ALLOWLIST.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div style={styles.section}>
        <button
          type="button"
          style={styles.button}
          onClick={onTestHello}
          disabled={busy}
        >
          {busy ? "Testing..." : "Test hello_world"}
        </button>
        {helloResult ? <pre style={styles.resultBox}>{helloResult}</pre> : null}
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
