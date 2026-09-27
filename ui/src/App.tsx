import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Compass,
  Database,
  Download,
  GitBranch,
  History,
  Layers3,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import {
  SCENARIOS,
  type ObservatoryConfig,
  type RunInput,
  type RunListItem,
  type RunRecord,
  type TraceEvent,
} from "../../pi/observatory-types.ts";
import { describe, stateAt, words } from "./trace-view.ts";
import { Inspector } from "./Inspector.tsx";
import { Roadmap } from "./Roadmap.tsx";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}
const elapsed = (ms: number) =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
const eventIcon = (event: TraceEvent) =>
  event.event.startsWith("memory")
    ? Database
    : event.event === "guardian"
      ? ShieldCheck
      : event.event === "verification"
        ? event.ok
          ? Check
          : X
        : event.event === "goal"
          ? GitBranch
          : event.event === "code_changed"
            ? Terminal
            : Circle;

export default function App() {
  const [page, setPage] = useState<"runs" | "roadmap">("runs");
  const [config, setConfig] = useState<ObservatoryConfig>();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [record, setRecord] = useState<RunRecord>();
  const [index, setIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(750);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [input, setInput] = useState<RunInput>({
    mode: "offline",
    scenario: "learn",
    memory: "persistent",
    destination: "research",
  });
  const timeline = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    const [c, r] = await Promise.all([
      request<ObservatoryConfig>("/api/config"),
      request<RunListItem[]>("/api/runs"),
    ]);
    setConfig(c);
    setRuns(r);
    return { c, r };
  };
  useEffect(() => {
    let alive = true;
    Promise.all([
      request<ObservatoryConfig>("/api/config"),
      request<RunListItem[]>("/api/runs"),
    ])
      .then(([c, r]) => {
        if (!alive) return;
        setConfig(c);
        setRuns(r);
        setConnection("Connected");
        const id = c.activeRunId ?? r[0]?.id;
        if (id) {
          setSelectedId(id);
          setFollow(!!c.activeRunId);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setConnection("Disconnected");
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const source = new EventSource(`/api/runs/${selectedId}/events`);
    const update = (event: MessageEvent) => {
      const run = JSON.parse(event.data) as RunRecord;
      setRecord(run);
      setConnection("Connected");
      if (run.status !== "running") {
        source.close();
        void refresh().catch((e) => setError(e.message));
      }
    };
    source.addEventListener("snapshot", update);
    source.addEventListener("complete", update);
    source.addEventListener("trace", (event: MessageEvent) => {
      const next = JSON.parse(event.data) as TraceEvent;
      setRecord((prev) =>
        prev?.id === selectedId && !prev.events.some((e) => e.seq === next.seq)
          ? { ...prev, events: [...prev.events, next] }
          : prev,
      );
      setConnection("Connected");
    });
    source.onerror = () => setConnection("Reconnecting");
    return () => source.close();
  }, [selectedId]);
  useEffect(() => {
    const id = config?.activeRunId;
    if (!id || id === selectedId) return;
    const source = new EventSource(`/api/runs/${id}/events`);
    const update = (event: MessageEvent) => {
      if ((JSON.parse(event.data) as RunRecord).status !== "running") {
        source.close();
        void refresh().catch((e) => setError(e.message));
      }
    };
    source.addEventListener("snapshot", update);
    source.addEventListener("complete", update);
    return () => source.close();
  }, [config?.activeRunId, selectedId]);
  useEffect(() => {
    if (follow && record?.events.length) setIndex(record.events.length - 1);
  }, [follow, record?.events.length]);
  useEffect(() => {
    if (follow && timeline.current) {
      const row = timeline.current.querySelector<HTMLElement>(
        '[aria-current="step"]',
      );
      if (row)
        timeline.current.scrollTop =
          row.offsetTop -
          timeline.current.offsetTop -
          timeline.current.clientHeight +
          row.clientHeight;
    }
  }, [index, follow]);
  useEffect(() => {
    if (!playing || !record) return;
    if (index >= record.events.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((value) => value + 1), speed);
    return () => clearTimeout(timer);
  }, [playing, index, record, speed]);
  const active = record?.status === "running";
  const anyActive = active || !!config?.activeRunId;
  const scenario = SCENARIOS.find((s) => s.id === input.scenario)!;
  const selected = record?.events[Math.min(index, record.events.length - 1)];
  const state = stateAt(record?.events.slice(0, index + 1) ?? []);
  const visible =
    record?.events.filter(
      (e) =>
        filter === "all" ||
        (filter === "decisions" &&
          ["goal", "guardian", "verification", "stop"].includes(e.event)) ||
        (filter === "tools" &&
          ["tool_requested", "observation", "code_changed"].includes(
            e.event,
          )) ||
        (filter === "memory" && e.event.startsWith("memory")),
    ) ?? [];
  const selectEvent = (position: number) => {
    setIndex(position);
    setFollow(false);
    setPlaying(false);
  };
  const start = async () => {
    setBusy(true);
    setError("");
    setPlaying(false);
    try {
      const result = await request<RunRecord>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setRecord(result);
      setSelectedId(result.id);
      setIndex(0);
      setFollow(true);
      setFilter("all");
      setConfig((c) => ({
        fireworksAvailable: c?.fireworksAvailable ?? false,
        activeRunId: result.id,
      }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    try {
      await request(`/api/runs/${config?.activeRunId ?? record?.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="System 3 Observatory home">
          <span className="brand-mark">
            s3<span>·</span>
          </span>
          <span>
            System 3<small>AGENT OBSERVATORY</small>
          </span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "runs" ? "nav-item selected" : "nav-item"}
            onClick={() => setPage("runs")}
          >
            <Activity size={18} />
            Run explorer
            <span className="nav-dot" />
          </button>
          <button
            className={page === "roadmap" ? "nav-item selected" : "nav-item"}
            onClick={() => setPage("roadmap")}
          >
            <Compass size={18} />
            Toward Sophia
            <ArrowUpRight size={14} />
          </button>
        </nav>
        <div className="sidebar-context">
          <div className="sidebar-label">CONNECTED ENVIRONMENT</div>
          <div>
            <Terminal size={16} />
            <span>
              Notes coding fixture<small>Local · isolated task</small>
            </span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <p>
              Observe every action.
              <br />
              Trust verified outcomes.
            </p>
          </div>
          <span className="local-indicator">
            <span />
            LOCAL SESSION
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <Layers3 size={15} />
            <span>Research workspace</span>
            <ChevronRight size={12} />
            <strong>
              {page === "runs" ? "Run explorer" : "Development path"}
            </strong>
          </div>
          <span className="connection">
            <span
              className={
                connection === "Connected"
                  ? "status-dot"
                  : "status-dot amber-dot"
              }
            />
            {connection}
          </span>
        </header>
        <main id="main">
          {page === "roadmap" ? (
            <Roadmap />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PI + SYSTEM 3</div>
                  <h1>See the agent work.</h1>
                  <p>
                    The task: fix a notes function that uses an outdated API
                    field. Watch Pi test, investigate, repair, and remember.
                  </p>
                </div>
                <a
                  className="architecture-link"
                  href="https://excalidraw.com/#json=CzPv1itqa7hSmurBmllEZ,yp9mEHGwu_zX3174TYaomw"
                  target="_blank"
                  rel="noreferrer"
                >
                  Architecture <ArrowUpRight size={15} />
                </a>
              </div>
              <section className="control-panel" aria-label="Run configuration">
                <div className="scenario-tabs">
                  {SCENARIOS.map((s, i) => (
                    <button
                      key={s.id}
                      aria-pressed={input.scenario === s.id}
                      disabled={!!anyActive || busy}
                      onClick={() =>
                        setInput((v) => ({
                          ...v,
                          scenario: s.id,
                          destination:
                            s.id === "preference" ? "shipping" : "research",
                          mode: s.id === "guardian" ? "offline" : v.mode,
                        }))
                      }
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="scenario-description">
                  <GitBranch size={15} />
                  <p>{scenario.description}</p>
                </div>
                <div className="run-controls">
                  <label>
                    Execution
                    <select
                      value={input.mode}
                      disabled={!!anyActive || input.scenario === "guardian"}
                      onChange={(e) =>
                        setInput((v) => ({
                          ...v,
                          mode: e.target.value as RunInput["mode"],
                        }))
                      }
                    >
                      <option value="offline">
                        Scripted Pi · no API calls
                      </option>
                      <option value="live">Fireworks · GLM 5.3 Flash</option>
                    </select>
                  </label>
                  <label>
                    Memory
                    <select
                      value={input.memory}
                      disabled={!!anyActive}
                      onChange={(e) =>
                        setInput((v) => ({
                          ...v,
                          memory: e.target.value as RunInput["memory"],
                        }))
                      }
                    >
                      <option value="persistent">Keep verified lessons</option>
                      <option value="fresh">Fresh memory for this run</option>
                    </select>
                  </label>
                  <label className="destination-control">
                    Destination
                    <input
                      value={input.destination}
                      maxLength={80}
                      pattern="[\w -]{1,80}"
                      disabled={!!anyActive}
                      onChange={(e) =>
                        setInput((v) => ({ ...v, destination: e.target.value }))
                      }
                    />
                  </label>
                  <div className="run-actions">
                    {anyActive ? (
                      <button className="stop-button" onClick={cancel}>
                        <Square size={13} />
                        Stop run
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={
                          busy ||
                          !config ||
                          !/^[\w -]{1,80}$/.test(input.destination) ||
                          (input.mode === "live" && !config.fireworksAvailable)
                        }
                        onClick={start}
                      >
                        <Play size={15} fill="currentColor" />
                        {busy ? "Starting…" : "Run agent"}
                      </button>
                    )}
                    <span>
                      {input.mode === "offline"
                        ? "Actual Pi runtime · scripted model"
                        : config?.fireworksAvailable
                          ? "Key configured · incurs API usage"
                          : "Fireworks key is not configured"}
                    </span>
                  </div>
                </div>
              </section>
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button
                    onClick={() => {
                      setError("");
                      void refresh()
                        .then(() => setConnection("Connected"))
                        .catch((e) => setError(e.message));
                    }}
                  >
                    Retry connection
                  </button>
                </div>
              )}
              <div className="sr-only" role="status">
                {record
                  ? `Run ${record.status}. ${record.summary?.reason ?? ""}`
                  : "Ready to run"}
              </div>
              {record?.error && (
                <div className="error-banner" role="alert">
                  {record.error}
                </div>
              )}
              {record?.status === "stopped" && (
                <div className="error-banner" role="status">
                  Run stopped: {record.summary?.reason.replaceAll("_", " ")}.
                  Inspect the final event for details; a stopped run does not
                  promote a new lesson.
                </div>
              )}
              <div className="run-heading">
                <div>
                  <h2>
                    {record
                      ? SCENARIOS.find((s) => s.id === record.input.scenario)
                          ?.name
                      : "Your first run"}
                  </h2>
                  <span
                    className={`badge ${record?.status === "completed" ? "green" : record?.status === "stopped" || record?.status === "error" ? "amber" : ""}`}
                  >
                    {active ? (
                      <>
                        <Radio size={12} />
                        Live execution
                      </>
                    ) : record ? (
                      record.status === "completed" ? (
                        "Verified"
                      ) : (
                        record.status
                      )
                    ) : (
                      "Ready"
                    )}
                  </span>
                  {record && (
                    <span className="muted small">
                      {record.input.mode === "offline"
                        ? "Scripted Pi"
                        : "Fireworks GLM 5.3 Flash"}{" "}
                      ·{" "}
                      {record.input.memory === "persistent"
                        ? "Shared lessons"
                        : "Fresh memory"}
                    </span>
                  )}
                </div>
                <div className="run-meta">
                  {record?.summary && (
                    <span>
                      {record.summary.toolCalls} tools ·{" "}
                      {elapsed(record.summary.elapsedMs)}
                    </span>
                  )}
                  {record && (
                    <a
                      href={`/api/runs/${record.id}/export`}
                      className="icon-button"
                      aria-label="Download run trace"
                    >
                      <Download size={16} />
                    </a>
                  )}
                </div>
              </div>
              <div className="playback">
                <button
                  className="icon-button"
                  disabled={!record?.events.length}
                  aria-label={
                    playing ? "Pause replay" : "Replay recorded events"
                  }
                  onClick={() => {
                    setFollow(false);
                    if (index >= (record?.events.length ?? 0) - 1) setIndex(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Previous event"
                  disabled={!record || index === 0}
                  onClick={() => selectEvent(index - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next event"
                  disabled={!record || index >= record.events.length - 1}
                  onClick={() => selectEvent(index + 1)}
                >
                  <ChevronRight size={16} />
                </button>
                <label className="sr-only" htmlFor="event-position">
                  Replay position
                </label>
                <input
                  id="event-position"
                  type="range"
                  min={0}
                  max={Math.max(0, (record?.events.length ?? 1) - 1)}
                  value={index}
                  disabled={!record?.events.length}
                  onChange={(e) => selectEvent(Number(e.target.value))}
                />
                <span className="mono small">
                  {record?.events.length ? index + 1 : 0} /{" "}
                  {record?.events.length ?? 0}
                </span>
                <select
                  aria-label="Replay speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  <option value={1500}>0.5×</option>
                  <option value={750}>1×</option>
                  <option value={250}>3×</option>
                </select>
                <button
                  className={follow && active ? "follow active" : "follow"}
                  disabled={!active}
                  onClick={() => {
                    setFollow(true);
                    setPlaying(false);
                  }}
                >
                  <Radio size={13} />
                  Follow live
                </button>
              </div>
              <div className="observatory-grid">
                <section
                  className="timeline-panel"
                  aria-label="Execution trace"
                >
                  <div className="panel-heading">
                    <span>EXECUTION TRACE</span>
                    <select
                      aria-label="Filter trace"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All events</option>
                      <option value="decisions">Decisions</option>
                      <option value="tools">Tools</option>
                      <option value="memory">Memory</option>
                    </select>
                  </div>
                  <div className="timeline" ref={timeline}>
                    {visible.length ? (
                      visible.map((event) => {
                        const meta = describe(event),
                          Icon = eventIcon(event);
                        return (
                          <button
                            key={event.seq}
                            className={`trace-row ${selected?.seq === event.seq ? "is-selected" : ""}`}
                            aria-current={
                              selected?.seq === event.seq ? "step" : undefined
                            }
                            onClick={() => selectEvent(event.seq - 1)}
                          >
                            <span className={`trace-symbol ${meta.tone}`}>
                              <Icon size={14} />
                            </span>
                            <span className="trace-copy">
                              <span className="trace-actor">
                                {meta.actor}
                                <span className="mono">
                                  +{(event.ms / 1000).toFixed(1)}s
                                </span>
                              </span>
                              <strong>{meta.title}</strong>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="timeline-empty">
                        <Activity size={25} />
                        <p>
                          {record
                            ? "No events match this filter."
                            : "Your execution trace will appear here."}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
                <Inspector event={selected} />
                <aside
                  className="state-panel"
                  aria-label="State after selected event"
                >
                  <div className="panel-heading">
                    <span>STATE SNAPSHOT</span>
                    <span className="mono">
                      {selected ? `#${selected.seq}` : "—"}
                    </span>
                  </div>
                  <p className="state-caption">After the selected event</p>
                  <div className="state-section">
                    <span className="detail-label">
                      <GitBranch size={14} />
                      CURRENT GOAL
                    </span>
                    <strong>
                      {state.goal === "diagnose_contract"
                        ? "Diagnose the contract"
                        : "Complete the coding task"}
                    </strong>
                    <p>
                      {state.goal === "diagnose_contract"
                        ? "Resolve the observed gap before retrying."
                        : "Return a valid note payload."}
                    </p>
                  </div>
                  <div className="state-section">
                    <span className="detail-label">
                      <Database size={14} />
                      VERIFIED MEMORY
                    </span>
                    {state.memory?.procedure ? (
                      <div className="lesson">
                        <span>Destination field</span>
                        <code>{state.memory.procedure.field}</code>
                        <small>
                          {state.memory.procedure.evidence.cases} independent
                          checks · notes-create/v1
                        </small>
                      </div>
                    ) : (
                      <p>No verified procedure at this step.</p>
                    )}
                    <div className="state-pair">
                      <span>Preference</span>
                      <strong>
                        {state.memory?.preference.destination ?? "—"}
                      </strong>
                    </div>
                    <div className="state-pair">
                      <span>Capability</span>
                      <strong>
                        {state.memory?.capability.status.replaceAll("_", " ") ??
                          "unobserved"}
                      </strong>
                    </div>
                  </div>
                  <div className="state-section">
                    <span className="detail-label">
                      <Activity size={14} />
                      ACTIVITY SO FAR
                    </span>
                    <div className="state-metrics">
                      <div>
                        <strong>
                          {state.modelCalls}
                          <small>/ 12</small>
                        </strong>
                        <span>Model calls</span>
                      </div>
                      <div>
                        <strong>
                          {state.toolCalls}
                          <small>/ 20</small>
                        </strong>
                        <span>Tools allowed</span>
                      </div>
                    </div>
                  </div>
                  <div className="curiosity-note">
                    <Compass size={17} />
                    <strong>Curiosity, honestly</strong>
                    <p>
                      This controller diagnoses failures with fixed scores.
                      Open-ended exploration is not implemented.
                    </p>
                    <button onClick={() => setPage("roadmap")}>
                      See the development path <ArrowRight size={13} />
                    </button>
                  </div>
                  <details className="creed">
                    <summary>
                      <ShieldCheck size={14} />
                      Immutable action policy
                    </summary>
                    <p>
                      {words(
                        record?.events.find((e) => e.event === "run_started")
                          ?.creed,
                      ) ||
                        "Preserve protected data. Only repair the authorized solution. Verify outcomes before learning."}
                    </p>
                  </details>
                </aside>
              </div>
              <section className="history" aria-label="Run history">
                <div className="section-heading">
                  <h2>
                    <History size={17} />
                    Run history
                  </h2>
                  <span>Each run starts a fresh Pi process</span>
                </div>
                {runs.length ? (
                  <div className="history-list">
                    {runs.slice(0, 12).map((run) => (
                      <button
                        key={run.id}
                        className={
                          run.id === selectedId
                            ? "history-item selected"
                            : "history-item"
                        }
                        onClick={() => {
                          if (run.id === selectedId) return;
                          setSelectedId(run.id);
                          setRecord(undefined);
                          setIndex(0);
                          setFollow(run.status === "running");
                          setPlaying(false);
                          setFilter("all");
                        }}
                      >
                        <span
                          className={`history-status ${run.status === "completed" ? "green-text" : ""}`}
                        >
                          {run.status === "completed" ? (
                            <Check size={15} />
                          ) : run.status === "running" ? (
                            <Radio size={15} />
                          ) : (
                            <Square size={13} />
                          )}
                        </span>
                        <span>
                          <strong>
                            {
                              SCENARIOS.find((s) => s.id === run.input.scenario)
                                ?.name
                            }
                          </strong>
                          <small>
                            {run.input.mode === "offline"
                              ? "Scripted"
                              : "Fireworks"}{" "}
                            ·{" "}
                            {run.input.memory === "persistent"
                              ? "Shared"
                              : "Fresh"}{" "}
                            memory
                          </small>
                        </span>
                        <span className="history-count">
                          {run.summary
                            ? `${run.summary.toolCalls} tools`
                            : run.status}
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Completed and interrupted runs will stay here for
                    inspection.
                  </p>
                )}
              </section>
              <footer>
                <span>
                  <BrainCircuit size={14} />
                  System 3 Observatory
                </span>
                <span>Observed execution. Verifiable learning.</span>
                <a
                  href="https://arxiv.org/html/2512.18202v1"
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspired by Sophia <ArrowUpRight size={12} />
                </a>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
