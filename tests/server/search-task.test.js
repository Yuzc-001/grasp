import test from 'node:test';
import assert from 'node:assert/strict';
import { runSearchTask, runSearchTaskTool } from '../../src/server/tasks/search-task.js';
import { createServerState } from '../../src/server/state.js';
import { createFakePage } from '../helpers/fake-page.js';

test('search task uses search_input then verifies result region', async () => {
  const result = await runSearchTask({
    query: 'pi agent 是啥',
    observer: async () => ({
      snapshot: { title: 'Grok', hints: [{ id: 'I1', semantic: 'search_input' }] },
    }),
    executor: async () => ({ ok: true }),
    verifier: async () => ({ ok: true, evidence: { answerStarted: true } }),
  });

  assert.equal(result.status, 'completed');
  assert.equal('frame' in result, false);
});

test('search task falls back after wrong affordance or no effect', async () => {
  let attempts = 0;
  const result = await runSearchTask({
    query: 'pi agent 是啥',
    observer: async () => ({
      snapshot: {
        hints: attempts++ === 0
          ? [{ id: 'B2', semantic: 'submit_control' }, { id: 'I1', semantic: 'search_input' }]
          : [{ id: 'I1', semantic: 'search_input' }],
      },
    }),
    executor: async () => ({ ok: true }),
    verifier: async () => attempts === 1
      ? { ok: false, error_code: 'NO_EFFECT' }
      : { ok: true, evidence: { answerStarted: true } },
  });

  assert.equal(result.attempts, 2);
});

test('search task uses alternate submit when input is written but no effect is observed', async () => {
  const calls = [];
  const result = await runSearchTask({
    query: 'pi agent 是啥',
    observer: async () => ({
      snapshot: {
        hints: [
          { id: 'I1', semantic: 'search_input' },
          { id: 'B9', semantic: 'submit_control' },
        ],
      },
    }),
    executor: async (plan) => {
      calls.push(plan.mode);
      return { ok: true };
    },
    verifier: async ({ plan }) => plan.mode === 'alternate_submit'
      ? { ok: true, evidence: { answerStarted: true } }
      : { ok: false, error_code: 'NO_EFFECT' },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['primary_submit', 'alternate_submit']);
});

test('search task waits and reverifies before failing a loading page', async () => {
  let verifyCount = 0;
  let executeCount = 0;
  const waits = [];
  const result = await runSearchTask({
    query: 'pi agent 是啥',
    observer: async () => ({
      snapshot: { hints: [{ id: 'I1', semantic: 'search_input' }] },
    }),
    executor: async () => {
      executeCount += 1;
      return { ok: true };
    },
    verifier: async () => {
      verifyCount += 1;
      return verifyCount === 1
        ? { ok: false, error_code: 'LOADING_PENDING' }
        : { ok: true, evidence: { answerStarted: true } };
    },
    waitThenReverify: async () => {
      waits.push(true);
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(executeCount, 1);
  assert.equal(verifyCount, 2);
  assert.equal(waits.length, 1);
});

test('search task failure still exposes stable benchmark fields', async () => {
  const result = await runSearchTask({
    query: 'pi agent 是啥',
    observer: async () => ({
      snapshot: { hints: [{ id: 'I1', semantic: 'search_input' }] },
    }),
    executor: async () => ({ ok: true, toolCalls: 1 }),
    verifier: async () => ({ ok: false, error_code: 'NO_EFFECT' }),
    maxAttempts: 3,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 3);
  assert.equal(result.toolCalls, 3);
  assert.equal(result.retries, 2);
  assert.equal(result.recovered, false);
  assert.equal('history' in result, false);
  assert.equal('frame' in result, false);
});

test('runSearchTaskTool executes real actions through provided dependencies', async () => {
  const state = createServerState();
  let typed = 0;
  const page = createFakePage({
    evaluate: async (fn, ...args) => {
      const str = fn.toString();
      if (str.includes('document.readyState')) return 'complete';
      return fn(...args);
    },
  });

  const result = await runSearchTaskTool({
    state,
    query: 'pi agent 是啥',
    max_attempts: 1,
    deps: {
      getActivePage: async () => page,
      observer: async () => ({
        snapshot: {
          query: 'pi agent 是啥',
          hints: [{ id: 'I1', type: 'textbox', label: 'Ask Grok', meta: { tag: 'input' }, semantic: 'search_input' }],
          ranking: { search_input: [{ id: 'I1', type: 'textbox', label: 'Ask Grok', meta: { tag: 'input' } }], command_button: [] },
          content: { text: '' },
          domRevision: 0,
          url: 'https://example.com/',
        },
        content: { text: '' },
      }),
      typeAction: async () => { typed += 1; },
      clickAction: async () => undefined,
      pressKeyAction: async () => undefined,
      waitStableAction: async () => ({ stable: true, attempts: 1 }),
      extractContentAction: async () => ({ text: 'after' }),
      syncStateAction: async () => undefined,
    },
  });

  assert(result.status === 'completed');
  assert(typed > 0);
  assert.equal(typeof result.taskId, 'string');
  assert.equal('frame' in result, false);
  assert.equal('history' in result, false);
  assert.equal(result.toolCalls, 1);
});

test('runSearchTaskTool counts actual action invocations across retries', async () => {
  const state = createServerState();
  let verifyCount = 0;
  const actionBreakdown = { type: 0, click: 0, pressKey: 0, typeWithEnter: 0 };
  const page = createFakePage();

  const result = await runSearchTaskTool({
    state,
    query: 'pi agent 是啥',
    max_attempts: 3,
    deps: {
      getActivePage: async () => page,
      observer: async () => ({
        snapshot: {
          query: 'pi agent 是啥',
          hints: [
            { id: 'I1', type: 'textbox', label: 'Ask Grok', meta: { tag: 'input' }, semantic: 'search_input' },
            { id: 'B9', semantic: 'submit_control' },
          ],
          ranking: {
            search_input: [{ id: 'I1', type: 'textbox', label: 'Ask Grok', meta: { tag: 'input' } }],
            command_button: [{ id: 'B9' }],
          },
          submitCandidate: { id: 'B9' },
          content: { text: '' },
          domRevision: 0,
          url: 'https://example.com/',
        },
      }),
      verifier: async ({ plan }) => {
        verifyCount += 1;
        return verifyCount === 1 && plan.mode === 'primary_submit'
          ? { ok: false, error_code: 'NO_EFFECT' }
          : { ok: true, evidence: { answerStarted: true } };
      },
      typeAction: async (_page, _hintId, _text, pressEnter) => {
        actionBreakdown.type += 1;
        if (pressEnter) actionBreakdown.typeWithEnter += 1;
      },
      clickAction: async () => {
        actionBreakdown.click += 1;
      },
      pressKeyAction: async () => {
        actionBreakdown.pressKey += 1;
      },
      syncStateAction: async () => undefined,
      waitStableAction: async () => ({ stable: true, attempts: 1 }),
      extractContentAction: async () => ({ text: 'after' }),
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepStrictEqual(actionBreakdown, {
    type: 2,
    click: 1,
    pressKey: 0,
    typeWithEnter: 1,
  });
  assert.equal(result.toolCalls, 3);
  assert.equal(result.retries, 1);
});

test('runSearchTaskTool falls back to a real input when observer ranking points at a button', async () => {
  const state = createServerState();
  let typed = 0;
  const typedHintIds = [];
  const page = createFakePage({
    evaluate: async (fn, ...args) => {
      const str = fn.toString();
      if (str.includes('document.readyState')) return 'complete';
      return fn(...args);
    },
  });

  const result = await runSearchTaskTool({
    state,
    query: 'ai agent',
    max_attempts: 2,
    deps: {
      getActivePage: async () => page,
      observer: async () => ({
        snapshot: {
          query: 'ai agent',
          hints: [
            { id: 'B2', type: 'button', label: '搜索', meta: { tag: 'div', contenteditable: false } },
            { id: 'I1', type: 'div', label: 'div', meta: { tag: 'div', contenteditable: true } },
          ],
          ranking: {
            search_input: [{ id: 'B2', type: 'button', label: '搜索', meta: { tag: 'div', contenteditable: false } }],
            command_button: [{ id: 'B5', type: 'button', label: '提交' }],
          },
          content: { text: '' },
          domRevision: 0,
          url: 'https://grok.com/',
          submitCandidate: { id: 'B5', type: 'button', label: '提交' },
        },
      }),
      verifier: async () => ({ ok: false, error_code: 'NO_EFFECT' }),
      typeAction: async (_page, hintId) => {
        typed += 1;
        typedHintIds.push(hintId);
      },
      clickAction: async () => undefined,
      pressKeyAction: async () => undefined,
      waitStableAction: async () => ({ stable: true, attempts: 1 }),
      extractContentAction: async () => ({ text: '' }),
      syncStateAction: async () => undefined,
    },
  });

  assert.equal(typed, 2);
  assert.deepStrictEqual(typedHintIds, ['I1', 'I1']);
  assert.equal(result.status, 'failed');
  assert.equal(result.toolCalls, 3);
});
