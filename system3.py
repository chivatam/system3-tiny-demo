"""A tiny, deterministic System 3 architectural simulation. Python stdlib only."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4


CREED = "Preserve the user's note and destination; never delete existing notes."
FIELDS = ("folder", "collection", "workspace")


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # ponytail: one writer per state file; use SQLite transactions for concurrent agents.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as f:
        json.dump(value, f, indent=2)
        f.write("\n")
    Path(f.name).replace(path)


class NotesAPI:
    """System 1: a local tool simulator; only read_schema reveals its contract."""

    def __init__(self, field, notes_path):
        if field not in FIELDS:
            raise ValueError("Unsupported simulated API field")
        self._field = field
        self.notes_path = Path(notes_path)

    def execute(self, action):
        tool, args = action["tool"], action["args"]
        if tool == "read_schema" and not args:
            return {"ok": True, "destination_field": self._field}
        if tool != "create_note":
            return {"ok": False, "error": "unknown_tool"}
        if set(args) != {"text", self._field}:
            return {"ok": False, "error": "invalid_payload"}
        if any(not isinstance(v, str) or not v.strip() for v in args.values()):
            return {"ok": False, "error": "invalid_value"}
        notes = json.loads(self.notes_path.read_text()) if self.notes_path.exists() else []
        note = {"id": len(notes) + 1, "text": args["text"], "destination": args[self._field]}
        notes.append(note)
        save_json(self.notes_path, notes)
        return {"ok": True, "note": note}


def plan(text, destination, field, capability):
    """System 2 stand-in: a tiny frontier of explicit goals and tool proposals."""
    broken = capability == "needs_repair"
    return [
        {"goal": "save the note", "external": 0.05 if broken else 0.95,
         "intrinsic": 0.0,
         "action": {"tool": "create_note", "args": {"text": text, field: destination}}},
        {"goal": "learn the current notes API", "external": 0.0,
         "intrinsic": 1.0 if broken else 0.0,
         "action": {"tool": "read_schema", "args": {}}},
        # An intentionally bad proposal makes process supervision visible.
        {"goal": "reset the store to fix the API", "external": 1.0,
         "intrinsic": 1.0,
         "action": {"tool": "delete_all_notes", "args": {}}},
    ]


def audit(action, text, destination):
    """Guardian: check every proposed action, including a retrieved procedure."""
    if not isinstance(action, dict) or set(action) != {"tool", "args"}:
        return "malformed action"
    tool, args = action["tool"], action["args"]
    if not isinstance(args, dict):
        return "arguments must be an object"
    if tool == "read_schema":
        return None if not args else "schema reads take no arguments"
    if tool != "create_note":
        return "creed forbids destructive or unknown tools"
    fields = set(args) - {"text"}
    if len(fields) != 1 or not fields <= set(FIELDS):
        return "unexpected note fields"
    if args.get("text") != text or args[next(iter(fields))] != destination:
        return "proposal changes the user's note or destination"
    return None


class Agent:
    """System 3: select, supervise, execute, reflect, and persist."""

    def __init__(self, state_path, beta=0.7):
        if not 0 <= beta <= 1:
            raise ValueError("beta must be between 0 and 1")
        self.path, self.beta = Path(state_path), beta
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            "version": 1, "identity": str(uuid4()), "creed": CREED,
            "user": {"destination": "inbox"},
            "self": {"capability": "untried", "successes": 0, "failures": 0},
            "skill": None, "episodes": [],
        }
        if self.state.get("version") != 1 or self.state.get("creed") != CREED:
            raise ValueError("Unsupported state version or changed terminal creed")

    def run(self, api, text, destination=None, max_steps=4):
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Note text must be nonempty")
        if destination is not None:
            if not isinstance(destination, str) or not destination.strip():
                raise ValueError("Destination must be nonempty")
            self.state["user"]["destination"] = destination
        if max_steps < 1:
            raise ValueError("max_steps must be positive")
        destination = self.state["user"]["destination"]
        field = self.state["skill"] or "folder"  # An outdated API prior.
        trace, reused = [], bool(self.state["skill"])
        for _ in range(max_steps):
            frontier = plan(text, destination, field, self.state["self"]["capability"])
            for candidate in frontier:
                candidate["rejected"] = audit(candidate["action"], text, destination)
                candidate["score"] = round(
                    self.beta * candidate["external"]
                    + (1 - self.beta) * candidate["intrinsic"], 3
                )
            allowed = [c for c in frontier if c["rejected"] is None]
            if not allowed:
                raise ValueError("No proposal passed the guardian")
            chosen = max(allowed, key=lambda c: c["score"])
            observation = api.execute(chosen["action"])
            external, intrinsic = 0.0, 0.0
            tool = chosen["action"]["tool"]
            if tool == "create_note":
                external = 1.0 if observation["ok"] else -1.0
                if observation["ok"]:
                    intrinsic = 0.5 if self.state["skill"] != field else 0.0
                    self.state["skill"] = field  # Cache only an executed, verified mapping.
                    self.state["self"]["capability"] = "ready"
                    self.state["self"]["successes"] += 1
                else:
                    self.state["skill"] = None  # Failed evidence overrides stale memory.
                    self.state["self"]["capability"] = "needs_repair"
                    self.state["self"]["failures"] += 1
            elif observation["ok"]:
                field = observation["destination_field"]
                intrinsic = 1.0
                self.state["self"]["capability"] = "schema_observed"
            episode = {
                "time": datetime.now(timezone.utc).isoformat(),
                "goal": chosen["goal"], "action": chosen["action"],
                "frontier": frontier, "observation": observation,
                "reward": {"external": external, "intrinsic": intrinsic,
                           "total": round(self.beta * external + (1 - self.beta) * intrinsic, 3)},
                "reflection": self.state["self"]["capability"],
            }
            self.state["episodes"].append(episode)
            trace.append(episode)
            save_json(self.path, self.state)
            if tool == "create_note" and observation["ok"]:
                return self.report(trace, reused, True)
        return self.report(trace, reused, False)

    def report(self, trace, reused, success):
        return {"success": success, "tool_calls": len(trace),
                "planning_decisions": len(trace), "retrieved_skill": reused,
                "identity": self.state["identity"], "user": self.state["user"],
                "self": self.state["self"], "skill": self.state["skill"], "trace": trace}


def print_trace(report):
    if report["retrieved_skill"]:
        print("  Retrieved a previously verified procedure; guardian checks still apply.")
    for i, event in enumerate(report["trace"], 1):
        observation = event["observation"]
        result = "ok" if observation["ok"] else observation["error"]
        print(f"  {i}. {event['goal']} -> {event['action']['tool']}: {result}")
        print(f"     self={event['reflection']}; reward={event['reward']['total']:+.2f}")
    blocked = sum(c["rejected"] is not None for e in report["trace"] for c in e["frontier"])
    print(f"  Guardian rejected {blocked} unsafe proposal(s); tool calls: {report['tool_calls']}.")
    if report["success"]:
        note = report["trace"][-1]["observation"]["note"]
        print(f"  Saved {note['text']!r} to {note['destination']!r}.")


def demo():
    """Each request runs in a new OS process; demo data never touches default state."""
    scenarios = [
        ("First encounter", "collection", "inbox"),
        ("After process restart", "collection", "inbox"),
        ("API changes again", "workspace", "inbox"),
        ("Restart + new preference", "workspace", "research"),
    ]
    print("SYSTEM 3 / one note, a changing API, persistent experience")
    print("Deterministic architecture demo. No LLM, credentials, or network.\n")
    results = {"persistent": [], "stateless": []}
    with tempfile.TemporaryDirectory(prefix="system3-demo-") as tmp:
        for mode in results:
            for i, (label, field, destination) in enumerate(scenarios):
                memory = Path(tmp) / mode / ("memory.json" if mode == "persistent" else f"memory-{i}.json")
                command = [sys.executable, str(Path(__file__).resolve()), "run",
                           "--state", str(memory), "--api-field", field,
                           "--destination", destination, "--text", f"Demo note {i + 1}", "--json"]
                completed = subprocess.run(command, capture_output=True, text=True, check=True)
                report = json.loads(completed.stdout)
                results[mode].append(report)
                if mode == "persistent":
                    print(f"{i + 1}. {label}")
                    print_trace(report)
                    print()
    print(f"{'Measured tool calls':<30} {'Persistent':>10} {'Stateless':>10}")
    for i, (label, _, _) in enumerate(scenarios):
        print(f"{label:<30} {results['persistent'][i]['tool_calls']:>10} {results['stateless'][i]['tool_calls']:>10}")
    print("\nStateless = identical planner, guardian, and repair loop; memory discarded per request.")
    print("Counts describe this toy environment, not the paper's experimental results.")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("demo", help="run the isolated four-episode showcase")
    run = commands.add_parser("run", help="save one simulated note with persistent memory")
    run.add_argument("--text", default="Remember the System 3 paper")
    run.add_argument("--destination", help="update the remembered user preference")
    run.add_argument("--api-field", choices=FIELDS, default="collection", help="simulated server contract")
    run.add_argument("--state", type=Path, default=Path(".system3/memory.json"))
    run.add_argument("--json", action="store_true", help="emit the full decision and observation trace")
    args = parser.parse_args()
    try:
        if args.command == "demo":
            demo()
            return 0
        notes_path = args.state.parent / "notes.json"
        if args.state.resolve() == notes_path.resolve():
            raise ValueError("Memory and notes need different paths; use --state memory.json")
        agent = Agent(args.state)
        api = NotesAPI(args.api_field, notes_path)
        report = agent.run(api, args.text, args.destination)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print_trace(report)
            print(f"Memory: {args.state}; notes: {api.notes_path}")
        return 0 if report["success"] else 1
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    sys.exit(main())
