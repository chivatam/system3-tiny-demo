import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Memory, Evidence, Episode, Procedure } from './memory-types.ts';
export type { VerifiedField, Evidence, Procedure, Episode, Memory } from './memory-types.ts';

function invalid(field: string): never {
  throw new Error(`Invalid memory (${field}); preserve the file and repair it or choose a new state path.`);
}

function object(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected object');
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !keys.includes(key))) invalid('unexpected or missing fields');
}

function destination(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/u.test(value)) invalid('destination');
}

function evidence(value: unknown): asserts value is Evidence {
  object(value, ['cases', 'field', 'destination', 'sentinelPreserved']);
  if (!Number.isSafeInteger(value.cases) || (value.cases as number) < 3 || (value.cases as number) > 1_000_000) invalid('verification cases');
  if (!['collection', 'workspace'].includes(value.field as string) || value.sentinelPreserved !== true) invalid('verification evidence');
  destination(value.destination);
}

function episode(value: unknown): asserts value is Episode {
  object(value, ['taskId', 'outcome', 'testFailures', 'toolCalls']);
  if (typeof value.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value.taskId)) invalid('taskId');
  if (!['passed', 'failed', 'blocked', 'budget'].includes(value.outcome as string)) invalid('episode outcome');
  for (const key of ['testFailures', 'toolCalls']) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 1_000_000) invalid(key);
  }
}

function validate(value: unknown): asserts value is Memory {
  object(value, ['version', 'preference', 'capability', 'procedure', 'episodes'], ['version', 'preference', 'capability', 'episodes']);
  if (value.version !== 1) invalid('version');
  object(value.preference, ['destination']);
  destination(value.preference.destination);
  object(value.capability, ['status', 'evidence'], ['status']);
  if (!['unknown', 'needs_repair', 'verified'].includes(value.capability.status as string)) invalid('capability status');
  if (!Array.isArray(value.episodes) || value.episodes.length > 20) invalid('episodes must contain at most 20 entries');
  value.episodes.forEach(episode);
  if (value.capability.status !== 'verified') {
    if ('evidence' in value.capability || 'procedure' in value) invalid('unverified capability cannot retain a procedure');
    return;
  }
  evidence(value.capability.evidence);
  object(value.procedure, ['contextKey', 'field', 'evidence']);
  evidence(value.procedure.evidence);
  if (value.procedure.contextKey !== 'notes-create/v1' || value.procedure.field !== value.procedure.evidence.field) invalid('procedure context or field');
  for (const key of ['cases', 'field', 'destination', 'sentinelPreserved'] as const) {
    if (value.procedure.evidence[key] !== value.capability.evidence[key]) invalid('inconsistent verification evidence');
  }
}

export function freshMemory(preferredDestination = 'research'): Memory {
  destination(preferredDestination);
  return { version: 1, preference: { destination: preferredDestination }, capability: { status: 'unknown' }, episodes: [] };
}

export function loadMemory(file: string): Memory {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return freshMemory();
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536) invalid('state must be a regular file under 64 KiB');
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { invalid('JSON'); }
  validate(value);
  return value;
}

export function saveMemory(file: string, memory: Memory): void {
  validate(memory);
  try {
    if (!fs.lstatSync(file).isFile()) invalid('state path must be a regular file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(file), `.memory-${randomUUID()}.tmp`);
  // ponytail: one writer per state file; use SQLite transactions for concurrent agents.
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(memory, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* Already closed before rename. */ }
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function retrieve(memory: Memory, contextKey: string): Procedure | undefined {
  validate(memory);
  return memory.capability.status === 'verified' && memory.procedure?.contextKey === contextKey
    ? structuredClone(memory.procedure) : undefined;
}

/** Pass evidence from the host-owned verifier, never from the model's completion text. */
export function promoteVerified(memory: Memory, verified: Evidence): void {
  validate(memory);
  evidence(verified);
  if (verified.destination !== memory.preference.destination) invalid('verified destination differs from current preference');
  memory.procedure = { contextKey: 'notes-create/v1', field: verified.field, evidence: structuredClone(verified) };
  memory.capability = { status: 'verified', evidence: structuredClone(verified) };
}

export function appendEpisode(memory: Memory, entry: Episode): void {
  validate(memory);
  episode(entry);
  memory.episodes = [...memory.episodes.slice(-19), structuredClone(entry)];
}
