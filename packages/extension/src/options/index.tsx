/**
 * Conduit options page.
 *
 * Two sections:
 *   1. Anthropic API key (BYOK) — stored in chrome.storage.session, cleared
 *      on browser restart. Used by the workflow synthesizer (W3.T3).
 *   2. Extension ID — needed once during NMH manifest install.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

const styles: Record<string, React.CSSProperties> = {
  body: {
    maxWidth: 640,
    margin: "24px auto",
    padding: "0 16px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#222",
  },
  h1: { fontSize: 22, margin: "0 0 8px", fontWeight: 600 },
  h2: { fontSize: 16, margin: "24px 0 8px", fontWeight: 600 },
  p: { lineHeight: 1.5, color: "#333" },
  smallNote: { fontSize: 12, color: "#666", marginTop: 4 },
  warningBox: {
    background: "#fff7e6",
    border: "1px solid #ffd591",
    padding: "10px 12px",
    borderRadius: 6,
    margin: "8px 0 12px",
    fontSize: 13,
    lineHeight: 1.5,
  },
  callout: {
    background: "#fff7e6",
    border: "1px solid #ffd591",
    padding: "12px 14px",
    borderRadius: 8,
    margin: "16px 0",
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    background: "#f3f4f6",
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 13,
  },
  idBlock: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    background: "#111",
    color: "#f4f4f5",
    padding: "10px 12px",
    borderRadius: 6,
    marginTop: 8,
    userSelect: "all",
    fontSize: 13,
  },
  inputRow: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    border: "1px solid #d0d0d0",
    borderRadius: 6,
  },
  button: {
    padding: "8px 14px",
    border: "1px solid #d0d0d0",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  },
  status: { marginTop: 8, fontSize: 13 },
  ok: { color: "#0a6d2c" },
  err: { color: "#8a1c1c" },
};

interface SwResp {
  ok: boolean;
  error?: string;
  present?: boolean;
}

function ApiKeySection(): React.ReactElement {
  const [value, setValue] = React.useState("");
  const [present, setPresent] = React.useState<boolean | null>(null);
  const [status, setStatus] = React.useState<string>("");
  const [statusKind, setStatusKind] = React.useState<"ok" | "err" | "">("");

  const refresh = React.useCallback((): void => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-get-api-key-status" },
      (resp: SwResp) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok) setPresent(resp.present === true);
      },
    );
  }, []);
  React.useEffect(refresh, [refresh]);

  const onSave = (): void => {
    setStatus("Saving…");
    setStatusKind("");
    chrome.runtime.sendMessage(
      { kind: "conduit/options-set-api-key", apiKey: value.trim() },
      (resp: SwResp) => {
        if (chrome.runtime.lastError) {
          setStatus(`Error: ${chrome.runtime.lastError.message}`);
          setStatusKind("err");
          return;
        }
        if (resp?.ok) {
          setStatus(value.trim() ? "Saved." : "Cleared.");
          setStatusKind("ok");
          setValue("");
          refresh();
        } else {
          setStatus(`Error: ${resp?.error ?? "unknown"}`);
          setStatusKind("err");
        }
      },
    );
  };

  return (
    <section>
      <h2 style={styles.h2}>Anthropic API key (BYOK)</h2>
      <p style={styles.p}>
        Used by the workflow synthesizer to convert recorded traces into tool
        definitions.
      </p>
      <div style={styles.warningBox}>
        <strong>Storage:</strong> session-only. The key lives in
        <code style={styles.code}>chrome.storage.session</code> — in memory,
        cleared every time you close the browser. Only enter your key on a
        machine you trust; it's still readable by any other extension you've
        granted access to <code style={styles.code}>chrome.storage</code>.
      </div>
      <div style={styles.inputRow}>
        <input
          type="password"
          placeholder={present ? "•••• key set ••••" : "sk-ant-…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={styles.input}
        />
        <button
          type="button"
          style={styles.button}
          onClick={onSave}
          disabled={value.trim().length === 0 && present !== true}
        >
          {value.trim() ? "Save" : "Clear"}
        </button>
      </div>
      <div style={styles.smallNote}>
        Status:{" "}
        {present === null
          ? "checking…"
          : present
            ? "key is set for this browser session"
            : "no key set"}
      </div>
      {status ? (
        <div
          style={{
            ...styles.status,
            ...(statusKind === "ok"
              ? styles.ok
              : statusKind === "err"
                ? styles.err
                : {}),
          }}
        >
          {status}
        </div>
      ) : null}
    </section>
  );
}

function App(): React.ReactElement {
  const extensionId = chrome.runtime?.id ?? "(unavailable)";
  const origin = `chrome-extension://${extensionId}/`;
  return (
    <div style={styles.body}>
      <h1 style={styles.h1}>Conduit</h1>

      <ApiKeySection />

      <h2 style={styles.h2}>Native Messaging Host setup</h2>
      <div style={styles.callout}>
        <strong>Extension ID</strong>
        <div style={styles.idBlock}>{extensionId}</div>
        <p style={{ ...styles.p, fontSize: 13, marginTop: 12 }}>
          Add this origin to{" "}
          <code style={styles.code}>allowed_origins</code> in your{" "}
          <code style={styles.code}>com.conduit.bridge.json</code> NMH
          manifest:
        </p>
        <div style={styles.idBlock}>{origin}</div>
        <p style={{ ...styles.p, fontSize: 13, marginTop: 12 }}>
          After updating the manifest, reload this extension from{" "}
          <code style={styles.code}>chrome://extensions</code> and reopen the
          popup.
        </p>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
