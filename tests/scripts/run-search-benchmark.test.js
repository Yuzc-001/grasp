import test from 'node:test';
import assert from 'node:assert/strict';
import { runSearchBenchmark, summarizeSearchBenchmark } from '../../scripts/run-search-benchmark.mjs';

test('summarizeSearchBenchmark exposes metric keys', () => {
  const results = [
    { status: 'completed', toolCalls: 4, retries: 2, recovered: true },
    { status: 'failed', toolCalls: 5, retries: 1, recovered: false },
  ];
  const summary = summarizeSearchBenchmark(results, { suite: 'fixture' });

  assert.deepStrictEqual(Object.keys(summary), [
    'suite',
    'successRate',
    'avgToolCalls',
    'avgRetries',
    'recoverySuccessRate',
  ]);
  assert.strictEqual(summary.suite, 'fixture');
  assert.strictEqual(summary.recoverySuccessRate, 1 / 3);
});

test('runSearchBenchmark executes built-in scenarios and returns JSON-friendly results', async () => {
  const payload = await runSearchBenchmark(undefined, { silent: true });

  assert.strictEqual(payload.summary.suite, 'search-task');
  assert.strictEqual(payload.results.length, 5);
  assert(payload.results.every((result) => typeof result.scenario === 'string'));
  const byScenario = Object.fromEntries(payload.results.map((result) => [result.scenario, result]));
  assert.deepStrictEqual(byScenario['google-search'].actionBreakdown, {
    type: 1,
    typeWithEnter: 1,
    click: 0,
    pressKey: 0,
    waitStable: 0,
  });
  assert.deepStrictEqual(byScenario['overlay-site-search'].actionBreakdown, {
    type: 2,
    typeWithEnter: 1,
    click: 1,
    pressKey: 0,
    waitStable: 0,
  });
  assert.strictEqual(byScenario['streaming-answer'].actionBreakdown.waitStable, 1);
  assert.strictEqual(payload.summary.recoverySuccessRate, 1);
});
