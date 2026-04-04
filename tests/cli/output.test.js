import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBanner, formatErrorCopy, formatStep } from '../../src/cli/output.js';

test('formatBanner renders a shared CLI section header', () => {
  const banner = formatBanner('Doctor', 'Check the dedicated browser runtime');

  assert.match(banner, /Doctor/);
  assert.match(banner, /Check the dedicated browser runtime/);
  assert.match(banner, /─{20,}/);
});

test('formatStep renders shared status labels consistently', () => {
  assert.strictEqual(formatStep('ok', 'Chrome found'), '  [ok] Chrome found');
  assert.strictEqual(formatStep('wait', 'Checking runtime'), '  [..] Checking runtime');
  assert.strictEqual(formatStep('fail', 'Chrome missing'), '  [!!] Chrome missing');
});

test('formatErrorCopy renders what happened, attempts, and next steps', () => {
  const text = formatErrorCopy({
    whatHappened: 'Chrome was not detected.',
    tried: ['Checked common install paths.'],
    nextSteps: ['Install Google Chrome.', 'Run grasp doctor again.'],
  });

  assert.match(text, /What happened/);
  assert.match(text, /Chrome was not detected\./);
  assert.match(text, /What Grasp already tried/);
  assert.match(text, /Checked common install paths\./);
  assert.match(text, /What you should do next/);
  assert.match(text, /Install Google Chrome\./);
  assert.match(text, /Run grasp doctor again\./);
});
