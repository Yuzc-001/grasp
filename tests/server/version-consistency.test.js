import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SERVER_INFO } from '../../src/server/index.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

test('SERVER_INFO version matches package.json version', () => {
  assert.strictEqual(SERVER_INFO.version, packageJson.version);
});
