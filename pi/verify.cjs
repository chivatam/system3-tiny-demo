'use strict';
const { readFileSync } = require('node:fs');
const { createContext, Script } = require('node:vm');

// Defense in depth for this disposable demo, not a production hostile-code sandbox.
// No host objects, require, process, timers, or network APIs enter the context.
try {
  const code = readFileSync(process.argv[2], 'utf8');
  const cases = JSON.parse(process.argv[3]);
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  // Capture intrinsics before candidate code runs. Its globals/prototype edits cannot
  // replace this runner or the serializer, and no candidate source enters the harness.
  new Script(`{
    const stringify = JSON.stringify, ownKeys = Reflect.ownKeys;
    const create = Object.create, define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
    const module = { exports: {} };
    define(this, 'module', { value: module });
    define(this, 'exports', { value: module.exports });
    define(this, '__verifyPayload', { value: (text, destination) => {
      const payload = module.exports(text, destination);
      if (payload === null || typeof payload !== 'object') throw null;
      const copy = create(null), keys = ownKeys(payload);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index], property = descriptor(payload, key);
        if (typeof key !== 'string' || !property || !descriptor(property, 'value') || typeof property.value !== 'string') throw null;
        define(copy, key, { value: property.value, enumerable: true });
      }
      return stringify(copy);
    }});
  }`).runInContext(context, { timeout: 500 });
  new Script(code).runInContext(context, { timeout: 500 });
  const results = cases.map(([text, destination]) => {
    const result = new Script(`this.__verifyPayload(${JSON.stringify(text)}, ${JSON.stringify(destination)})`).runInContext(context, { timeout: 500 });
    if (typeof result !== 'string') throw new Error('Expected serialized payload');
    return JSON.parse(result);
  });
  process.stdout.write(JSON.stringify(results));
} catch {
  process.stderr.write('Candidate failed constrained verification\n');
  process.exitCode = 1;
}
