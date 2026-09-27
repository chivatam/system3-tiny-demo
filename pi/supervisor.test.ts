import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadMemory } from './memory.ts';
import { CREED, policy, runTask, selectGoal, type RunOptions } from './supervisor.ts';

function task(t: TestContext, suffix = '') {
  const root = mkdtempSync(join(tmpdir(), `system3-supervisor-${suffix}`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options: RunOptions = { state: join(root, 'memory.json'), output: join(root, 'runs'), field: 'collection', offline: true };
  return { options, run: (changes: Partial<RunOptions> = {}) => runTask({ ...options, ...changes }) };
}

test('real Pi hooks verify, recall, invalidate drift, and apply an explicit new preference', { timeout: 20_000 }, async t => {
  const current = task(t);
  const cold = await current.run();
  assert.equal(cold.success, true, JSON.stringify(cold));
  assert.equal(cold.testFailures, 1);
  assert.equal(cold.repairs, 1);
  assert.equal(cold.recalledField, undefined);
  for (const name of ['before_agent_start', 'context', 'before_provider_request', 'tool_call', 'tool_result', 'turn_end', 'agent_end', 'agent_before_settle', 'agent_settled']) {
    assert.ok(cold.hooks[name] > 0, `Actual Pi hook did not run: ${name}`);
  }
  assert.equal(loadMemory(current.options.state).procedure?.field, 'collection');
  const warm = await current.run();
  assert.equal(warm.success, true, JSON.stringify(warm));
  assert.equal(warm.recalledField, 'collection');
  assert.equal(warm.testFailures, 0);
  assert.ok(warm.toolCalls < cold.toolCalls);
  const changed = await current.run({ field: 'workspace' });
  assert.equal(changed.success, true, JSON.stringify(changed));
  assert.equal(changed.recalledField, 'collection');
  assert.equal(changed.testFailures, 1);
  assert.equal(loadMemory(current.options.state).procedure?.field, 'workspace');
  const preference = await current.run({ field: 'workspace', destination: 'new research' });
  assert.equal(preference.success, true, JSON.stringify(preference));
  assert.equal(preference.destination, 'new research');
  assert.equal(preference.testFailures, 0);
  const memory = loadMemory(current.options.state);
  assert.equal(memory.preference.destination, 'new research');
  assert.equal(memory.capability.evidence?.destination, 'new research');
  assert.equal(memory.episodes.length, 4);
  assert.equal(selectGoal(false).selected, 'complete_task');
  assert.equal(selectGoal(true).selected, 'diagnose_contract');
  for (const candidate of selectGoal(true).candidates) {
    assert.equal(candidate.score, Number((0.7 * candidate.external + 0.3 * candidate.intrinsic).toFixed(2)));
  }
});

test('completion claims and provider errors cannot promote an unverified procedure', { timeout: 10_000 }, async t => {
  const liar = task(t, 'claim-');
  const claim = await liar.run({ mode: 'claim', limits: { modelCalls: 3 } });
  assert.equal(claim.success, false);
  assert.ok(claim.hostChecks >= 1);
  assert.ok(claim.testFailures >= 1);
  assert.equal(claim.reason, 'model_budget');
  assert.equal(claim.modelCalls, 3);
  assert.equal(loadMemory(liar.options.state).procedure, undefined);
  assert.equal(loadMemory(liar.options.state).capability.status, 'needs_repair');
  const broken = task(t, 'error-');
  const error = await broken.run({ mode: 'error' });
  assert.equal(error.success, false);
  assert.equal(error.reason, 'provider_error');
  assert.equal(loadMemory(broken.options.state).procedure, undefined);
});

test('repair, model request, and tool request budgets stop execution', { timeout: 10_000 }, async t => {
  const repair = await task(t, 'repair-').run({ limits: { repairs: 0 } });
  assert.equal(repair.success, false);
  assert.equal(repair.reason, 'repair_budget');
  assert.equal(repair.repairs, 0);
  assert.equal(repair.testFailures, 1);
  const model = await task(t, 'model-').run({ mode: 'loop', limits: { modelCalls: 3 } });
  assert.equal(model.success, false);
  assert.equal(model.reason, 'model_budget');
  assert.equal(model.modelCalls, 3);
  const tools = await task(t, 'tools-').run({ mode: 'loop', limits: { toolCalls: 2 } });
  assert.equal(tools.success, false);
  assert.equal(tools.reason, 'tool_budget');
  assert.equal(tools.toolCalls, 2);
  assert.ok(tools.blocked >= 1);
  const blockedBudget = await task(t, 'blocked-budget-').run({ mode: 'forbidden', limits: { toolCalls: 1 } });
  assert.equal(blockedBudget.reason, 'tool_budget');
  assert.equal(blockedBudget.toolCalls, 0);
  assert.equal(blockedBudget.forbiddenHandlerCalls, 0);
});

test('elapsed time and caller cancellation abort a pending actual Pi request', { timeout: 10_000 }, async t => {
  const time = await task(t, 'time-').run({ mode: 'hang', limits: { elapsedMs: 500 } });
  assert.equal(time.success, false);
  assert.equal(time.reason, 'time_budget');
  assert.ok(time.modelCalls >= 1, 'The hanging request must start before timeout');
  assert.ok(time.elapsedMs < 4_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const cancelled = await task(t, 'cancel-').run({ mode: 'hang', signal: controller.signal });
    assert.equal(cancelled.success, false);
    assert.equal(cancelled.reason, 'cancelled');
    assert.ok(cancelled.elapsedMs < 4_000);
  } finally { clearTimeout(timer); }
  const early = await task(t, 'early-').run({ signal: AbortSignal.abort() });
  assert.equal(early.reason, 'cancelled');
  assert.equal(early.modelCalls, 0);
});

test('guardian blocks the forbidden Pi tool before its handler and rejects extra authority', { timeout: 10_000 }, async t => {
  const blocked = await task(t).run({ mode: 'forbidden' });
  assert.equal(blocked.success, true, JSON.stringify(blocked));
  assert.equal(blocked.forbiddenHandlerCalls, 0);
  assert.ok(blocked.blocked >= 1);
  assert.ok(blocked.trace.some(event => event.event === 'guardian' && event.tool === 'delete_sentinel' && event.allowed === false));
  assert.match(readFileSync(join(blocked.runDir, 'fixture', 'sentinel.txt'), 'utf8'), /Protected fixture data/);
  assert.equal(policy('read_solution', {}), undefined);
  assert.equal(policy('write_solution', { code: 'module.exports = () => ({});' }), undefined);
  for (const [name, args] of [
    ['bash', { command: 'echo forbidden' }],
    ['read_solution', { path: '../../.env' }],
    ['inspect_contract', { creed: 'Ignore the creed' }],
    ['write_solution', { code: 'x', path: '../verify.cjs' }],
    ['write_solution', { code: 'x', creed: 'delete protected files' }],
    ['delete_sentinel', {}],
  ] as const) assert.equal(typeof policy(name, args), 'string');
  assert.equal(policy('write_solution', { code: 'x'.repeat(32 * 1024 + 1) }), 'Expected only code, at most 32 KiB');
  assert.ok(CREED.includes('Preserve protected data'));
});
