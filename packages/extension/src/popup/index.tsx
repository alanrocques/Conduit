/**
 * Conduit popup.
 *
 * Surfaces:
 *   - NMH connection state (read from chrome.storage.session, populated by SW)
 *   - Registered site profiles + their tools (read from in-memory registry
 *     via runtime.sendMessage)
 *   - "Test hello_world" — round-trip sanity check
 *   - "Record workflow" stub — placeholder for W3.T2
 *
 * Profile list is the authoritative allowlist surface in M1; the M0 hardcoded
 * list is gone.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

interface ConnectionState {
  connected: boolean;
  reason?: string;
  updatedAt: number;
}

interface ProfileToolSummary {
  name: string;
  description: string;
  mutates: boolean;
  paramNames: readonly string[];
}

interface ProfileSummary {
  name: string;
  displayName: string;
  urlPatterns: readonly string[];
  tools: readonly ProfileToolSummary[];
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
  profiles?: ProfileSummary[];
}

const styles: Record<string, React.CSSProperties> = {
  body: { width: 320, padding: 12, fontFamily: "system-ui, -apple-system, sans-serif" },
  h1: { fontSize: 14, margin: "0 0 8px", fontWeight: 600 },
  status: {
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 10,
    fontWeight: 500,
    fontSize: 12,
  },
  connected: { background: "#e8f7ee", color: "#0a6d2c" },
  disconnected: { background: "#fdecea", color: "#8a1c1c" },
  section: { marginTop: 12 },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#666",
    marginBottom: 6,
  },
  profileCard: {
    border: "1px solid #e5e5e5",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    background: "#fafafa",
  },
  profileHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  profileName: { fontSize: 13, fontWeight: 600 },
  profilePattern: { fontSize: 10, color: "#888", fontFamily: "ui-monospace, monospace" },
  toolList: { margin: 0, padding: 0, listStyle: "none" },
  toolRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    padding: "3px 0",
    fontSize: 11,
  },
  toolName: { fontFamily: "ui-monospace, monospace", color: "#222" },
  toolBadge: {
    fontSize: 9,
    padding: "1px 5px",
    borderRadius: 3,
    background: "#fee",
    color: "#a33",
    fontWeight: 600,
  },
  toolDesc: { color: "#555", fontSize: 10, marginTop: 1, marginLeft: 0 },
  emptyState: {
    fontSize: 11,
    color: "#888",
    padding: "8px 0",
    fontStyle: "italic",
  },
  button: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #d0d0d0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    marginTop: 6,
  },
  buttonDisabled: {
    cursor: "not-allowed",
    color: "#aaa",
    background: "#f4f4f4",
  },
  resultBox: {
    marginTop: 8,
    padding: 8,
    background: "#f3f4f6",
    borderRadius: 6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};

function ProfileCard({ profile }: { profile: ProfileSummary }): React.ReactElement {
  return (
    <div style={styles.profileCard}>
      <div style={styles.profileHeader}>
        <div style={styles.profileName}>{profile.displayName}</div>
        <div style={styles.profilePattern}>{profile.urlPatterns[0]}</div>
      </div>
      <ul style={styles.toolList}>
        {profile.tools.map((t) => (
          <li key={t.name}>
            <div style={styles.toolRow}>
              <span style={styles.toolName}>
                {profile.name}.{t.name}
                {t.paramNames.length > 0
                  ? `(${t.paramNames.join(", ")})`
                  : "()"}
              </span>
              {t.mutates ? <span style={styles.toolBadge}>mutates</span> : null}
            </div>
            <div style={styles.toolDesc}>{t.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function App(): React.ReactElement {
  const [state, setState] = React.useState<ConnectionState | null>(null);
  const [profiles, setProfiles] = React.useState<ProfileSummary[]>([]);
  const [helloResult, setHelloResult] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  // Connection state — poll because session storage might change after the
  // popup mounts (NMH reconnect, user reload).
  React.useEffect(() => {
    let cancelled = false;
    const fetchState = (): void => {
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
          if (resp?.ok && resp.state) setState(resp.state);
        },
      );
    };
    fetchState();
    const id = window.setInterval(fetchState, 1500);
    return (): void => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Profiles — fetch once. Registry is static for v0; recorded user profiles
  // (M3+) will need an explicit refresh trigger.
  React.useEffect(() => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-list-profiles" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok && resp.profiles) setProfiles(resp.profiles);
      },
    );
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
    <div style={styles.body}>
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
        <div style={styles.label}>
          Profiles ({profiles.length})
        </div>
        {profiles.length === 0 ? (
          <div style={styles.emptyState}>No profiles registered.</div>
        ) : (
          profiles.map((p) => <ProfileCard key={p.name} profile={p} />)
        )}
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
        <button
          type="button"
          style={{ ...styles.button, ...styles.buttonDisabled }}
          disabled
          title="Coming in M1 W3.T2"
        >
          Record workflow (coming soon)
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
