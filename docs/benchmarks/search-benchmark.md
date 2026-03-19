# Search Benchmark

This benchmark captures the stability of `search_task` runs and the recovery behavior introduced in v0.2. It drives fixture-backed `runSearchTaskTool()` scenarios in-process, exercising the real scheduler/executor path with injected action stubs instead of relying on audit logs or external sites.

## Summary format

Every benchmark result includes the following keys (locked by automated tests):

- `suite` — human-friendly label for the scenario (default `search-task`)
- `successRate` — fraction of runs that completed without hitting the retry budget
- `avgToolCalls` — average number of scheduler action invocations (`type`, `click`, `press_key`) per run, excluding state-sync bookkeeping
- `avgRetries` — average retry attempts observed across all runs
- `recoverySuccessRate` — successful retry attempts divided by total retry attempts

These values are derived from the stabilized `search_task` result object, which now exposes `taskId`, `status`, `attempts`, `toolCalls`, `retries`, and `recovered` directly on each run. They do not rely on external logging.

## Included scenarios

The smoke suite currently covers five fixture scenarios:

1. `grok-question` — Grok-style ask box with first-try success
2. `google-search` — classic searchbox that submits through the real `type(..., press_enter=true)` path
3. `overlay-site-search` — site search with a noisy overlay that needs alternate submit recovery
4. `streaming-answer` — loading page that must `wait_then_reverify`
5. `result-content-extract` — result page where the answer depends on extracted main content

The goal is not pixel-perfect browser replay. The goal is to keep the scheduler contract stable while we compare success rate, action count, and retry behavior across iterations.

## Running the benchmark

```bash
node scripts/run-search-benchmark.mjs
```

The script prints a JSON payload containing both the summary and the per-scenario results. Each scenario result also includes an `actionBreakdown`, so you can verify which submit path the fixture actually exercised.

For custom suites you can import `createSearchBenchmarkScenarios`, replace or extend the scenarios, and pass their results into `summarizeSearchBenchmark`.

## Verification

The suite in `tests/scripts/run-search-benchmark.test.js` asserts that:

- the summary exposes exactly the five public metric keys above
- `recoverySuccessRate` is weighted by retry attempts rather than by runs
- the built-in smoke suite returns five JSON-serializable results
