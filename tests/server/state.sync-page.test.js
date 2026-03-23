import test from 'node:test';
import assert from 'node:assert/strict';

import { createServerState, syncPageState } from '../../src/server/state.js';

test('syncPageState retries transient execution-context failures while rebuilding hints', async () => {
  const state = createServerState();
  let callCount = 0;

  const page = {
    url: () => 'https://example.com/results',
    evaluate: async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          bodyText: 'Search results ready',
          nodes: 4,
          forms: 1,
          navs: 1,
          headings: ['Results'],
          title: 'Results',
        };
      }

      if (callCount <= 4) {
        throw new Error('Execution context was destroyed, most likely because of a navigation');
      }

      return {
        hints: [
          {
            id: 'L1',
            type: 'a',
            label: 'First result',
            x: 120,
            y: 180,
            meta: {
              name: '',
              idAttr: '',
              ariaLabel: '',
              placeholder: '',
              contenteditable: false,
              role: '',
              tag: 'a',
            },
          },
        ],
        newEntries: [['a|First_re|120|180', 'L1']],
        counters: { B: 0, I: 0, L: 1, S: 0 },
      };
    },
  };

  await syncPageState(page, state, { force: true });

  assert.strictEqual(state.pageState.lastUrl, 'https://example.com/results');
  assert.strictEqual(state.hintMap.length, 1);
  assert.strictEqual(state.hintMap[0].id, 'L1');
  assert.ok(callCount >= 5);
});
