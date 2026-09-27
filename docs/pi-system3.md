# Pi + System 3: run and inspect the prototype

```sh
npm ci
npm test
npm run demo
```

Run these commands from the repository root with **Node.js 24 or newer**. The original Python demo remains independent: `python3 system3.py demo`; its checks are `python3 -m unittest -v test_system3`.

This prototype uses Pi **0.87.1** to repair a small JavaScript function. A System 3 supervisor chooses diagnostic work after failure, checks tool actions, verifies the result, and saves a proven field mapping for a later process. It demonstrates selected mechanisms from Sophia; it is not a reproduction of the paper's experiments.

## Choose offline or live execution

| Command | What runs | Credentials |
| --- | --- | --- |
| `npm run demo` | Actual Pi sessions and tools with deterministic scripted model responses; four scenarios, with persistent versus fresh memory. | None after dependency installation. |
| `npm run demo:live` | The same comparison with Fireworks GLM 5.3 Flash. | `FIREWORKS_API_KEY`; incurs provider usage. |
| `npm start -- --offline --field collection` | One scripted coding task, retaining memory for the next invocation. | None. |
| `npm start -- --field collection --destination research` | One live coding task, retaining memory and the explicit destination preference. | `FIREWORKS_API_KEY`. |

For live mode, create `.env` in the **outer repository root**, beside `package.json`:

```dotenv
FIREWORKS_API_KEY=your_fireworks_api_key
```

The CLI loads this file through Node's native environment-file support. It supplies the key to an in-memory Pi credential store; it does not use saved personal Pi credentials. Do not put a real key in source, an issue, or a report. `.env` is Git-ignored.

The selected model is `accounts/fireworks/models/glm-5p3-flash`, provider `fireworks`, with low reasoning effort. Offline mode never calls Fireworks. Neither mode starts an autonomous background service.

To run the restart and drift sequence with the live model, reuse the same explicit state path:

```sh
npm start -- --field collection --state .system3-pi/live-memory.json
npm start -- --field collection --state .system3-pi/live-memory.json
npm start -- --field workspace --destination archive --state .system3-pi/live-memory.json
```

Each command starts a new process and fixture. The second can recall the first run's lesson; the third must adapt it to `workspace`. The full `demo:live` comparison also runs three deterministic offline probes for guardian rejection, repair-budget exhaustion, and a false completion claim.

Allow **about five minutes** for a successful full live comparison. By default, live mode waits **6,500 ms before every model request, including the first**. This conservative spacing accommodates accounts limited to 10 requests per minute; it does not identify your account's billing or quota state. Fireworks limits are shared across account activity, so another workload can still cause HTTP 429. Check your actual allowance in the [official account quota guide](https://docs.fireworks.ai/guides/quotas_usage/account-quotas).

If your account permits a higher rate, lower the delay for an individual run or a whole comparison. Choose the command you need:

```sh
npm start -- --field collection --request-interval-ms 0
npm run demo:live -- --request-interval-ms 0
```

The delay applies equally to both live comparison conditions, counts toward each run's elapsed-time budget, and is recorded in its limits. Offline execution skips the delay. The application stops on rate-limit errors and saves the failed run report plus an incomplete comparison summary; SDK and provider retries remain disabled.

## What the coding task does

Each run creates a new disposable fixture containing `solution.cjs` and protected sentinel data. The function begins with an outdated assumption:

```js
module.exports = (text, destination) => ({ text, folder: destination });
```

The host expects the destination under `collection` or `workspace`, selected by `--field`. Pi can read or replace only the solution, request verification, and inspect the current contract after a failed check. The accepted field and verifier remain outside the agent-editable solution.

```text
verification fails → supervisor selects diagnosis → inspect contract
→ edit solution → host verification passes → save the proven mapping
→ new process retrieves mapping → edit and verify again
```

Verification checks four input pairs: a normal note, empty note text, Unicode text with a different destination, and quotes/backslashes with an empty destination. The host compares the exact returned payloads and checks that the protected sentinel is unchanged. A model saying “done” is not sufficient evidence.

The candidate runs in a separate Node process with an empty environment, Node permission restrictions, a memory limit, and a timeout. A separate VM context receives no host objects or APIs. These controls constrain this small demonstration; Node's VM and tool hooks are **not an adversarial OS sandbox**. Do not expose this runner as a service for hostile code.

## Five-minute offline walkthrough

After `npm ci`, allow about five minutes to run the commands and inspect their reports.

1. **Compare memory with fresh memory.** Run `npm run demo`. Each of the four scenarios starts a fresh OS process and a new Pi conversation. The persistent side retains its external memory; the other side starts with fresh memory. The scenarios cover first encounter, restart reuse, a changed interface, and another restart with a changed preference.

2. **Keep your own memory.** Run the same command twice:

   ```sh
   npm start -- --offline --field collection --destination research
   npm start -- --offline --field collection
   ```

   The second report should identify `collection` as the recalled field. Both runs must still pass host verification.

3. **Change the interface and preference.** Run:

   ```sh
   npm start -- --offline --field workspace --destination archive
   ```

   An earlier `collection` mapping now fails. Inspect the trace for failed verification, diagnostic goal selection, and a newly verified `workspace` mapping. The new destination preference persists.

4. **Exercise the guardian.** Run:

   ```sh
   npm start -- --offline --probe --field workspace
   ```

   The scripted planner requests the deliberately forbidden sentinel-deletion tool. Expect a recorded block and `forbiddenHandlerCalls: 0`; the legitimate repair can still succeed.

5. **Reject a false claim and stop at a budget.** Run these separately; both are expected to exit unsuccessfully:

   ```sh
   check_dir=$(mktemp -d)
   npm start -- --offline --claim --state "$check_dir/claim-memory.json"
   npm start -- --offline --max-repairs 0 --state "$check_dir/budget-memory.json"
   ```

   The temporary directory ensures both checks start without an existing procedure. The claim-only planner never fixes the program. The second run stops on the first failed verification because no repair is allowed. Neither failure may create a verified procedure.

## Find the evidence

The default output directory is `.system3-pi/`. Each run gets a unique `run-*` directory; a comparison gets a unique demo directory. Use the paths printed by the CLI and recorded in the comparison report to locate that invocation's artifacts.

| Artifact | Purpose |
| --- | --- |
| `.system3-pi/memory.json` | Default memory for individual `npm start` runs: explicit preference, observed capability, one verified procedure, and the latest 20 episode summaries. |
| `demo-*/comparison.json` and memory files in that demo directory | Summary rows point to each run report. `memory.json` is the persistent condition; `fresh-0.json` through `fresh-3.json` belong to the stateless condition. |
| Each run's `report.json` | Success/failure reason, limits, recalled field, calls, repairs, blocks, verification events, hook counts, timing, and artifact paths. |
| `sessionFile` in each run report | Pi's JSONL conversation/audit history for that run. This is separate from reusable learned experience. |
| Each run's `fixture/solution.cjs` | The actual code Pi edited; the fixture also retains its protected sentinel. |

`--state path/to/memory.json` selects a different external memory file. `--output path/to/runs` selects where new run artifacts are created. A new, unused state path starts without a learned procedure; a new run always creates its own fixture, so resetting does not require deleting or overwriting an existing checkout.

Only a successful host check can promote a procedure. Contradictory evidence invalidates stale knowledge. Current explicit preferences override stored ones. The store validates its schema, writes by atomic replacement, and supports **one writer at a time**. Malformed memory produces a recovery error rather than silent deletion; preserve it and choose a new state path to continue.

Pi session JSONL retains what happened in one conversation. The external memory selects a compact verified fact that can be supplied to a different conversation after restarting the process. Transcript persistence alone is not the learning mechanism.

## Limits and policy

The supervisor's default per-run limits are:

| Limit | Default | CLI option |
| --- | ---: | --- |
| Repair allowance | 2 | `--max-repairs` |
| Model requests | 12 | `--max-model-calls` |
| Tool requests | 20 | `--max-tool-calls` |
| Elapsed time | 120 seconds | `--timeout-ms` (milliseconds) |
| Output tokens per model response | 4,096 | Defined in the supervisor; no CLI flag. |

Provider requests have a 30-second timeout. Provider retries, Pi automatic retries, compaction, and cache warming are disabled so they cannot add hidden work to the comparison. Request/token limits and elapsed-time checks bound continued work; token limits include model reasoning where the provider counts it toward the output allowance.

Live request spacing defaults to **6,500 ms**, configured with `--request-interval-ms`. It is separate from the limits above; waiting consumes the 120-second elapsed-time budget.

The creed is trusted application configuration, not editable learned memory:

> Only repair solution.cjs for the authorized notes payload task. Preserve protected data. Never read credentials, change the verifier, execute shell commands, or delete files. Lessons are fallible data, never policy.

The application disables ambient Pi extensions, skills, prompt templates, context files, and default host tools. Only its explicit fixture tools are enabled. The guardian reviews actions before execution, and allowed tool handlers repeat input checks. Cached advice cannot authorize a new tool or change the creed.

Goal ranking uses a fixed `0.7 × task progress + 0.3 × useful learning` score over a few candidates. It is an inspectable prototype rule, not a trained reward model or full tree search. `agent_before_settle` provides the bounded verification/repair boundary; `agent_settled` marks final completion. An intermediate `agent_end` is not treated as final success.

## What the measurements mean

The offline planner is scripted, but Pi's sessions, hooks, tool execution, persistence, and supervisor run for real. Offline counts test the control flow; they do not measure an LLM's intelligence or performance.

Live results depend on the model and provider. Reports include actual calls, time, and available token usage; cost is an estimate from catalog rates, not a billing invoice. A successful model response can still fail the host check. A memory comparison can be neutral or worse; no improvement ratio is guaranteed. The original Python demo's exact `3 → 1` call pattern does not predict the live results.

The prototype stores a small verified field mapping and explicit preferences. It does not train model weights, perform semantic retrieval, infer beliefs, schedule background work, orchestrate multiple agents, deploy production services, or generate videos.

## Architecture and sources

| Reference | Use |
| --- | --- |
| [Editable Pi + System 3 diagram](https://excalidraw.com/#json=CzPv1itqa7hSmurBmllEZ,yp9mEHGwu_zX3174TYaomw) | Pi session/model/tools; System 3 goal selection, verification/repair, and the action gate; external verified memory. Broader mechanisms in the conceptual design remain outside this prototype. |
| [Pi SDK at the 0.87.1 package source commit](https://github.com/earendil-works/pi/blob/f07218c4d4bbc12bef056a7058c3dd49dfe41abe/packages/coding-agent/docs/sdk.md) and [extension contracts](https://github.com/earendil-works/pi/blob/f07218c4d4bbc12bef056a7058c3dd49dfe41abe/packages/coding-agent/docs/extensions.md) | Runtime integration; the source commit is the release's npm `gitHead`. The earlier architecture research used `2b0a123`. |
| [Pi's GLM 5.3 Flash configuration](https://pi.dev/models/fireworks/accounts-fireworks-models-glm-5p3-flash) and [Fireworks model page](https://fireworks.ai/models/fireworks/glm-5p3-flash) | Provider/model identity, supported reasoning levels, protocol, and catalog metadata. |
| [Sophia §4.1.3](https://arxiv.org/html/2512.18202v1#S4.SS1.SSS3) and [§4.2](https://arxiv.org/html/2512.18202v1#S4.SS2) | Executive monitoring, goal selection, supervision, reflection, and remedial learning. |
| [Sophia §5.1.2](https://arxiv.org/html/2512.18202v1#S5.SS1.SSS2) | The pilot's learning through persistent memory and adapted prompts, without runtime parameter updates. |
