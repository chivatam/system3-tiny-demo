import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';

const repository = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(import.meta.url);
const execute = promisify(execFile);

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required. Use Node 24, then run npm ci');
  // Native loading is deliberate: Pi does not automatically load a project's .env.
  const envFile = join(repository, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    offline: { type: 'boolean' }, json: { type: 'boolean' }, probe: { type: 'boolean' }, claim: { type: 'boolean' },
    field: { type: 'string', default: 'collection' }, destination: { type: 'string' },
    state: { type: 'string', default: join(repository, '.system3-pi/memory.json') },
    output: { type: 'string', default: join(repository, '.system3-pi') },
    'max-repairs': { type: 'string', default: '2' }, 'max-model-calls': { type: 'string', default: '12' },
    'max-tool-calls': { type: 'string', default: '20' }, 'timeout-ms': { type: 'string', default: '120000' },
    'request-interval-ms': { type: 'string', default: '6500' },
  } });
  const command = positionals[0] ?? 'run';
  if (positionals.length > 1 || !['run', 'demo'].includes(command)) throw new Error('Usage: npm start -- [--offline] [--field collection|workspace] [--destination research], or npm run demo[:live]');
  for (const key of ['max-repairs', 'max-model-calls', 'max-tool-calls', 'timeout-ms', 'request-interval-ms'] as const) {
    const number = Number(values[key]);
    if (!Number.isSafeInteger(number) || number < (['max-repairs', 'request-interval-ms'].includes(key) ? 0 : 1)) throw new Error(`Invalid --${key}`);
  }
  if (command === 'demo') {
    mkdirSync(resolve(values.output), { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(join(resolve(values.output), 'demo-'));
    const rows: Array<Record<string, unknown>> = [];
    const scenarios = [
      { name: 'first encounter', field: 'collection', destination: 'research' },
      { name: 'fresh process repeat', field: 'collection', destination: 'research' },
      { name: 'contract drift', field: 'workspace', destination: 'research' },
      { name: 'restart + preference', field: 'workspace', destination: 'shipping' },
    ];
    let allPassed = true;
    const childRun = async (args: string[], timeout = 140_000) => {
      try {
        const { stdout } = await execute(process.execPath, [cli, 'run', '--json', ...args], { timeout, maxBuffer: 2 * 1024 * 1024 });
        return JSON.parse(stdout);
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout;
        if (stdout?.trim().startsWith('{')) return JSON.parse(stdout);
        throw new Error('A demo child failed before producing a report; run npm start with the same options to diagnose');
      }
    };
    for (const [index, scenario] of scenarios.entries()) {
      for (const condition of ['persistent', 'stateless']) {
        const state = join(directory, condition === 'persistent' ? 'memory.json' : `fresh-${index}.json`);
        const report = await childRun(['--state', state, '--output', directory, '--field', scenario.field,
          '--destination', scenario.destination, ...['max-repairs', 'max-model-calls', 'max-tool-calls', 'timeout-ms', 'request-interval-ms'].flatMap(key => [`--${key}`, values[key as keyof typeof values] as string]),
          ...(values.offline ? ['--offline'] : [])], Number(values['timeout-ms']) + 20_000);
        rows.push({ scenario: scenario.name, condition, success: report.success, toolCalls: report.toolCalls,
          modelCalls: report.modelCalls, testFailures: report.testFailures, elapsedMs: report.elapsedMs,
          tokens: report.usage?.totalTokens ?? null, estimatedCostUSD: report.usage?.estimatedCostUSD ?? null,
          pid: report.pid, report: join(report.runDir, 'report.json') });
        allPassed &&= report.success;
        if (!values.json) process.stderr.write(`${condition}: ${scenario.name} — ${report.success ? 'passed' : report.reason}\n`);
        // A provider/configuration failure is not useful eight times in a row.
        if (['provider_error', 'rate_limited'].includes(report.reason)) {
          writeFileSync(join(directory, 'comparison.json'), JSON.stringify({ passed: false, incomplete: true, offline: !!values.offline, rows }, null, 2) + '\n', { mode: 0o600 });
          throw new Error(`Fireworks request failed (HTTP ${report.httpStatus ?? 'unknown'}). Details: ${join(report.runDir, 'report.json')}`);
        }
      }
    }
    const checks = [];
    for (const [name, args] of [['guardian', ['--probe']], ['repair budget', ['--max-repairs', '0']], ['unverified claim', ['--claim']]] as const) {
      const report = await childRun(['--offline', '--state', join(directory, `${name.replaceAll(' ', '-')}.json`), '--output', directory, ...args]);
      const passed = name === 'guardian' ? report.success && report.blocked === 1 && report.forbiddenHandlerCalls === 0 : !report.success;
      allPassed &&= passed;
      checks.push({ name, passed, reason: report.reason, report: join(report.runDir, 'report.json') });
    }
    const summary = { passed: allPassed, offline: !!values.offline, model: values.offline ? 'scripted-offline' : 'fireworks/accounts/fireworks/models/glm-5p3-flash',
      note: 'One measured run per condition; no statistical performance claim. Each row is a new OS process. Costs are Pi catalog estimates from reported token usage.', rows, checks };
    const summaryFile = join(directory, 'comparison.json');
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
    if (values.json) console.log(JSON.stringify({ ...summary, summaryFile }));
    else {
      console.table(rows.map(({ scenario, condition, success, toolCalls, modelCalls, elapsedMs }) => ({ scenario, condition, success, toolCalls, modelCalls, elapsedMs })));
      console.log(`${allPassed ? 'PASS' : 'FAIL'}: restart comparison and ${checks.length} deterministic safety checks\nEvidence: ${summaryFile}`);
    }
    process.exitCode = allPassed ? 0 : 1;
    return;
  }
  if ((values.probe || values.claim) && !values.offline) throw new Error('--probe and --claim require --offline');
  const { runTask } = await import('./supervisor.ts');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const report = await runTask({ state: values.state, output: values.output, field: values.field as 'collection' | 'workspace',
      destination: values.destination, offline: values.offline, mode: values.probe ? 'forbidden' : values.claim ? 'claim' : 'normal', signal: controller.signal,
      limits: { repairs: Number(values['max-repairs']), modelCalls: Number(values['max-model-calls']), toolCalls: Number(values['max-tool-calls']), elapsedMs: Number(values['timeout-ms']), requestIntervalMs: Number(values['request-interval-ms']) } });
    if (values.json) console.log(JSON.stringify(report));
    else console.log(`${report.success ? 'PASS' : 'STOP'}: ${report.reason}${report.httpStatus ? ` (HTTP ${report.httpStatus})` : ''}\n${report.toolCalls} tool calls; ${report.modelCalls} model calls; ${report.repairs} repairs\nEvidence: ${join(report.runDir, 'report.json')}`);
    process.exitCode = report.success ? 0 : 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Run failed'); process.exitCode = 1; });
