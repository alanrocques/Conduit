/**
 * Conduit options page.
 *
 * For M0 this is just a placeholder that displays the extension ID — the user
 * needs to copy it into the NMH manifest's `allowed_origins`.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 22, margin: "0 0 8px", fontWeight: 600 },
  p: { lineHeight: 1.5, color: "#333" },
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
};

function App(): React.ReactElement {
  const extensionId = chrome.runtime?.id ?? "(unavailable)";
  const origin = `chrome-extension://${extensionId}/`;
  return (
    <div>
      <h1 style={styles.h1}>Conduit (M0 spike)</h1>
      <p style={styles.p}>
        Full options coming in M1. For now, this page just shows the extension
        ID you need to authorize in the Conduit Native Messaging Host (NMH)
        manifest.
      </p>

      <div style={styles.callout}>
        <strong>Extension ID</strong>
        <div style={styles.idBlock}>{extensionId}</div>
        <p style={{ ...styles.p, fontSize: 13, marginTop: 12 }}>
          Add the following origin to <code style={styles.code}>allowed_origins</code> in
          your <code style={styles.code}>com.conduit.bridge.json</code> NMH manifest:
        </p>
        <div style={styles.idBlock}>{origin}</div>
      </div>

      <p style={styles.p}>
        After updating the NMH manifest, reload this extension from{" "}
        <code style={styles.code}>chrome://extensions</code> and reopen the
        popup. It should report <em>NMH connected</em>.
      </p>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
