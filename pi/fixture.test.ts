import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFixture, inspectContract, MAX_CODE_BYTES, readSolution, verifyFixture, writeSolution } from './fixture.ts';

test('fixture validates real code, contract drift, exact fields, and destination changes', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'pi-fixture-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'task');
  createFixture(root, 'collection');
  assert.throws(() => createFixture(root, 'workspace'), /EEXIST/);
  assert.deepEqual(inspectContract(root, 'collection'), { destinationField: 'collection' });
  assert.equal((await verifyFixture(root, 'collection', 'research')).ok, false);
  writeSolution(root, 'module.exports = (text, destination) => ({ text, collection: destination });');
  assert.equal((await verifyFixture(root, 'collection', 'research')).evidence?.cases, 4);
  assert.equal((await verifyFixture(root, 'collection', 'work')).ok, true);
  assert.equal((await verifyFixture(root, 'workspace', 'work')).ok, false);
  writeSolution(root, 'module.exports=(text,destination)=>({text,workspace:destination,extra:true});');
  assert.equal((await verifyFixture(root, 'workspace', 'work')).ok, false);
  writeSolution(root, 'module.exports=(text,destination)=>({text,workspace:destination});');
  assert.equal((await verifyFixture(root, 'workspace', 'work')).ok, true);
  assert.match(readSolution(root), /workspace/);
});

test('generated code cannot use host secrets, filesystem, shell, or network APIs; loops terminate', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'pi-fixture-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'task');
  createFixture(root, 'collection');
  const before = readFileSync(join(root, 'sentinel.txt'), 'utf8');
  const inheritedOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--this-inherited-option-must-never-reach-child';
  process.env.PI_FIXTURE_SECRET_TEST = 'must-never-reach-candidate';
  t.after(() => {
    delete process.env.PI_FIXTURE_SECRET_TEST;
    if (inheritedOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = inheritedOptions;
  });
  writeSolution(root, 'module.exports=(text,destination)=>({text,collection:destination});');
  assert.equal((await verifyFixture(root, 'collection', 'research')).ok, true, 'Child must not inherit NODE_OPTIONS');
  const attempts = [
    'process.env.PI_FIXTURE_SECRET_TEST',
    'require("node:fs").readFileSync("../.env")',
    'require("node:fs").writeFileSync("sentinel.txt", "destroyed")',
    'require("node:child_process").execSync("echo unsafe")',
    'fetch("http://127.0.0.1:1")',
    'this.constructor.constructor("return process")()',
    'module.constructor.constructor("return process")()',
    'while (true) {}',
  ];
  for (const attack of attempts) {
    writeSolution(root, `${attack}; module.exports=(text,destination)=>({text,collection:destination});`);
    assert.equal((await verifyFixture(root, 'collection', 'research')).ok, false, attack);
    assert.equal(readFileSync(join(root, 'sentinel.txt'), 'utf8'), before);
  }
  writeSolution(root, 'module.exports=(text,destination)=>({text,collection:destination});');
  writeFileSync(join(root, 'sentinel.txt'), 'host tampered');
  assert.equal((await verifyFixture(root, 'collection', 'research')).ok, false);
});

test('solution rejects oversized code, symlinks, and unowned directories without changing targets', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'pi-fixture-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'task');
  createFixture(root, 'collection');
  assert.throws(() => writeSolution(root, 'x'.repeat(MAX_CODE_BYTES + 1)), /32 KiB/);
  const outside = join(parent, 'outside');
  writeFileSync(outside, 'keep');
  unlinkSync(join(root, 'solution.cjs'));
  symlinkSync(outside, join(root, 'solution.cjs'));
  assert.throws(() => readSolution(root));
  assert.throws(() => writeSolution(root, 'changed'));
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
  const alias = join(parent, 'alias');
  symlinkSync(root, alias);
  assert.throws(() => readSolution(alias), /real directory/);
  assert.throws(() => readSolution(parent));
});

test('candidate cannot forge verification by replacing serializer, array methods, or the protected runner', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'pi-fixture-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'task');
  createFixture(root, 'collection');
  const forged = JSON.stringify([
    { text: 'First note', collection: 'research' }, { text: '', collection: 'research' },
    { text: 'Café ☕', collection: 'another-destination' }, { text: 'Quotes " and \\ paths', collection: '' },
  ]);
  const attempts = [
    `JSON.stringify = () => ${JSON.stringify(forged)}; module.exports = () => ({wrong:'field'});`,
    `Array.prototype.map = () => ${forged}; module.exports = () => ({wrong:'field'});`,
    `this.__verifyPayload = () => '{"text":"First note","collection":"research"}'; module.exports = () => ({wrong:'field'});`,
    'Object.prototype.toJSON = function(){return {text:this.text,collection:this.folder}}; module.exports=(text,destination)=>({text,folder:destination});',
    'module.exports=(text,destination)=>({text,folder:destination,toJSON(){return {text,collection:destination}}});',
  ];
  for (const attack of attempts) {
    writeSolution(root, attack);
    assert.equal((await verifyFixture(root, 'collection', 'research')).ok, false, attack);
  }
  writeSolution(root, 'JSON.stringify=()=>"forged"; Array.prototype.map=()=>[]; module.exports=(text,destination)=>({text,collection:destination});');
  assert.equal((await verifyFixture(root, 'collection', 'research')).ok, true, 'Only actual function results decide success');
});
