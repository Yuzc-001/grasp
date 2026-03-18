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
          hints: [{ id: 'I1', semantic: 'search_input' }],
          ranking: { search_input: [{ id: 'I1' }], command_button: [] },
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
});
