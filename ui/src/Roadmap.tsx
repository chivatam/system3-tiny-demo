import {
  ArrowUpRight,
  Compass,
  Network,
  BookOpen,
  ScanEye,
  FlaskConical,
} from "lucide-react";
const stages = [
  {
    number: "01",
    title: "Ground the assistant in one environment",
    icon: Network,
    text: "Start with this repository and its project tracker. Build an inventory of tools, workflows, constraints, owners, and observable outcomes. Every belief needs a source and an expiry condition.",
    example:
      "“The release checklist refers to an old CI command. Which command actually verifies a release?”",
    proof:
      "Correct environment answers and completed work, with source-backed evidence.",
  },
  {
    number: "02",
    title: "Turn uncertainty into a learning goal",
    icon: Compass,
    text: "Keep a frontier of useful unknowns. Propose a bounded experiment, predict its information gain and future task value, then compare that value against time, cost, and risk. Measure what the experiment actually taught.",
    example:
      "“I have never tested the restore procedure. A rehearsal in a disposable environment would close a high-impact gap.”",
    proof:
      "Lower uncertainty and better future performance—not more browsing or more tokens.",
  },
  {
    number: "03",
    title: "Run a persistent executive",
    icon: ScanEye,
    text: "A durable queue chooses between user work and self-generated learning. It can pause exploration when a task arrives, resume safely, and stop when an experiment has no useful progress. Record rejected candidates as well as the chosen action.",
    example:
      "“A task arrived. Pause the documentation experiment and apply the verified deployment procedure.”",
    proof:
      "Responsive task handling, bounded spending, and recovery after interruption.",
  },
  {
    number: "04",
    title: "Build memory, a self-model, and a user model",
    icon: BookOpen,
    text: "Separate experiences, beliefs, procedures, preferences, and observed capabilities. Consolidate them with provenance, counterexamples, versioning, and uncertainty. Let the user inspect and correct their model.",
    example:
      "“This procedure passed three staging runs, but has no production evidence. The user prefers draft changes before publication.”",
    proof:
      "Accurate retrieval and calibration across changed tools, requirements, and preferences.",
  },
  {
    number: "05",
    title: "Evaluate continuous adaptation",
    icon: FlaskConical,
    text: "Run multi-day environments with real drift and held-out tasks. Compare plain Pi, memory alone, the executive, and curiosity enabled at equal budgets. Expand authority only when outcomes justify it.",
    example:
      "“Did last night’s exploration improve today’s unseen task, or just consume the budget?”",
    proof:
      "Task value, adaptation speed, useful learning per dollar, interruptions, and policy violations.",
  },
];
export function Roadmap() {
  return (
    <div className="roadmap">
      <div className="roadmap-intro">
        <div className="eyebrow">THE RESEARCH DIRECTION</div>
        <h1>
          From a repair loop
          <br />
          to a persistent colleague.
        </h1>
        <p>
          The observatory makes behavior inspectable. The next challenge is
          choosing worthwhile work and learning from an environment over time.
        </p>
        <a
          className="text-link"
          href="https://arxiv.org/html/2512.18202v1#S4.SS1.SSS3"
          target="_blank"
          rel="noreferrer"
        >
          Read Sophia’s executive architecture <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="honesty-banner">
        <Compass size={21} />
        <div>
          <strong>Current curiosity: reactive and hand-scored.</strong>
          <p>
            The fixture only explores after verification fails. It has no
            autonomous knowledge frontier, learned reward weighting, or
            continuous exploration loop.
          </p>
        </div>
      </div>
      <div className="roadmap-stages">
        {stages.map((stage) => (
          <article key={stage.number}>
            <div className="stage-number">{stage.number}</div>
            <div>
              <stage.icon size={21} />
              <h2>{stage.title}</h2>
              <p>{stage.text}</p>
              <blockquote>{stage.example}</blockquote>
              <div className="success-measure">
                <span>MEASURE SUCCESS BY</span>
                <p>{stage.proof}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="research-note">
        <h2>Curiosity needs a testable question.</h2>
        <p>
          For our implementation, a candidate should name the unknown, explain
          why it matters, propose the smallest experiment, predict the evidence
          it will yield, and specify a stopping condition. A surprising
          observation is useful only if it improves the assistant’s decisions.
        </p>
        <p>
          Sophia provides the research architecture. The stages above are our
          engineering proposal, not mechanisms already implemented here. Its
          pilot used inference-time memory rather than runtime model-weight
          updates.
        </p>
        <a
          className="text-link"
          href="https://github.com/chivatam/system3-tiny-demo/blob/main/docs/persistent-assistant-roadmap.md"
          target="_blank"
          rel="noreferrer"
        >
          Full implementation roadmap and coverage map{" "}
          <ArrowUpRight size={15} />
        </a>
      </div>
    </div>
  );
}
