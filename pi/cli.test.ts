import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
const env = { PATH: process.env.PATH, FIREWORKS_API_KEY: '' };

test('demo forwards request limits to eight fresh processes and records budget failures', { timeout: 60_000 }, t => {
  const output = mkdtempSync(join(tmpdir(), 'system3-cli-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [cli, 'demo', '--offline', '--json', '--output', output,
    '--max-model-calls', '1', '--request-interval-ms', '0'],
    { encoding: 'utf8', env, timeout: 55_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stderr);
  const { summaryFile, ...summary } = JSON.parse(child.stdout);
  assert.equal(summary.passed, false);
  assert.equal(summary.offline, true);
  assert.equal(summary.rows.length, 8);
  assert.equal(new Set(summary.rows.map((row: { pid: number }) => row.pid)).size, 8);
  assert.deepEqual(JSON.parse(readFileSync(summaryFile, 'utf8')), summary);
  for (const row of summary.rows) {
    assert.equal(row.success, false);
    assert.notEqual(row.pid, process.pid);
    assert.equal(row.modelCalls, 1);
    const report = JSON.parse(readFileSync(row.report, 'utf8'));
    assert.equal(report.success, false);
    assert.equal(report.reason, 'model_budget');
    assert.equal(report.pid, row.pid);
    assert.equal(report.limits.modelCalls, 1);
    assert.equal(report.limits.requestIntervalMs, 0);
    assert.equal(report.usage, null);
  }
  assert.deepEqual(summary.checks.map((check: { name: string; passed: boolean }) => [check.name, check.passed]),
    [['guardian', true], ['repair budget', true], ['unverified claim', true]]);
  for (const check of summary.checks) {
    const report = JSON.parse(readFileSync(check.report, 'utf8'));
    assert.equal(report.reason, check.reason);
    assert.equal(report.offline, true);
  }
});

test('malformed CLI flags fail before producing a run report', () => {
  for (const args of [['--max-model-calls', 'banana'], ['--request-interval-ms=-1'], ['--unknown-option']]) {
    const child = spawnSync(process.execPath, [cli, 'demo', '--offline', '--json', ...args],
      { encoding: 'utf8', env, timeout: 5_000 });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.match(child.stderr, /Invalid --|Unknown option/);
  }
});
