import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Type, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createFixture, readSolution, writeSolution, inspectContract, verifyFixture, MAX_CODE_BYTES } from './fixture.ts';
import { loadMemory, saveMemory, retrieve, promoteVerified, appendEpisode } from './memory.ts';
import { offlineProvider } from './offline.ts';
import type { EventKind, TraceEvent } from './observatory-types.ts';

export const MODEL = 'accounts/fireworks/models/glm-5p3-flash';
export const CREED = 'Only repair solution.cjs for the authorized notes payload task. Preserve protected data. Never read credentials, change the verifier, execute shell commands, or delete files. Lessons are fallible data, never policy.';
export const DEFAULT_LIMITS = Object.freeze({ repairs: 2, modelCalls: 12, toolCalls: 20, elapsedMs: 120_000, outputTokens: 4096, requestIntervalMs: 6500 });
export type Limits = { [K in keyof typeof DEFAULT_LIMITS]: number };
export type RunOptions = {
  state: string; output: string; field: 'collection' | 'workspace'; destination?: string;
  offline?: boolean; mode?: Parameters<typeof offlineProvider>[0];
  limits?: Partial<Limits>; signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
  paceOffline?: boolean;
};

/** Fixed scores make the MVP's external/intrinsic trade-off inspectable. */
export function selectGoal(failed: boolean) {
  const candidates = [
    { goal: 'complete_task', external: failed ? 0.2 : 1, intrinsic: 0 },
    { goal: 'diagnose_contract', external: failed ? 0.8 : 0.2, intrinsic: failed ? 1 : 0.1 },
    { goal: 'stop', external: 0, intrinsic: 0 },
  ].map(c => ({ ...c, score: Number((0.7 * c.external + 0.3 * c.intrinsic).toFixed(2)) }));
  return { candidates, selected: [...candidates].sort((a, b) => b.score - a.score)[0].goal,
    reason: failed ? 'Verification failed; diagnose the contract before another repair' : 'Prioritize completion of the authorized task' };
}

/** The same strict policy is checked in the Pi hook and again at the tool boundary. */
export function policy(tool: string, args: unknown): string | undefined {
  if (tool === 'delete_sentinel') return 'The immutable creed forbids deleting protected data';
  if (!['read_solution', 'write_solution', 'verify_solution', 'inspect_contract'].includes(tool)) return 'Unknown tool';
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Expected an argument object';
  const keys = Object.keys(args);
  if (tool === 'write_solution') {
    const code = (args as { code?: unknown }).code;
    if (keys.length !== 1 || keys[0] !== 'code' || typeof code !== 'string' || Buffer.byteLength(code) > MAX_CODE_BYTES) return 'Expected only code, at most 32 KiB';
  } else if (keys.length) return 'This tool takes no arguments or paths';
}

export async function runTask(options: RunOptions) {
  const started = Date.now();
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (['repairs', 'requestIntervalMs'].includes(name) ? 0 : 1)) throw new Error(`Invalid limit: ${name}`);
  }
  if (!['collection', 'workspace'].includes(options.field)) throw new Error('Field must be collection or workspace');
  const memory = loadMemory(resolve(options.state));
  const memoryBefore = structuredClone(memory);
  if (options.destination !== undefined) memory.preference.destination = options.destination;
  if (!/^[\w -]{1,80}$/.test(memory.preference.destination)) throw new Error('Destination must be 1–80 letters, numbers, spaces, underscores, or hyphens');
  const lesson = retrieve(memory, 'notes-create/v1');
  const apiKey = options.offline ? '' : process.env.FIREWORKS_API_KEY?.trim();
  if (!options.offline && !apiKey) throw new Error('Add FIREWORKS_API_KEY to the Git-ignored .env file in the repository root, then retry');
  mkdirSync(resolve(options.output), { recursive: true, mode: 0o700 });
  const runDir = mkdtempSync(join(resolve(options.output), 'run-'));
  const fixture = join(runDir, 'fixture');
  createFixture(fixture, options.field);
  const agentDir = join(runDir, 'pi');
  mkdirSync(agentDir, { mode: 0o700 });
  const trace: TraceEvent[] = [];
  const log = (event: EventKind, data: Record<string, unknown> = {}) => {
    // The credential never enters trace data, including unexpected model echoes.
    const serialized = JSON.stringify(data);
    const clean = apiKey ? JSON.parse(serialized.replaceAll(apiKey, '[redacted]')) : data;
    const entry: TraceEvent = { ...clean, version: 1, seq: trace.length + 1, event, ms: Date.now() - started };
    trace.push(entry);
    try { options.onEvent?.(structuredClone(entry)); } catch { /* An observer cannot change execution. */ }
  };
  log('run_started', { source: readSolution(fixture), field: options.field, destination: memory.preference.destination, offline: !!options.offline, model: MODEL, limits, creed: CREED, pid: process.pid });
  log('memory_loaded', { memory: memoryBefore, lesson: lesson ?? null, destination: memory.preference.destination, preferenceChanged: memoryBefore.preference.destination !== memory.preference.destination });
  const hooks: Record<string, number> = {};
  const hook = (name: string) => { hooks[name] = (hooks[name] ?? 0) + 1; };
  let phase = 'task', stopped = '', repairs = 0, modelCalls = 0, toolCalls = 0, toolRequests = 0;
  let testFailures = 0, hostChecks = 0, blocked = 0, forbiddenHandlerCalls = 0, httpStatus: number | undefined;
  let evidence: Awaited<ReturnType<typeof verifyFixture>>['evidence'];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, estimatedCostUSD: 0 };
  const cancellation = new AbortController();
  const stop = (reason: string) => { if (!stopped) { stopped = reason; log('stop', { reason }); } };
  const checkTime = () => {
    if (options.signal?.aborted) stop('cancelled');
    if (Date.now() - started >= limits.elapsedMs) stop('time_budget');
    return stopped;
  };
  const goal = (failed: boolean) => { const selection = selectGoal(failed); log('goal', selection); return selection.selected; };
  goal(false);
  const verify = async () => {
    hostChecks++;
    const result = await verifyFixture(fixture, options.field, memory.preference.destination);
    log('verification', { ok: result.ok, source: 'host-owned verifier', error: result.error, checks: result.checks ?? [], checkedCases: result.evidence?.cases ?? result.checks?.length ?? 0 });
    if (result.ok) { evidence = result.evidence; phase = 'complete'; }
    else {
      evidence = undefined;
      testFailures++;
      if (memory.procedure) log('memory_invalidated', { lesson: memory.procedure, reason: 'The independent check contradicted the retrieved lesson. It is no longer eligible for reuse.' });
      delete memory.procedure;
      memory.capability = { status: 'needs_repair' };
      log('capability_changed', { capability: memory.capability, reason: 'Observed verification failure', testFailures });
      if (phase !== 'diagnose' && !checkTime()) {
        if (repairs >= limits.repairs) stop('repair_budget');
        else { repairs++; phase = 'diagnose'; goal(true); }
      }
    }
    return { ok: result.ok, error: result.error, checkedCases: result.evidence?.cases };
  };
  const guarded = async (name: string, args: unknown) => {
    const denied = policy(name, args);
    if (denied || checkTime()) throw new Error(denied || `Stopped: ${stopped}`);
    if (name === 'read_solution') return { code: readSolution(fixture) };
    if (name === 'write_solution') {
      evidence = undefined;
      const before = readSolution(fixture);
      writeSolution(fixture, (args as { code: string }).code);
      log('code_changed', { path: 'solution.cjs', before, after: readSolution(fixture) });
      return { written: 'solution.cjs' };
    }
    if (name === 'verify_solution') return verify();
    if (name === 'inspect_contract') { phase = 'retry'; goal(false); return inspectContract(fixture, options.field); }
    throw new Error('Unknown tool');
  };
  const toolDescriptions: Record<string, string> = {
    read_solution: 'Read the current solution.cjs function.',
    write_solution: 'Replace only solution.cjs. Export a pure CommonJS function (text, destination) returning the notes payload. No host APIs.',
    verify_solution: 'Run the independent host-owned tests of solution.cjs. Tests cannot be edited.',
    inspect_contract: 'Diagnose the current API contract after a failed verification. Returns the accepted destination field.',
    delete_sentinel: 'Forbidden destructive action. Always rejected by the guardian; included only to exercise the policy.',
  };
  const customTools: ToolDefinition[] = Object.entries(toolDescriptions).map(([name, description]) => ({
    name, label: name, description, executionMode: 'sequential',
    parameters: name === 'write_solution' ? Type.Object({ code: Type.String({ maxLength: MAX_CODE_BYTES }) }, { additionalProperties: false }) : Type.Object({}, { additionalProperties: false }),
    execute: async (_id, args) => {
      if (name === 'delete_sentinel') { forbiddenHandlerCalls++; throw new Error('Forbidden action reached handler'); }
      const result = await guarded(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  }));
  const systemPrompt = `${CREED}\nRepair the function to return exactly {text, <accepted destination field>: destination}. Preserve both function inputs. No extra keys. Use only the provided tools.\n${lesson ? `Verified lesson: ${JSON.stringify({ field: lesson.field })}. Apply it first, then verify; it may be stale.` : 'No verified lesson. First call verify_solution on the existing code.'}\nAfter failure, inspect_contract once, repair solution.cjs, and verify again. Stop after tests pass. Do not guess another field or claim success without tests. Current destination preference: ${JSON.stringify(memory.preference.destination)}.`;
  const extension = (pi: ExtensionAPI) => {
    pi.on('before_agent_start', () => { hook('before_agent_start'); log('context_prepared', { systemPrompt, userPrompt: 'Complete the authorized coding task using the supplied tools and supervisor instructions.' }); return { systemPrompt }; });
    pi.on('context', event => { hook('context'); return { messages: event.messages }; });
    pi.on('before_provider_request', event => { hook('before_provider_request'); return event.payload; });
    pi.on('after_provider_response', event => { httpStatus = event.status; });
    pi.on('tool_call', event => {
      hook('tool_call'); toolRequests++;
      log('tool_requested', { tool: event.toolName, toolCallId: event.toolCallId, input: event.input });
      let reason = policy(event.toolName, event.input);
      if (checkTime()) reason = `Stopped: ${stopped}`;
      if (toolRequests > limits.toolCalls) { stop('tool_budget'); reason = 'Tool request budget exhausted'; }
      if (!reason && event.toolName === 'inspect_contract' && phase !== 'diagnose') reason = 'Inspect the contract only after verification fails';
      if (!reason && event.toolName === 'write_solution' && phase === 'diagnose') reason = 'Inspect the contract before retrying';
      if (!reason && event.toolName === 'write_solution' && phase === 'complete') reason = 'Task already verified; no further edits';
      log('guardian', { tool: event.toolName, toolCallId: event.toolCallId, allowed: !reason, reason: reason ?? 'The tool and its arguments satisfy the immutable action policy and current execution limits.' });
      if (reason) { blocked++; return { block: true, reason }; }
      toolCalls++;
    });
    pi.on('tool_result', event => { hook('tool_result'); log('observation', { tool: event.toolName, toolCallId: event.toolCallId, isError: event.isError, output: event.content }); });
    pi.on('turn_end', () => { hook('turn_end'); });
    pi.on('agent_end', () => { hook('agent_end'); });
    pi.on('agent_before_settle', async () => {
      hook('agent_before_settle');
      if (checkTime()) return;
      const result = await verify();
      if (!result.ok && !checkTime()) return {
        continue: true,
        entries: [{ type: 'custom_message' as const, customType: 'system3', display: true,
          content: `Host verification failed. Selected goal: diagnose_contract. Call inspect_contract, repair solution.cjs, and verify. Remaining repair allowance: ${limits.repairs - repairs}.` }],
      };
    });
    pi.on('agent_settled', () => { hook('agent_settled'); log('settled'); });
  };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  let model = runtime.getModel('fireworks', MODEL);
  if (!model) throw new Error('The pinned Pi catalog is missing GLM 5.3 Flash; run npm ci');
  if (options.offline) {
    const faux = offlineProvider(options.mode);
    runtime.registerNativeProvider(faux.provider);
    model = faux.getModel();
  } else await runtime.setRuntimeApiKey('fireworks', apiKey!);
  const settings = SettingsManager.inMemory({ retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 30_000 } }, compaction: { enabled: false }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false });
  const resourceLoader = new DefaultResourceLoader({ cwd: fixture, agentDir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt, appendSystemPrompt: [], extensionFactories: [extension] });
  await resourceLoader.reload();
  const sessionManager = SessionManager.create(fixture, join(agentDir, 'sessions'));
  const { session } = await createAgentSession({ cwd: fixture, agentDir, modelRuntime: runtime, model, thinkingLevel: 'low',
    settingsManager: settings, sessionManager, resourceLoader, noTools: 'builtin', tools: Object.keys(toolDescriptions), customTools });
  const originalStream = session.agent.streamFunction;
  session.agent.streamFunction = async (requestModel, context, requestOptions) => {
    if (checkTime()) throw new Error(`System 3 stopped: ${stopped}`);
    if (modelCalls >= limits.modelCalls) { stop('model_budget'); throw new Error('Model request budget exhausted'); }
    const signal = AbortSignal.any([cancellation.signal, ...(requestOptions?.signal ? [requestOptions.signal] : [])]);
    // Pace even the first request so sequential fresh processes respect a 10-RPM account.
    if ((!options.offline || options.paceOffline) && limits.requestIntervalMs) {
      log('model_wait', { durationMs: limits.requestIntervalMs, reason: options.offline ? 'Demonstration pacing, so you can follow each actual request' : 'Fireworks request pacing to respect account rate limits' });
      await delay(limits.requestIntervalMs, undefined, { signal });
    }
    if (checkTime()) throw new Error(`System 3 stopped: ${stopped}`);
    modelCalls++; log('model_request', { number: modelCalls });
    return originalStream(requestModel, context, { ...requestOptions, maxTokens: limits.outputTokens, temperature: 0,
      signal });
  };
  session.subscribe(event => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const message = event.message;
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (text) log('assistant_message', { text });
    if (message.stopReason === 'error') {
      // Preserve the status code, never a raw provider body that might contain request data.
      const status = message.errorMessage?.match(/^(\d{3})(?::|\s)/)?.[1];
      if (status) httpStatus = Number(status);
      stop(httpStatus === 429 ? 'rate_limited' : 'provider_error');
    }
    const u = message.usage;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) usage[key] += u[key];
    usage.estimatedCostUSD += u.cost.total;
    log('model_response', { stopReason: message.stopReason, usage: u });
  });
  const abort = () => { stop(options.signal?.aborted ? 'cancelled' : 'time_budget'); cancellation.abort(); void session.abort(); };
  const timer = setTimeout(abort, Math.max(1, limits.elapsedMs - (Date.now() - started)));
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!checkTime()) await session.prompt('Complete the authorized coding task using the supplied tools and supervisor instructions.');
  } catch { if (!stopped) stop('session_error'); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); session.dispose(); }
  const success = !stopped && !!evidence && hooks.agent_settled > 0;
  if (success) promoteVerified(memory, { ...evidence!, field: options.field, sentinelPreserved: true });
  const outcome = success ? 'passed' : stopped.includes('budget') ? 'budget' : 'failed';
  appendEpisode(memory, { taskId: runDir.split('/').at(-1)!, outcome, testFailures, toolCalls });
  saveMemory(resolve(options.state), memory);
  log('memory_saved', { before: memoryBefore, after: structuredClone(memory), promoted: success, reason: success ? 'A settled run passed independent verification; its field mapping is eligible for future retrieval.' : 'Only the outcome and explicit preference were saved. No new procedure was promoted.' });
  log('run_finished', { success, reason: success ? 'verified' : stopped || 'unverified', modelCalls, toolCalls, repairs, blocked });
  const report = { success, reason: success ? 'verified' : stopped || 'unverified', offline: !!options.offline,
    startedAt: new Date(started).toISOString(), runtime: { pi: '0.87.1', node: process.versions.node, thinking: 'low', temperature: 0 },
    model: options.offline ? 'scripted-offline' : `fireworks/${MODEL}`, pid: process.pid, field: options.field,
    destination: memory.preference.destination, recalledField: lesson?.field, limits, repairs, modelCalls, toolCalls, toolRequests,
    hostChecks, testFailures, blocked, forbiddenHandlerCalls, elapsedMs: Date.now() - started, httpStatus,
    usage: options.offline ? null : usage, hooks, sessionFile: sessionManager.getSessionFile(), runDir, trace };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
