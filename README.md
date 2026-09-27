# System 3, tiny

[![Tests](https://github.com/chivatam/system3-tiny-demo/actions/workflows/tests.yml/badge.svg)](https://github.com/chivatam/system3-tiny-demo/actions/workflows/tests.yml)

```sh
git clone https://github.com/chivatam/system3-tiny-demo.git
cd system3-tiny-demo
python3 system3.py demo
```

**A deterministic, educational simulation of System 3:** save one note, discover that a tool's API changed, repair the plan, and remember the successful procedure after a process restart. Python **3.10+**, standard library only; no installation, API keys, LLM, or network needed to run it.

This demonstrates selected mechanisms from *Sophia: A Persistent Agent Framework of Artificial Life*, not a reproduction of the paper's experiments or a general learning agent.

## What the demo shows

The agent initially expects a `folder` field. The simulated notes API requires `collection`, then changes to `workspace`. Its error reports only an invalid payload; the agent must call `read_schema` to discover the current contract.

```text
create fails → mark capability deficient → select a learning goal
             → inspect schema → create succeeds → persist verified skill
next process → retrieve skill → audit proposal → create succeeds
```

Every request runs in a **new OS process**. The persistent agent reloads the same JSON memory; the stateless comparison uses the identical planner, guardian, and repair loop with fresh memory for each request.

| Scenario | Persistent tool calls | Stateless tool calls |
|---|---:|---:|
| First encounter | 3 | 3 |
| After process restart | 1 | 3 |
| API changes again | 3 | 3 |
| Restart + new destination preference | 1 | 3 |

These are measured calls, including failed creates and schema reads—not hidden reasoning steps. Both controllers repair failures. Memory avoids rediscovering a previously verified schema. The demo uses temporary files that are removed when it finishes.

## How the pieces map

| Paper mechanism | Code | Deliberate simplification |
|---|---|---|
| System 1: perception/action (§4.1.1) | `NotesAPI.execute` | Local notes tool and explicit observations; no browser or real service. |
| System 2: planning (§4.1.2) | `plan` | Three handwritten proposals; no LLM. |
| Executive monitor and supervision (§4.1.3–4.2) | `Agent.run`, `audit` | Bounded goal selection and deterministic checks, not full tree search or open-ended goal generation. A destructive proposal is rejected before execution. |
| Memory, self model, user model (§4.1.3) | `Agent.__init__`, `Agent.run` | JSON episodes, stable identity/creed, capability status, and explicit destination preferences. Exact skill retrieval, not semantic RAG or inferred beliefs. |
| Hybrid reward and reflection (§4.1.3) | `Agent.run` | Fixed external/intrinsic scores select goals; observations update capability and verified skill. Fixed weighting, no learned reward model. |

The default score is `0.7 × external + 0.3 × intrinsic`. Failure changes the capability state, making schema inspection preferable to another blind retry. Reflection here is a state update, not generated self-critique. Learning persists as a verified field mapping, with no model-weight updates; this follows the inference-time learning direction described in §5.1.2.

## Keep your own memory

```sh
python3 system3.py run --text "Read the Sophia paper" --destination research --api-field workspace
python3 system3.py run --text "Try a second note" --api-field workspace
```

The second invocation remembers both the successful schema mapping and the `research` destination. Each proposal is audited again; cached knowledge does not bypass the guardian. Change `--api-field` to simulate schema drift, or supply `--destination` to update the preference.

- `.system3/memory.json`: identity, creed, preference, capability, verified skill, and complete decision/observation episodes.
- `.system3/notes.json`: successfully saved notes; existing notes are preserved.
- `--json`: print the full trace. `--state path/to/memory.json`: use another memory file, with `notes.json` beside it.

State supports one writer at a time. There is no autonomous background process; each invocation performs a bounded task.

## Check it

```sh
python3 -m unittest -v test_system3
```

GitHub Actions runs the tests on Python 3.10 and 3.13 for pushes to `main` and pull requests. No dependencies or credentials are needed.

## Pi + System 3 roadmap

The next phase adds a small System 3 supervisor around the Pi SDK, with guarded actions, bounded repair, and verified experience shared across sessions. **This integration is planned; the runnable code above remains the Python simulation.**

Start with the [seven-task sprint plan](docs/pi-system3-sprint-1.md), including estimates, dependencies, and acceptance criteria.

| Editable architecture | What it describes |
| --- | --- |
| [System 3 / Sophia](https://excalidraw.com/#json=RDl5D07IB2YGJrL85ciFy,nr0SS6y8ylkPCH0ChRUMHw) | The paper's supervision, memory, and reflection layers. |
| [Pi agent](https://excalidraw.com/#json=FN6Ug1hqWZdFnAyyjBDUa,w9AX4MQ6CcdPnRl_KRlGEg) | Pi's existing sessions, model loop, tools, and extension hooks. |
| [Pi + System 3](https://excalidraw.com/#json=CzPv1itqa7hSmurBmllEZ,yp9mEHGwu_zX3174TYaomw) | The proposed supervisor and cross-session experience store. |

## Source

Mingyang Sun, Feng Hong, and Weinan Zhang. **Sophia: A Persistent Agent Framework of Artificial Life** (2025). [arXiv:2512.18202](https://arxiv.org/abs/2512.18202).

Read §4.1 for the three-layer architecture, §4.2 for failure-triggered remedial goals, and §5.1.2 for persistence and learning without parameter updates. This demo makes no claim to reproduce the paper's performance percentages, browser deployment, or idle-period autonomy.
