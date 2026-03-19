import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSearchTaskTool } from '../src/server/tasks/search-task.js';
import { createServerState } from '../src/server/state.js';

function mean(items) {
  if (items.length === 0) return 0;
  return items.reduce((sum, value) => sum + value, 0) / items.length;
}

export function summarizeSearchBenchmark(results = [], options = {}) {
  const suite = options.suite ?? 'search-task';
  const total = results.length;
  const successCount = results.filter((r) => r.status === 'completed').length;
  const successRate = total === 0 ? 0 : successCount / total;
  const avgToolCalls = mean(results.map((r) => r.toolCalls ?? 0));
  const avgRetries = mean(results.map((r) => r.retries ?? 0));
  const totalRetryAttempts = results.reduce((sum, result) => sum + (result.retries ?? 0), 0);
  const successfulRetryAttempts = results.reduce((sum, result) => {
    if (result.status === 'completed' && (result.retries ?? 0) > 0) {
      return sum + 1;
    }
    return sum;
  }, 0);
  const recoverySuccessRate = totalRetryAttempts === 0
    ? 1
    : successfulRetryAttempts / totalRetryAttempts;

  return {
    suite,
    successRate,
    avgToolCalls,
    avgRetries,
    recoverySuccessRate,
  };
}

function createFakeBenchmarkPage({ url = 'https://example.com/', title = 'Benchmark Page' } = {}) {
  return {
    url: () => url,
    title: async () => title,
    evaluate: async () => 'complete',
  };
}

function createSnapshot({
  query = 'pi agent 是啥',
  title = 'Search',
  url = 'https://example.com/search',
  contentText = '',
  domRevision = 0,
  searchInput = { id: 'I1', type: 'textbox', label: 'Search' },
  submitControl = { id: 'B1', type: 'button', label: 'Search' },
} = {}) {
  const ranking = {
    search_input: searchInput ? [{ ...searchInput }] : [],
    command_button: submitControl ? [{ ...submitControl }] : [],
  };
  const hints = [
    ...(searchInput ? [{ ...searchInput, semantic: 'search_input' }] : []),
    ...(submitControl ? [{ ...submitControl, semantic: 'submit_control' }] : []),
  ];
  return {
    query,
    title,
    url,
    hints,
    ranking,
    content: { text: contentText },
    domRevision,
    submitCandidate: submitControl ? { ...submitControl } : null,
  };
}

async function runToolScenario({
  name,
  description,
  query = 'pi agent 是啥',
  maxAttempts = 3,
  pageUrl,
  pageTitle,
  observer,
  verifier,
  waitThenReverify,
}) {
  const state = createServerState();
  const page = createFakeBenchmarkPage({ url: pageUrl, title: pageTitle });
  const actionBreakdown = {
    type: 0,
    typeWithEnter: 0,
    click: 0,
    pressKey: 0,
    waitStable: 0,
  };

  const result = await runSearchTaskTool({
    state,
    query,
    max_attempts: maxAttempts,
    deps: {
      getActivePage: async () => page,
      observer,
      verifier,
      waitThenReverify,
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
      waitStableAction: async () => {
        actionBreakdown.waitStable += 1;
        return { stable: true, attempts: 1 };
      },
      extractContentAction: async () => ({ text: 'fixture content' }),
      syncStateAction: async () => undefined,
    },
  });

  return {
    scenario: name,
    description,
    status: result.status,
    attempts: result.attempts,
    toolCalls: result.toolCalls,
    retries: result.retries,
    recovered: result.recovered,
    actionBreakdown,
  };
}

export function createSearchBenchmarkScenarios() {
  return [
    {
      name: 'grok-question',
      description: 'Grok 搜索提问',
      async run() {
        return runToolScenario({
          name: 'grok-question',
          description: 'Grok 搜索提问',
          pageUrl: 'https://grok.com/',
          pageTitle: 'Grok',
          observer: async () => ({
            snapshot: createSnapshot({
              title: 'Grok',
              url: 'https://grok.com/',
              searchInput: { id: 'I1', type: 'textbox', label: '向 Grok 提问' },
              submitControl: { id: 'B2', type: 'button', label: '发送' },
            }),
          }),
          verifier: async () => ({ ok: true, evidence: { answerStarted: true } }),
        });
      },
    },
    {
      name: 'google-search',
      description: 'Google 搜索',
      async run() {
        return runToolScenario({
          name: 'google-search',
          description: 'Google 搜索',
          pageUrl: 'https://www.google.com/',
          pageTitle: 'Google',
          observer: async () => ({
            snapshot: createSnapshot({
              title: 'Google',
              url: 'https://www.google.com/',
              searchInput: { id: 'I1', type: 'searchbox', label: 'Search Google' },
              submitControl: null,
            }),
          }),
          verifier: async () => ({ ok: true, evidence: { resultsVisible: true } }),
        });
      },
    },
    {
      name: 'overlay-site-search',
      description: '带弹层干扰的站内搜索',
      async run() {
        return runToolScenario({
          name: 'overlay-site-search',
          description: '带弹层干扰的站内搜索',
          pageUrl: 'https://docs.example.com/',
          pageTitle: 'Docs Search',
          observer: async () => ({
            snapshot: createSnapshot({
              title: 'Docs Search',
              url: 'https://docs.example.com/',
              searchInput: { id: 'I3', type: 'combobox', label: '站内搜索' },
              submitControl: { id: 'B4', type: 'button', label: '搜索' },
            }),
          }),
          verifier: (() => {
            let attempts = 0;
            return async ({ plan }) => {
              attempts += 1;
              if (attempts === 1 && plan.mode === 'primary_submit') {
                return { ok: false, error_code: 'NO_EFFECT', evidence: { overlay: true } };
              }
              return { ok: true, evidence: { resultPaneChanged: true } };
            };
          })(),
        });
      },
    },
    {
      name: 'streaming-answer',
      description: '流式回答页面等待稳定',
      async run() {
        let verifyCount = 0;
        return runToolScenario({
          name: 'streaming-answer',
          description: '流式回答页面等待稳定',
          pageUrl: 'https://chat.example.com/',
          pageTitle: 'Streaming Answer',
          observer: async () => ({
            snapshot: createSnapshot({
              title: 'Streaming Answer',
              url: 'https://chat.example.com/',
              searchInput: { id: 'I9', type: 'textbox', label: 'Ask anything' },
              submitControl: { id: 'B9', type: 'button', label: 'Send' },
            }),
          }),
          verifier: async () => {
            verifyCount += 1;
            return verifyCount === 1
              ? { ok: false, error_code: 'LOADING_PENDING', evidence: { streamOpen: true } }
              : { ok: true, evidence: { streamSettled: true } };
          },
        });
      },
    },
    {
      name: 'result-content-extract',
      description: '结果页正文抽取',
      async run() {
        return runToolScenario({
          name: 'result-content-extract',
          description: '结果页正文抽取',
          pageUrl: 'https://example.com/pi-agent',
          pageTitle: 'Pi Agent',
          observer: async () => ({
            snapshot: createSnapshot({
              title: 'Pi Agent',
              url: 'https://example.com/pi-agent',
              contentText: 'Pi Agent is a minimal coding-agent runtime.',
              searchInput: { id: 'I6', type: 'textbox', label: 'Search docs' },
              submitControl: { id: 'B6', type: 'button', label: 'Search docs' },
            }),
          }),
          verifier: async ({ snapshot }) => ({
            ok: true,
            evidence: { extractedText: snapshot.content.text },
          }),
        });
      },
    },
  ];
}

export async function runSearchBenchmark(scenarios = createSearchBenchmarkScenarios(), options = {}) {
  const { silent = false } = options;
  const results = [];
  for (const scenario of scenarios) {
    const result = await scenario.run();
    results.push(result);
  }
  const summary = summarizeSearchBenchmark(results, options);
  const payload = {
    summary,
    results,
  };
  if (!silent) {
    console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runSearchBenchmark();
}
