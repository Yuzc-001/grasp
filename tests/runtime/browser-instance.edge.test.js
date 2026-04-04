import test from 'node:test';
import assert from 'node:assert/strict';

import { inferBrowserInstance } from '../../src/runtime/browser-instance.js';

test('inferBrowserInstance marks Edge endpoints as windowed', () => {
  const instance = inferBrowserInstance({
    Browser: 'Edg/146.0.3856.97',
    'Protocol-Version': '1.3',
  });

  assert.equal(instance.headless, false);
  assert.equal(instance.display, 'windowed');
  assert.equal(instance.warning, null);
});

test('inferBrowserInstance marks HeadlessEdg endpoints as headless', () => {
  const instance = inferBrowserInstance({
    Browser: 'HeadlessEdg/146.0.3856.97',
    'Protocol-Version': '1.3',
  });

  assert.equal(instance.headless, true);
  assert.equal(instance.display, 'headless');
  assert.match(instance.warning, /headless browser/i);
});
