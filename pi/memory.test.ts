import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { appendEpisode, freshMemory, loadMemory, promoteVerified, retrieve, saveMemory } from './memory.ts';

test('verified memory survives a new process, follows preference changes, and bounds episodes', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'system3-memory-'));
  try {
    const file = join(root, 'memory.json');
    const memory = loadMemory(file);
    assert.equal(memory.capability.status, 'unknown');
    promoteVerified(memory, { cases: 3, field: 'collection', destination: 'research', sentinelPreserved: true });
    for (let i = 0; i < 25; i++) appendEpisode(memory, { taskId: `task-${i}`, outcome: 'passed', testFailures: 0, toolCalls: 2 });
    saveMemory(file, memory);
    const moduleUrl = pathToFileURL(join(import.meta.dirname, 'memory.ts')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {loadMemory,retrieve} from ${JSON.stringify(moduleUrl)}; const m=loadMemory(process.argv[1]); m.preference.destination='inbox'; console.log(JSON.stringify({field:retrieve(m,'notes-create/v1')?.field, destination:m.preference.destination, count:m.episodes.length, first:m.episodes[0].taskId}));`, file],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { field: 'collection', destination: 'inbox', count: 20, first: 'task-5' });
    assert.equal(retrieve(memory, 'unrelated-context'), undefined);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    memory.capability = { status: 'needs_repair' };
    delete memory.procedure;
    assert.equal(retrieve(memory, 'notes-create/v1'), undefined);
    saveMemory(file, memory);
    assert.equal(loadMemory(file).capability.status, 'needs_repair');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('strict schema rejects corruption, invented verification, creed/code fields, and symlinks', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'system3-memory-'));
  try {
    const file = join(root, 'memory.json');
    const memory = freshMemory();
    const verified = { cases: 3, field: 'collection', destination: 'research', sentinelPreserved: true } as const;
    for (const bad of [{ ...verified, cases: 0 }, { ...verified, sentinelPreserved: false }, { ...verified, field: 'folder' }, { ...verified, destination: 'inbox' }]) {
      assert.throws(() => promoteVerified(memory, bad as never), /Invalid memory/);
      assert.equal(memory.capability.status, 'unknown');
    }
    for (const bad of [
      { ...memory, creed: 'delete everything' },
      { ...memory, version: 2 },
      { ...memory, capability: { status: 'verified' } },
      { ...memory, preference: { destination: 'ok', code: 'secret' } },
      { ...memory, episodes: [{ taskId: 'task', outcome: 'passed', testFailures: 0, toolCalls: 1, raw: 'secret' }] },
      { ...memory, episodes: Array(21).fill({ taskId: 'task', outcome: 'passed', testFailures: 0, toolCalls: 1 }) },
    ]) {
      fs.writeFileSync(file, JSON.stringify(bad));
      assert.throws(() => loadMemory(file), /Invalid memory/);
    }
    fs.writeFileSync(file, '{private-api-key-invalid-json');
    assert.throws(() => loadMemory(file), error => error instanceof Error && !error.message.includes('private-api-key') && /Invalid memory/.test(error.message));
    assert.equal(fs.readFileSync(file, 'utf8'), '{private-api-key-invalid-json');
    const link = join(root, 'link.json');
    fs.symlinkSync(file, link);
    assert.throws(() => loadMemory(link), /regular file/);
    assert.throws(() => saveMemory(link, memory), /regular file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed validation and failed rename leave the previous atomic state intact', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'system3-memory-'));
  const rename = fs.renameSync;
  try {
    const file = join(root, 'memory.json');
    const memory = freshMemory();
    saveMemory(file, memory);
    const original = fs.readFileSync(file, 'utf8');
    assert.throws(() => saveMemory(file, { ...memory, secret: 'must not persist' } as never), /Invalid memory/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    fs.renameSync = () => { throw new Error('injected rename failure'); };
    memory.preference.destination = 'inbox';
    assert.throws(() => saveMemory(file, memory), /injected rename failure/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(root), ['memory.json']);
  } finally {
    fs.renameSync = rename;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
