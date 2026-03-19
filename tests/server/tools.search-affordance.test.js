import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';
import { rankAffordances } from '../../src/server/affordances.js';
import { extractMainContent, waitUntilStable } from '../../src/server/content.js';

test('rankAffordances prefers chat-like search input over command menu trigger', () => {
  const ranked = rankAffordances({
    hints: [
      { id: 'B2', type: 'button', label: '搜索', meta: {} },
      { id: 'I1', type: 'textbox', label: '向 Grok 提问', meta: { name: 'query' } },
    ],
  });

  assert.equal(ranked.search_input[0].id, 'I1');
});

test('rankAffordances prefers contenteditable surfaces over search buttons', () => {
  const ranked = rankAffordances({
    hints: [
      {
        id: 'B2',
        type: 'button',
        label: '搜索',
        meta: { tag: 'div', contenteditable: false },
      },
      {
        id: 'I1',
        type: 'div',
        label: 'div',
        meta: { tag: 'div', contenteditable: true },
      },
    ],
  });

  assert.equal(ranked.search_input[0].id, 'I1');
  assert.equal(ranked.search_input.some((hint) => hint.id === 'B2'), false);
});

test('extractMainContent prefers main-like container over full body text', async () => {
  const page = createFakePage({
    evaluate: async () => ({
      title: 'Pi Agent',
      mainText: 'Pi Agent 目前最常指...',
      bodyText: '切换侧边栏 搜索 历史记录 Pi Agent 目前最常指...',
    }),
  });

  const content = await extractMainContent(page);

  assert.match(content.text, /Pi Agent 目前最常指/);
  assert.doesNotMatch(content.text, /切换侧边栏 搜索 历史记录/);
});

test('waitUntilStable resolves once snapshots stop changing', async () => {
  const snapshots = [
    { version: 1 },
    { version: 2 },
    { version: 2 },
    { version: 2 },
  ];

  let idx = 0;
  const page = createFakePage();

  const result = await waitUntilStable(page, {
    stableChecks: 2,
    interval: 0,
    timeout: 500,
    getSnapshot: async () => snapshots[Math.min(idx++, snapshots.length - 1)],
  });

  assert.strictEqual(result.stable, true);
  assert.deepStrictEqual(result.snapshot, { version: 2 });
  assert.ok(result.attempts >= 3);
});
