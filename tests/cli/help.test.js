import test from 'node:test';
import assert from 'node:assert/strict';

import { renderHelpText } from '../../index.js';

test('renderHelpText describes the runtime help', () => {
  assert.match(renderHelpText(), /route-aware Agent Web Runtime/i);
  assert.match(renderHelpText(), /Connect Chrome once\./i);
  assert.match(renderHelpText(), /grasp\s+Bootstrap the runtime/i);
  assert.match(renderHelpText(), /grasp explain/i);
  assert.match(renderHelpText(), /entry\(url, intent\) \/ inspect \/ extract or continue \/ explain_route/i);
});

test('index.js can be imported without auto-running the CLI', async () => {
  const mod = await import('../../index.js');
  assert.strictEqual(typeof mod.main, 'function');
});
