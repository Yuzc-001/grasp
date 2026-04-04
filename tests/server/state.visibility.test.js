import test from 'node:test';
import assert from 'node:assert/strict';

import { createServerState, syncPageState } from '../../src/server/state.js';

function createPage(sequence) {
  let index = 0;
  return {
    url: () => 'https://example.com/panel',
    evaluate: async () => {
      const current = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return current;
    },
  };
}

test('syncPageState bumps domRevision when visibility/display state changes without text changes', async () => {
  const state = createServerState();
  const page = createPage([
    {
      bodyText: 'Settings Panel',
      nodes: 4,
      forms: 0,
      navs: 1,
      headings: ['Settings'],
      title: 'Settings',
      styleFingerprint: 'button:visible|panel:hidden',
    },
    {
      bodyText: 'Settings Panel',
      nodes: 4,
      forms: 0,
      navs: 1,
      headings: ['Settings'],
      title: 'Settings',
      styleFingerprint: 'button:hidden|panel:visible',
    },
  ]);

  const sharedDeps = {
    probeImpl: async () => ({ available: true, source: 'test' }),
    listToolsImpl: async () => [],
  };

  await syncPageState(page, state, { force: true, ...sharedDeps });
  const firstRevision = state.pageState.domRevision;
  await syncPageState(page, state, { force: false, ...sharedDeps });

  assert.equal(firstRevision, 0);
  assert.equal(state.pageState.domRevision, 1);
});
