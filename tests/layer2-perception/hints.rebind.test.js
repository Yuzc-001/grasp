import test from 'node:test';
import assert from 'node:assert/strict';
import { rebindHintCandidate } from '../../src/layer2-perception/hints.js';
import { applySnapshotToPageState, createPageState } from '../../src/server/page-state.js';
import { locateElement } from '../../src/layer3-action/actions.js';

test('rebindHintCandidate matches by type, label, and position proximity', () => {
  const previous = { id: 'I2', type: 'combobox', label: 'Command Menu', x: 1266, y: 106 };
  const candidates = [
    { id: 'I1', type: 'button', label: 'Command Menu', x: 400, y: 120 },
    { id: 'I3', type: 'combobox', label: 'Command Menu', x: 1270, y: 110 },
  ];

  const rebound = rebindHintCandidate(previous, candidates);
  assert.strictEqual(rebound?.id, 'I3');
});

test('rebindHintCandidate matches equivalent input-like affordances across type changes', () => {
  const previous = {
    id: 'I1',
    type: 'textarea',
    label: 'prompt-textarea',
    x: 960,
    y: 430,
    meta: { tag: 'textarea', idAttr: 'prompt-textarea', contenteditable: false },
  };
  const candidates = [
    {
      id: 'I2',
      type: 'textbox',
      label: 'prompt-textarea',
      x: 967,
      y: 427,
      meta: { tag: 'div', role: 'textbox', contenteditable: true, idAttr: 'prompt-textarea' },
    },
  ];

  const rebound = rebindHintCandidate(previous, candidates);
  assert.strictEqual(rebound?.id, 'I2');
});

test('applySnapshotToPageState keeps domRevision when no change', () => {
  const state = createPageState();
  const stepOne = applySnapshotToPageState(state, { url: 'https://grok.com/', snapshotHash: 'hash-a' });
  const stepTwo = applySnapshotToPageState(stepOne, { url: 'https://grok.com/', snapshotHash: 'hash-a' });

  assert.strictEqual(stepTwo.domRevision, stepOne.domRevision);
});

test('applySnapshotToPageState increments when same url but snapshot changes', () => {
  const state = createPageState();
  const stepOne = applySnapshotToPageState(state, { url: 'https://grok.com/', snapshotHash: 'hash-a' });
  const stepTwo = applySnapshotToPageState(stepOne, { url: 'https://grok.com/', snapshotHash: 'hash-b' });

  assert.strictEqual(stepTwo.domRevision, stepOne.domRevision + 1);
});

test('applySnapshotToPageState resets domRevision when url changes', () => {
  const state = createPageState();
  const stepOne = applySnapshotToPageState(state, { url: 'https://grok.com/', snapshotHash: 'hash-a' });
  const stepTwo = applySnapshotToPageState(stepOne, { url: 'https://example.com/', snapshotHash: 'hash-c' });

  assert.strictEqual(stepTwo.domRevision, 0);
});

test('locateElement rebuild path succeeds even when hintId stays the same', async () => {
  const results = [null, { inView: true, centerY: 0, tag: 'input', label: 'Rebound Input' }];
  let evaluateCalls = 0;
  const page = {
    evaluate: async () => null,
    $: async () => ({
      boundingBox: async () => ({ x: 10, y: 10, width: 120, height: 30 }),
    }),
    mouse: {
      move: async () => {},
      wheel: async () => {},
      down: async () => {},
      up: async () => {},
    },
    waitForLoadState: async () => {},
  };

  let rebuildCalls = 0;
  const result = await locateElement(page, 'I2', {
    rebuildHints: async () => {
      rebuildCalls += 1;
      return { id: 'I2' };
    },
    evaluateHint: async () => {
      const next = results[Math.min(evaluateCalls, results.length - 1)];
      evaluateCalls += 1;
      return next;
    },
  });

  assert.strictEqual(result.info.tag, 'input');
  assert.strictEqual(rebuildCalls, 1);
  assert.strictEqual(evaluateCalls, 2);
});

test('locateElement rebuilds when the current element is no longer actionable', async () => {
  const handles = [
    { boundingBox: async () => null },
    { boundingBox: async () => ({ x: 100, y: 200, width: 300, height: 40 }) },
  ];
  let handleCalls = 0;
  const page = {
    evaluate: async () => null,
    $: async () => handles[Math.min(handleCalls++, handles.length - 1)],
    mouse: {
      move: async () => {},
      wheel: async () => {},
      down: async () => {},
      up: async () => {},
    },
    waitForLoadState: async () => {},
  };

  const hints = [
    { inView: true, centerY: 0, tag: 'textarea', label: 'prompt-textarea' },
    { inView: true, centerY: 0, tag: 'div', label: 'prompt-textarea' },
  ];
  let evaluateCalls = 0;
  let rebuildCalls = 0;

  const result = await locateElement(page, 'I1', {
    rebuildHints: async () => {
      rebuildCalls += 1;
      return { id: 'I2' };
    },
    evaluateHint: async () => hints[Math.min(evaluateCalls++, hints.length - 1)],
  });

  assert.strictEqual(result.info.tag, 'div');
  assert.strictEqual(rebuildCalls, 1);
  assert.strictEqual(handleCalls, 2);
});
