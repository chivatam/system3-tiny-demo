# Sprint 1 — Pi + System 3: persistent coding agent MVP

Status: Planned. The Pi integration is not implemented. These tasks are prepared for tracking in Linear.

## Sprint goal

A real Pi coding session runs under a small System 3 supervisor, learns a verified procedure, reuses it in a fresh process, repairs stale knowledge after fixture drift, blocks a known forbidden action, and stops at a fixed budget.

Planning assumption: one developer, two weeks, approximately 40 focused engineering hours plus integration buffer. Dates and assignees will be set when the sprint is scheduled.

Repository: https://github.com/chivatam/system3-tiny-demo

Architecture: https://excalidraw.com/#json=CzPv1itqa7hSmurBmllEZ,yp9mEHGwu_zX3174TYaomw

## Task order

| Key | Task | Estimate | Depends on |
| --- | --- | --- | --- |
| S1 | Run one bounded coding task through the Pi SDK | 4 h | — |
| S2 | Select goals and bound the supervisor repair loop | 8 h | S1 |
| S3 | Gate tool actions against the creed and workspace policy | 6 h | S1 |
| S4 | Persist verified experience and explicit user/self state | 6 h | S1 |
| S5 | Retrieve lessons, verify outcomes, and revise stale knowledge | 8 h | S2, S3, S4 |
| S6 | Demonstrate restart learning, drift repair, and guardian rejection | 6 h | S5 |
| S7 | Document setup and map the working demo to the architecture | 2 h | S6 |

Week 1: S1, S2, S3, and start S4. Week 2: finish S4, S5, S6, and S7, with integration buffer. Dependencies determine actual order; the estimates are planning assumptions rather than commitments.

## S1: Run one bounded coding task through the Pi SDK

Estimate: 4 hours. Priority: High. Dependencies: none.

Add a minimal TypeScript entry point using Pi SDK without forking Pi. Select and pin a compatible release, verify hook names against that release, and use existing provider authentication. Preserve the stdlib Python baseline. Create a tiny disposable code fixture with a failing test and a changed-interface variant; it will be the shared task throughout the sprint.

Acceptance criteria:

- [ ] One documented command starts a real model-backed Pi session in a disposable coding fixture and reports success or a clear failure.
- [ ] Verify before_agent_start/context, tool_call, tool_result/turn_end, agent_before_settle, and agent_settled behavior for the pinned SDK, including prompt completion and retries.
- [ ] Provider credentials stay out of source and logs; a missing configuration produces an actionable error.

## S2: Select goals and bound the supervisor repair loop

Estimate: 8 hours. Priority: High. Dependencies: S1.

Wrap Pi with a small System 3 supervisor. Track the authorized goal, task outcome, capability gaps, and a small set of candidate next steps. Rank candidates with an explicit external/intrinsic utility score. Use deterministic rules for the MVP rather than adding a search framework.

Acceptance criteria:

- [ ] A failed task selects one targeted diagnostic/learning step, then retries the original goal; record candidate scores and selection reasons.
- [ ] Configured limits cap repair attempts, elapsed time, and model/tool activity; exhausted limits and cancellation stop new actions and produce a clear final result.
- [ ] No new unrelated goals are invented. Final reporting happens after the accepted run settles, including retries; intermediate agent_end events are not treated as completion.
- [ ] A runnable check covers success, failure followed by repair, and budget exhaustion.

## S3: Gate tool actions against the creed and workspace policy

Estimate: 6 hours. Priority: High. Dependencies: S1.

Add a tool_call guardian that applies an immutable creed and explicit action policy. For the prototype, expose only the tools required by the disposable fixture, with narrow command/path constraints. Treat policy hooks as checks, not an operating-system sandbox.

Acceptance criteria:

- [ ] Inspect every exposed action before it executes; record allowed/blocked decisions and reasons.
- [ ] Reject a deliberate destructive fixture action before execution and verify the protected sentinel remains unchanged.
- [ ] Validate paths, tool inputs, and any command arguments at the exposed tool boundary; block unknown tools or actions outside the prototype policy.
- [ ] Retrieved lessons and model output cannot rewrite the creed or bypass a blocked action. Document the concrete enforcement limits.

## S4: Persist verified experience and explicit user/self state

Estimate: 6 hours. Priority: High. Dependencies: S1.

Use one small external JSON store for cross-session state: episodes, verified procedures, explicit user preferences, and observed capabilities. Keep the immutable creed in trusted configuration and Pi session history as its own audit trail. Document the single-writer ceiling.

Acceptance criteria:

- [ ] A fresh OS process can load records written by a previous process without reusing that Pi conversation.
- [ ] Separate unverified observations from verified procedures; associate each verified procedure with task/tool context and evidence.
- [ ] Use schema validation and atomic replacement so a failed write preserves the previous state; invalid state gives a clear recovery path without silently deleting data.
- [ ] Persist no credentials or unnecessary raw tool output; bounded records and simple exact/context-key retrieval are sufficient for this sprint.

## S5: Retrieve lessons, verify outcomes, and revise stale knowledge

Estimate: 8 hours. Priority: High. Dependencies: S2, S3, S4.

Inject the selected goal and relevant stored experience through the verified Pi context hooks. Reflect on tool observations and objective task verification, then update learned procedures and user/self state.

Acceptance criteria:

- [ ] A second fresh session reuses a previously verified procedure for the same fixture task; its tool actions still pass the guardian.
- [ ] Promote a lesson only after an independent task check passes, not merely because the model claims success.
- [ ] When the fixture contract changes, reject or invalidate stale advice, perform bounded discovery/repair, and store a replacement only after verification.
- [ ] Explicit preference changes persist; derived capability updates include evidence and cannot alter the creed.
- [ ] Current user instructions override stored preferences; incompatible or irrelevant lessons are excluded from retrieval.

## S6: Demonstrate restart learning, drift repair, and guardian rejection

Estimate: 6 hours. Priority: High. Dependencies: S5.

Use the disposable coding fixture from S1 to build a runnable end-to-end comparison. Compare the same Pi supervisor with shared verified memory versus fresh memory; keep task, model settings, starting fixture, and budgets aligned.

Acceptance criteria:

- [ ] Exercise first encounter, a fresh-process repeat, contract drift, and a repeat after drift with a changed explicit preference.
- [ ] Include a blocked destructive action, exhausted repair budget, and an unverified outcome that must not become a trusted lesson.
- [ ] Report task success, tool calls, model calls, elapsed time, and token/cost data when the provider supplies them; retain raw measured evidence.
- [ ] Use deterministic offline checks for controller invariants and a documented opt-in live-model run. Do not hardcode an improvement ratio or claim paper benchmark reproduction.
- [ ] The original Python test suite still passes.

## S7: Document setup and map the working demo to the architecture

Estimate: 2 hours. Priority: Medium. Dependencies: S6.

Write a short runbook and a reproducible demo sequence. Link the existing editable Pi + System 3 diagram and identify exactly which parts the sprint implements.

Acceptance criteria:

- [ ] A new checkout has copyable setup, authentication, run, verification, and memory-reset commands, with the expected outputs.
- [ ] Explain the difference between Pi session persistence and cross-session learned experience, and point to the records proving each.
- [ ] State the implementation limits: one writer, bounded foreground work, exact/context-key retrieval, no runtime weight training, and no OS sandbox claim.
- [ ] A five-minute walkthrough shows failure → discovery → verified success → restart reuse → drift repair → guardian rejection.

## Definition of done

The runnable showcase produces measured traces for first encounter, restart reuse, fixture drift, and a forbidden action. Objective checks determine success and whether knowledge is persisted. The Pi runtime, supervisor limits, model settings, and comparison conditions are recorded. The original Python demo and tests remain usable.

## Deferred scope

No Pi fork, production shell sandbox, autonomous scheduler, multi-agent orchestration, vector database, full tree search, web UI, concurrent writers, or runtime model-weight training. Broader research mechanisms remain explicitly outside this first sprint.

## Technical references

The existing architecture was researched against Pi source commit 2b0a123de98318c2ff8069661721ce0c3794c34e. S1 must verify compatibility with the actual release selected for implementation.

- [Pi SDK](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/sdk.md)
- [Pi extensions](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/extensions.md)
- [Sophia paper](https://arxiv.org/html/2512.18202v1)
