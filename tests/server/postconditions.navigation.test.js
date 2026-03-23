import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyGenericAction, verifyTypeResult } from '../../src/server/postconditions.js';
import { createFakePage } from '../helpers/fake-page.js';

test('verifyGenericAction succeeds on navigation without reading stale execution context', async () => {
  const page = createFakePage({
    url: () => 'https://example.com/next',
    evaluate: async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
  });

  const result = await verifyGenericAction({
    page,
    hintId: 'B1',
    prevDomRevision: 2,
    prevUrl: 'https://example.com/start',
    prevActiveId: 'B1',
    newDomRevision: 2,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.evidence.url, 'https://example.com/next');
});

test('verifyTypeResult treats submit-driven navigation as success when page changed', async () => {
  const page = createFakePage({
    url: () => 'https://example.com/search?q=browser+automation',
    evaluate: async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
  });

  const result = await verifyTypeResult({
    page,
    expectedText: 'browser automation',
    allowPageChange: true,
    prevUrl: 'https://example.com/search',
    prevDomRevision: 0,
    newDomRevision: 1,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.evidence.url, 'https://example.com/search?q=browser+automation');
  assert.strictEqual(result.evidence.domRevision, 1);
  assert.strictEqual(result.evidence.navigationObserved, true);
});
