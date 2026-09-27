import { useState } from "react";
import { ArrowRight, Check, Code2, FileJson, Info, X } from "lucide-react";
import type { TraceEvent } from "../../pi/observatory-types.ts";
import { describe, pretty, words } from "./trace-view.ts";

function Code({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: unknown;
  tone?: string;
}) {
  return (
    <div className={`code-block ${tone}`}>
      <div className="code-label">
        <Code2 size={13} />
        {label}
      </div>
      <pre>{typeof value === "string" ? value : pretty(value)}</pre>
    </div>
  );
}
export function Inspector({ event }: { event?: TraceEvent }) {
  const [tab, setTab] = useState<"explanation" | "raw">("explanation");
  if (!event)
    return (
      <section className="inspector empty">
        <div className="empty-orbit">
          <Code2 size={28} />
        </div>
        <h2>Your agent’s work, made visible.</h2>
        <p>
          Start a repair. Select any event to see its inputs, decision, and
          observable result.
        </p>
        <div className="empty-flow">
          Observe <ArrowRight size={14} /> Decide <ArrowRight size={14} />{" "}
          Verify
        </div>
        <p className="muted">
          The first run takes about 5 seconds in scripted mode.
        </p>
      </section>
    );
  const { title, actor, explanation, tone } = describe(event);
  return (
    <section className="inspector" aria-label="Event inspector">
      <div className="panel-heading">
        <span>EVENT INSPECTOR</span>
        <span className="mono">
          #{String(event.seq).padStart(2, "0")} · +
          {(event.ms / 1000).toFixed(2)}s
        </span>
      </div>
      <div className="inspector-title">
        <span className={`badge ${tone}`}>{actor}</span>
        <h2>{title}</h2>
      </div>
      <div
        className="inspector-tabs"
        role="group"
        aria-label="Event detail format"
      >
        <button
          aria-pressed={tab === "explanation"}
          onClick={() => setTab("explanation")}
        >
          <Info size={14} />
          Explanation
        </button>
        <button aria-pressed={tab === "raw"} onClick={() => setTab("raw")}>
          <FileJson size={14} />
          Raw event
        </button>
      </div>
      {tab === "raw" ? (
        <Code label="Recorded JSON · schema v1" value={event} />
      ) : (
        <div className="event-detail">
          <p className="explanation">
            {explanation || "The controller ranked its available next steps."}
          </p>
          {event.event === "goal" && (
            <>
              <div className="detail-label">CANDIDATE DECISIONS</div>
              <table className="scores">
                <caption>
                  Fixed controller scores: 0.7 × external + 0.3 × intrinsic
                </caption>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Task</th>
                    <th>Intrinsic</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    event.candidates as {
                      goal: string;
                      external: number;
                      intrinsic: number;
                      score: number;
                    }[]
                  ).map((c) => (
                    <tr
                      key={c.goal}
                      className={c.goal === event.selected ? "chosen" : ""}
                    >
                      <th>
                        {c.goal.replaceAll("_", " ")}
                        {c.goal === event.selected && (
                          <span className="selected-label">SELECTED</span>
                        )}
                      </th>
                      <td>{c.external.toFixed(1)}</td>
                      <td>{c.intrinsic.toFixed(1)}</td>
                      <td>
                        <strong>{c.score.toFixed(2)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="callout">
                These are handwritten controller scores. Autonomous curiosity
                and learned goal valuation are still future work.
              </p>
            </>
          )}
          {event.event === "run_started" && (
            <>
              <div className="task-expectation">
                <span>Authorized task</span>
                <strong>
                  Return the note text and its destination under{" "}
                  <code>{words(event.field)}</code>.
                </strong>
              </div>
              <Code
                label="solution.cjs · initial contents"
                value={event.source}
              />
              <Code label="Configured execution limits" value={event.limits} />
            </>
          )}
          {event.event === "code_changed" && (
            <div className="diff">
              <Code
                label="Before · solution.cjs"
                value={event.before}
                tone="removed"
              />
              <div className="diff-arrow">
                <ArrowRight size={16} /> Actual file write
              </div>
              <Code
                label="After · solution.cjs"
                value={event.after}
                tone="added"
              />
            </div>
          )}
          {event.event === "tool_requested" && (
            <Code
              label={`${words(event.tool)} · requested arguments`}
              value={event.input}
            />
          )}
          {event.event === "observation" && (
            <Code
              label="Output delivered to Pi"
              value={(event.output as { type: string; text?: string }[])
                .map((part) => part.text ?? "")
                .join("\n")}
            />
          )}
          {event.event === "verification" && (
            <div className="verification-cases">
              {(
                event.checks as {
                  input: unknown;
                  expected: unknown;
                  actual: unknown;
                  passed: boolean;
                }[]
              ).map((check, index) => (
                <details key={index} open={index === 0}>
                  <summary>
                    <span className={check.passed ? "green-text" : "red-text"}>
                      {check.passed ? <Check size={15} /> : <X size={15} />}Case{" "}
                      {index + 1} · {check.passed ? "Passed" : "Failed"}
                    </span>
                    <span className="muted">Inspect payload</span>
                  </summary>
                  <Code label="Input" value={check.input} />
                  <div className="payload-comparison">
                    <Code label="Expected by host" value={check.expected} />
                    <Code
                      label="Actually returned"
                      value={check.actual}
                      tone={check.passed ? "added" : "removed"}
                    />
                  </div>
                </details>
              ))}
              {!(event.checks as unknown[]).length && (
                <p className="callout">
                  The candidate could not complete verification. No payload
                  results were accepted.
                </p>
              )}
            </div>
          )}
          {event.event === "memory_loaded" && (
            <>
              <Code
                label="Retrieved lesson · supplied to Pi"
                value={event.lesson ?? "No eligible lesson"}
              />
              <Code label="Memory at session start" value={event.memory} />
              {event.preferenceChanged === true && (
                <p className="callout">
                  The current instruction changes the destination to{" "}
                  <strong>{words(event.destination)}</strong>, overriding the
                  stored preference.
                </p>
              )}
            </>
          )}
          {event.event === "memory_invalidated" && (
            <Code
              label="Lesson removed from retrieval"
              value={event.lesson}
              tone="removed"
            />
          )}
          {event.event === "memory_saved" && (
            <>
              <Code label="Memory before this run" value={event.before} />
              <Code
                label="Memory saved after this run"
                value={event.after}
                tone={event.promoted ? "added" : ""}
              />
            </>
          )}
          {event.event === "context_prepared" && (
            <>
              <Code
                label="System prompt · exact application context"
                value={event.systemPrompt}
              />
              <Code label="Task prompt" value={event.userPrompt} />
            </>
          )}
          {event.event === "assistant_message" && (
            <div className="assistant-text">{words(event.text)}</div>
          )}
          {event.event === "model_response" && (
            <Code label="Provider-reported usage" value={event.usage} />
          )}
          {event.event === "capability_changed" && (
            <Code label="Observed capability" value={event.capability} />
          )}
          {event.event === "guardian" && (
            <div className={`decision-card ${tone}`}>
              <strong>
                {event.allowed ? "Execution authorized" : "Execution prevented"}
              </strong>
              <p>
                {event.allowed
                  ? "The tool handler may execute after this decision."
                  : "The requested operation was blocked before its handler ran."}
              </p>
              <code>{words(event.tool)}()</code>
            </div>
          )}
          {event.event === "model_wait" && (
            <div className="decision-card">
              <strong>
                {(Number(event.durationMs) / 1000).toFixed(2)} second delay
              </strong>
              <p>
                This waiting time is included in the run’s elapsed-time budget.
              </p>
            </div>
          )}
          {event.event === "run_finished" && (
            <div className="outcome-grid">
              <div>
                <strong>{String(event.toolCalls)}</strong>
                <span>Tools allowed</span>
              </div>
              <div>
                <strong>{String(event.modelCalls)}</strong>
                <span>Model requests</span>
              </div>
              <div>
                <strong>{String(event.repairs)}</strong>
                <span>Repair cycles</span>
              </div>
            </div>
          )}
          <p className="provenance">
            Source: actual {actor.toLowerCase()} event. Explanatory labels
            describe recorded behavior; they do not reconstruct private model
            reasoning.
          </p>
        </div>
      )}
    </section>
  );
}
