/**
 * Conduit popup.
 *
 * Surfaces:
 *   - NMH connection state (read from chrome.storage.session)
 *   - Registered site profiles + tools (from in-memory registry via SW)
 *     Tools are clickable: 0-param tools run via SW; param tools display
 *     a copyable run snippet.
 *   - Test hello_world (round-trip sanity check)
 *   - Record workflow stub (W3.T2)
 *
 * Width is owned by popup.html (320px on body, padding on #root). React
 * doesn't repeat width/padding here, otherwise children overflow.
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

interface RunToolResult {
  url: string;
  tabId: number;
  ranAt: number;
  outputs: Record<string, unknown>;
}

interface RecordingStateActive {
  status: "recording";
  tabId: number;
  startUrl: string;
  startedAt: number;
  eventCount: number;
}
interface RecordingStateIdle {
  status: "idle";
}
type RecordingState = RecordingStateActive | RecordingStateIdle;

interface TraceSummary {
  id: string;
  name: string;
  startUrl: string;
  endUrl: string;
  startedAt: number;
  endedAt: number;
  stepCount: number;
}

/** Minimal mirror of RecordedEvent — typed loosely so the popup can render
 * each variant without pulling the SW-internal type module. */
interface PopupRecordedEvent {
  type: "click" | "input" | "keydown" | "submit" | "navigation";
  t: number;
  target?: {
    tagName?: string;
    role?: string;
    ariaLabel?: string;
    text?: string;
    name?: string;
    inputType?: string;
  };
  value?: string;
  key?: string;
  url?: string;
  x?: number;
  y?: number;
}

interface TraceDetail {
  id: string;
  name: string;
  startUrl: string;
  endUrl: string;
  startedAt: number;
  endedAt: number;
  events: readonly PopupRecordedEvent[];
}

interface SwResp<T> {
  ok: boolean;
  result?: T;
  error?: string;
  state?: ConnectionState | RecordingState;
  profiles?: ProfileSummary[];
  traces?: TraceSummary[];
  trace?: TraceDetail;
}

const styles: Record<string, React.CSSProperties> = {
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
    background: "#fff",
    overflow: "hidden",
  },
  profileHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
    minWidth: 0,
  },
  profileName: { fontSize: 13, fontWeight: 600, flexShrink: 0 },
  profilePattern: {
    fontSize: 10,
    color: "#888",
    fontFamily: "ui-monospace, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl", // ellipsize on the LEFT so we keep the path visible
    textAlign: "left",
    minWidth: 0,
    flex: "1 1 auto",
  },
  toolList: { margin: 0, padding: 0, listStyle: "none" },
  toolItem: {
    padding: "6px 4px",
    borderRadius: 4,
    cursor: "pointer",
    transition: "background 0.1s ease",
  },
  toolItemHover: { background: "#f3f4f6" },
  toolItemRunning: { background: "#fef9c3" },
  toolRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 11,
    minWidth: 0,
  },
  toolName: {
    fontFamily: "ui-monospace, monospace",
    color: "#222",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: "1 1 auto",
  },
  toolBadge: {
    fontSize: 9,
    padding: "1px 5px",
    borderRadius: 3,
    background: "#fee",
    color: "#a33",
    fontWeight: 600,
    flexShrink: 0,
  },
  toolDesc: {
    color: "#555",
    fontSize: 10,
    marginTop: 2,
    wordBreak: "break-word",
    overflowWrap: "break-word",
  },
  toolHint: {
    marginTop: 4,
    padding: 6,
    background: "#f3f4f6",
    borderRadius: 4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 10,
    color: "#444",
    overflowWrap: "anywhere",
  },
  toolResult: {
    marginTop: 4,
    padding: 6,
    background: "#ecfdf5",
    color: "#065f46",
    borderRadius: 4,
    fontSize: 10,
    wordBreak: "break-all",
  },
  toolError: {
    marginTop: 4,
    padding: 6,
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 4,
    fontSize: 10,
    wordBreak: "break-word",
  },
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
    boxSizing: "border-box",
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
    boxSizing: "border-box",
  },
  recordingBanner: {
    padding: "8px 10px",
    borderRadius: 6,
    marginTop: 6,
    background: "#fff1f2",
    color: "#9f1239",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#dc2626",
    boxShadow: "0 0 0 0 rgba(220, 38, 38, 0.6)",
    animation: "conduitPulse 1.4s infinite",
    flexShrink: 0,
  },
  buttonDanger: {
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#9f1239",
  },
  traceCard: {
    border: "1px solid #e5e5e5",
    borderRadius: 6,
    padding: 6,
    marginBottom: 6,
    background: "#fff",
    fontSize: 11,
  },
  traceHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 0,
  },
  traceName: {
    fontFamily: "ui-monospace, monospace",
    color: "#222",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: "1 1 auto",
  },
  traceMeta: { fontSize: 10, color: "#777", marginTop: 2 },
  traceCardClickable: { cursor: "pointer" },
  traceExpanded: {
    marginTop: 6,
    paddingTop: 6,
    borderTop: "1px solid #f0f0f0",
  },
  traceUrlRow: {
    fontSize: 10,
    color: "#666",
    fontFamily: "ui-monospace, monospace",
    overflowWrap: "anywhere",
    marginBottom: 4,
  },
  eventList: { margin: 0, padding: 0, listStyle: "none" },
  eventItem: {
    display: "flex",
    gap: 6,
    fontSize: 10,
    padding: "2px 0",
    color: "#333",
  },
  eventType: {
    fontFamily: "ui-monospace, monospace",
    color: "#0a6d2c",
    flexShrink: 0,
    minWidth: 56,
  },
  eventBody: { overflowWrap: "anywhere", color: "#444" },
  iconButton: {
    border: "none",
    background: "transparent",
    color: "#888",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
    flexShrink: 0,
  },
};

const KEYFRAMES = `
@keyframes conduitPulse {
  0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6); }
  70%  { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
}
`;

interface ToolRunState {
  status: "idle" | "running" | "ok" | "error";
  message?: string;
}

function ToolRow({
  profile,
  tool,
  onRun,
  state,
}: {
  profile: ProfileSummary;
  tool: ProfileToolSummary;
  onRun: () => void;
  state: ToolRunState;
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  const hasParams = tool.paramNames.length > 0;
  const fqName = `${profile.name}.${tool.name}`;
  const sig = `${fqName}(${tool.paramNames.join(", ")})`;

  const itemStyle: React.CSSProperties = {
    ...styles.toolItem,
    ...(state.status === "running" ? styles.toolItemRunning : {}),
    ...(hover && state.status !== "running" ? styles.toolItemHover : {}),
  };

  return (
    <li
      style={itemStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={hasParams ? undefined : onRun}
      title={hasParams ? "Has parameters — call from MCP client" : "Click to run"}
    >
      <div style={styles.toolRow}>
        <span style={styles.toolName}>{sig}</span>
        {tool.mutates ? <span style={styles.toolBadge}>mutates</span> : null}
      </div>
      <div style={styles.toolDesc}>{tool.description}</div>
      {hasParams ? (
        <div style={styles.toolHint}>
          run_profile_tool {"{"}profileName: "{profile.name}", toolName: "
          {tool.name}", args: {"{"}…{"}"}
          {"}"}
        </div>
      ) : null}
      {state.status === "running" ? (
        <div style={styles.toolHint}>running…</div>
      ) : null}
      {state.status === "ok" && state.message ? (
        <div style={styles.toolResult}>{state.message}</div>
      ) : null}
      {state.status === "error" && state.message ? (
        <div style={styles.toolError}>{state.message}</div>
      ) : null}
    </li>
  );
}

function ProfileCard({
  profile,
  toolStates,
  onRunTool,
}: {
  profile: ProfileSummary;
  toolStates: Record<string, ToolRunState>;
  onRunTool: (toolName: string) => void;
}): React.ReactElement {
  return (
    <div style={styles.profileCard}>
      <div style={styles.profileHeader}>
        <div style={styles.profileName}>{profile.displayName}</div>
        <div style={styles.profilePattern} title={profile.urlPatterns[0]}>
          {/* RTL on the parent flips display order; bdi keeps the URL itself LTR */}
          <bdi>{profile.urlPatterns[0]}</bdi>
        </div>
      </div>
      <ul style={styles.toolList}>
        {profile.tools.map((t) => (
          <ToolRow
            key={t.name}
            profile={profile}
            tool={t}
            onRun={() => onRunTool(t.name)}
            state={toolStates[t.name] ?? { status: "idle" }}
          />
        ))}
      </ul>
    </div>
  );
}

function summarizeEvent(ev: PopupRecordedEvent): string {
  const target = ev.target;
  const label =
    target?.ariaLabel ||
    target?.text ||
    target?.name ||
    (target?.tagName ? `<${target.tagName}>` : "");
  switch (ev.type) {
    case "click":
      return label || `(${ev.x ?? "?"}, ${ev.y ?? "?"})`;
    case "input":
      return `${label || "field"} = ${JSON.stringify(ev.value ?? "")}`;
    case "keydown":
      return `${ev.key ?? "?"}${label ? ` on ${label}` : ""}`;
    case "submit":
      return label || "form";
    case "navigation":
      return ev.url ?? "";
  }
}

function fmtTimeAgo(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function App(): React.ReactElement {
  const [state, setState] = React.useState<ConnectionState | null>(null);
  const [profiles, setProfiles] = React.useState<ProfileSummary[]>([]);
  const [toolStates, setToolStates] = React.useState<
    Record<string, Record<string, ToolRunState>>
  >({});
  const [helloResult, setHelloResult] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [recState, setRecState] = React.useState<RecordingState>({ status: "idle" });
  const [traces, setTraces] = React.useState<TraceSummary[]>([]);
  const [recError, setRecError] = React.useState<string>("");
  const [expandedTrace, setExpandedTrace] = React.useState<TraceDetail | null>(null);

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
          if (resp?.ok && resp.state && "connected" in resp.state) {
            setState(resp.state);
          }
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

  React.useEffect(() => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-list-profiles" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok && resp.profiles) setProfiles(resp.profiles);
      },
    );
  }, []);

  // Recording state — poll while popup is open so the event count animates.
  const refreshRecState = React.useCallback((): void => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-get-recording-state" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok && resp.state && "status" in resp.state) {
          setRecState(resp.state as RecordingState);
        }
      },
    );
  }, []);
  const refreshTraces = React.useCallback((): void => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-list-traces" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok && resp.traces) setTraces(resp.traces);
      },
    );
  }, []);
  React.useEffect(() => {
    refreshRecState();
    refreshTraces();
    const id = window.setInterval(refreshRecState, 1000);
    return (): void => window.clearInterval(id);
  }, [refreshRecState, refreshTraces]);

  const onStartRecord = (): void => {
    setRecError("");
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-start-recording" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) {
          setRecError(chrome.runtime.lastError.message ?? "send failed");
          return;
        }
        if (resp?.ok) {
          if (resp.state && "status" in resp.state)
            setRecState(resp.state as RecordingState);
        } else {
          setRecError(resp?.error ?? "failed to start");
        }
      },
    );
  };
  const onStopRecord = (): void => {
    setRecError("");
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-stop-recording" },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) {
          setRecError(chrome.runtime.lastError.message ?? "send failed");
          return;
        }
        setRecState({ status: "idle" });
        refreshTraces();
        if (!resp?.ok) setRecError(resp?.error ?? "stop failed");
      },
    );
  };
  const onDeleteTrace = (id: string): void => {
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-delete-trace", id },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok) {
          if (expandedTrace?.id === id) setExpandedTrace(null);
          refreshTraces();
        }
      },
    );
  };
  const onToggleTrace = (id: string): void => {
    if (expandedTrace?.id === id) {
      setExpandedTrace(null);
      return;
    }
    chrome.runtime.sendMessage(
      { kind: "conduit/popup-get-trace", id },
      (resp: SwResp<unknown>) => {
        if (chrome.runtime.lastError) return;
        if (resp?.ok && resp.trace) setExpandedTrace(resp.trace);
      },
    );
  };

  const setToolState = React.useCallback(
    (profileName: string, toolName: string, ts: ToolRunState): void => {
      setToolStates((prev) => ({
        ...prev,
        [profileName]: { ...(prev[profileName] ?? {}), [toolName]: ts },
      }));
    },
    [],
  );

  const onRunTool = React.useCallback(
    (profileName: string, toolName: string): void => {
      setToolState(profileName, toolName, { status: "running" });
      chrome.runtime.sendMessage(
        { kind: "conduit/popup-run-tool", profileName, toolName, args: {} },
        (resp: SwResp<RunToolResult>) => {
          if (chrome.runtime.lastError) {
            setToolState(profileName, toolName, {
              status: "error",
              message: chrome.runtime.lastError.message ?? "unknown error",
            });
            return;
          }
          if (resp?.ok && resp.result) {
            const r = resp.result;
            const outputKeys = Object.keys(r.outputs);
            const summary =
              outputKeys.length === 0
                ? "ran (no outputs)"
                : `outputs: ${outputKeys.join(", ")}`;
            setToolState(profileName, toolName, {
              status: "ok",
              message: `${summary} on ${r.url}`,
            });
          } else {
            setToolState(profileName, toolName, {
              status: "error",
              message: resp?.error ?? "unknown error",
            });
          }
        },
      );
    },
    [setToolState],
  );

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
      <style>{KEYFRAMES}</style>
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
        <div style={styles.label}>Profiles ({profiles.length})</div>
        {profiles.length === 0 ? (
          <div style={styles.emptyState}>No profiles registered.</div>
        ) : (
          profiles.map((p) => (
            <ProfileCard
              key={p.name}
              profile={p}
              toolStates={toolStates[p.name] ?? {}}
              onRunTool={(t) => onRunTool(p.name, t)}
            />
          ))
        )}
      </div>

      <div style={styles.section}>
        {recState.status === "recording" ? (
          <>
            <div style={styles.recordingBanner}>
              <span style={styles.recordingDot} />
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div style={{ fontWeight: 600 }}>Recording</div>
                <div
                  style={{
                    fontSize: 10,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={recState.startUrl}
                >
                  {recState.eventCount} events · {recState.startUrl}
                </div>
              </div>
            </div>
            <button
              type="button"
              style={{ ...styles.button, ...styles.buttonDanger }}
              onClick={onStopRecord}
            >
              Stop recording
            </button>
          </>
        ) : (
          <button type="button" style={styles.button} onClick={onStartRecord}>
            Record workflow on current tab
          </button>
        )}
        {recError ? (
          <div style={{ ...styles.toolError, marginTop: 6 }}>{recError}</div>
        ) : null}
      </div>

      <div style={styles.section}>
        <div style={styles.label}>Saved traces ({traces.length})</div>
        {traces.length === 0 ? (
          <div style={styles.emptyState}>No recordings yet.</div>
        ) : (
          traces.map((t) => {
            const isOpen = expandedTrace?.id === t.id;
            return (
              <div
                key={t.id}
                style={{ ...styles.traceCard, ...styles.traceCardClickable }}
                onClick={() => onToggleTrace(t.id)}
              >
                <div style={styles.traceHeader}>
                  <div style={styles.traceName} title={t.startUrl}>
                    {isOpen ? "▾ " : "▸ "}
                    {t.name}
                  </div>
                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTrace(t.id);
                    }}
                    title="Delete trace"
                    aria-label="Delete trace"
                  >
                    ×
                  </button>
                </div>
                <div style={styles.traceMeta}>
                  {t.stepCount} step{t.stepCount === 1 ? "" : "s"} ·{" "}
                  {fmtTimeAgo(t.endedAt)}
                </div>
                {isOpen && expandedTrace ? (
                  <div style={styles.traceExpanded}>
                    <div style={styles.traceUrlRow}>
                      <strong>start</strong> {expandedTrace.startUrl}
                    </div>
                    {expandedTrace.endUrl !== expandedTrace.startUrl ? (
                      <div style={styles.traceUrlRow}>
                        <strong>end</strong> {expandedTrace.endUrl}
                      </div>
                    ) : null}
                    <ul style={styles.eventList}>
                      {expandedTrace.events.map((ev, i) => (
                        <li key={i} style={styles.eventItem}>
                          <span style={styles.eventType}>{ev.type}</span>
                          <span style={styles.eventBody}>
                            {summarizeEvent(ev)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })
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
        {helloResult ? <pre style={styles.resultBox}>{helloResult}</pre> : null}
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
