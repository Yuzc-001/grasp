import { getActivePage } from '../../layer1-bridge/chrome.js';
import { typeByHintId, clickByHintId, pressKey } from '../../layer3-action/actions.js';
import { extractMainContent, waitUntilStable } from '../content.js';
import { observeSearchSnapshot } from '../observe.js';
import { createTaskFrame } from '../task-frame.js';
import { syncPageState } from '../state.js';
import { rebindHintCandidate } from '../../layer2-perception/hints.js';
import { NO_EFFECT, LOADING_PENDING, EXECUTION_FAILED } from '../error-codes.js';

function chooseSearchPlan(snapshot, frame) {
  const searchHint = (snapshot?.ranking?.search_input ?? [])[0];
  const submitHint = snapshot?.submitCandidate;
  let mode = 'primary_submit';
  if (frame.nextRecovery === 'alternate_submit') {
    mode = 'alternate_submit';
  } else if (frame.nextRecovery === 'reobserve') {
    mode = 'reobserve';
  }
  frame.nextRecovery = null;
  const plan = {
    query: snapshot?.query ?? '',
    mode,
    searchInputHintId: searchHint?.id ?? frame.semanticBindings.get('search_input') ?? null,
    submitHintId: submitHint?.id ?? frame.semanticBindings.get('submit_control') ?? null,
  };
  if (plan.searchInputHintId) {
    frame.semanticBindings.set('search_input', plan.searchInputHintId);
  }
  if (plan.submitHintId) {
    frame.semanticBindings.set('submit_control', plan.submitHintId);
  }
  return plan;
}

function applyRecovery(frame, verdict) {
  if (!verdict?.error_code) return;
  if (verdict.error_code === NO_EFFECT) {
    frame.nextRecovery = 'alternate_submit';
  } else if (verdict.error_code === LOADING_PENDING) {
    frame.nextRecovery = 'wait_then_reverify';
  } else {
    frame.nextRecovery = 'reobserve';
  }
}

function countExecutionToolCalls(execution) {
  if (!execution) return 0;
  if (typeof execution.toolCalls === 'number') {
    return execution.toolCalls;
  }
  return 0;
}

function finalizeResult(frame, status, plan, verdict) {
  const attempts = status === 'failed' ? frame.attempts : frame.attempts + 1;
  const toolCalls = frame.history.reduce(
    (sum, entry) => sum + countExecutionToolCalls(entry.execution),
    0
  );
  const recovered = status === 'completed' && frame.history.slice(0, -1).some((entry) => entry.verdict && !entry.verdict.ok);
  return {
    taskId: frame.taskId,
    status,
    attempts,
    toolCalls,
    retries: Math.max(attempts - 1, 0),
    plan,
    verdict,
    frame,
    recovered,
  };
}

function stripTrace(result) {
  const { frame, ...publicResult } = result;
  return publicResult;
}

function createRebuildHints(page, state) {
  return async (hintId) => {
    const previousHint = state.hintMap.find((hint) => hint.id === hintId);
    await syncPageState(page, state, { force: true });
    if (!previousHint) return null;
    return rebindHintCandidate(previousHint, state.hintMap);
  };
}

async function verifySearchOutcome({
  page,
  state,
  plan,
  snapshot,
  deps = {},
}) {
  const prevDomRevision = snapshot?.domRevision ?? 0;
  const prevUrl = snapshot?.url ?? (await page.url());
  const prevContent = snapshot?.content?.text ?? '';
  const syncState = deps.syncState ?? syncPageState;
  await syncState(page, state, { force: true });
  const currentDomRevision = state.pageState.domRevision;
  const currentUrl = page.url();
  const readyState = await page.evaluate(() => document.readyState);
  const extractContent = deps.extractContent ?? extractMainContent;
  const newContent = (await extractContent(page)).text;
  const evidence = {
    domRevision: currentDomRevision,
    url: currentUrl,
    content: newContent,
    readyState,
  };

  if (
    currentDomRevision !== prevDomRevision ||
    currentUrl !== prevUrl ||
    newContent !== prevContent
  ) {
    return { ok: true, evidence };
  }

  if (readyState !== 'complete') {
    return { ok: false, error_code: LOADING_PENDING, evidence };
  }

  return { ok: false, error_code: NO_EFFECT, evidence };
}

async function executeSearchTask({
  query,
  observer,
  executor,
  verifier,
  waitThenReverify,
  maxAttempts = 3,
  taskId,
}) {
  const frame = createTaskFrame({
    taskId: taskId ?? `search-${Date.now()}`,
    kind: 'search_task',
    maxAttempts,
  });
  const waitFn = typeof waitThenReverify === 'function'
    ? waitThenReverify
    : async () => undefined;

  for (; frame.attempts < frame.maxAttempts; frame.attempts += 1) {
    const observerResult = await observer({ query, frame });
    const snapshot = observerResult?.snapshot ?? observerResult;
    const plan = chooseSearchPlan(snapshot, frame);
    const execution = await executor(plan);
    const verdict = await verifier({ plan, execution, snapshot, frame });
    frame.history.push({ snapshot, plan, execution, verdict });

    if (verdict.ok) {
      return finalizeResult(frame, 'completed', plan, verdict);
    }

    if (verdict.error_code === LOADING_PENDING) {
      await waitFn({ plan, snapshot, frame, query });
      const retryVerdict = await verifier({ plan, execution, snapshot, frame, retry: true });
      frame.history.push({ phase: 'wait_then_reverify', plan, verdict: retryVerdict });
      if (retryVerdict.ok) {
        return finalizeResult(frame, 'completed', plan, retryVerdict);
      }
      applyRecovery(frame, retryVerdict);
      continue;
    }

    applyRecovery(frame, verdict);
  }

  return finalizeResult(frame, 'failed', null, null);
}

export async function runSearchTask(options) {
  const result = await executeSearchTask(options);
  return stripTrace(result);
}

export async function runSearchTaskTool({
  state,
  query,
  max_attempts = 3,
  deps = {},
}) {
  const {
    getActivePage: getActivePageOverride,
    observer: observerOverride,
    executor: executorOverride,
    verifier: verifierOverride,
    waitThenReverify: waitThenReverifyOverride,
    waitStableAction: waitStableActionOverride,
    extractContentAction: extractContentActionOverride,
    typeAction: typeActionOverride,
    clickAction: clickActionOverride,
    pressKeyAction: pressKeyActionOverride,
    syncStateAction: syncStateActionOverride,
  } = deps;

  const getPage = getActivePageOverride ?? getActivePage;
  const waitStableAction = waitStableActionOverride ?? waitUntilStable;
  const extractContentAction = extractContentActionOverride ?? extractMainContent;
  const typeAction = typeActionOverride ?? typeByHintId;
  const clickAction = clickActionOverride ?? clickByHintId;
  const pressKeyAction = pressKeyActionOverride ?? pressKey;
  const syncStateAction = syncStateActionOverride ?? syncPageState;

  const page = await getPage();
  const rebuildHints = createRebuildHints(page, state);
  let observer = observerOverride;
  if (!observer) {
    observer = ({ frame }) => observeSearchSnapshot({
      page,
      state,
      query,
      frame,
      deps: { waitStable: waitStableAction, extractContent: extractContentAction },
    });
  }

  let executor = executorOverride;
  if (!executor) {
    executor = async (plan) => {
      if (!plan.searchInputHintId) {
        return { ok: false, error_code: EXECUTION_FAILED };
      }
      let actionCount = 0;
      try {
        if (plan.mode === 'primary_submit') {
          await typeAction(page, plan.searchInputHintId, query, true, { rebuildHints });
          actionCount += 1;
        } else if (plan.mode === 'alternate_submit') {
          await typeAction(page, plan.searchInputHintId, query, false, { rebuildHints });
          actionCount += 1;
          if (plan.submitHintId) {
            await clickAction(page, plan.submitHintId, { rebuildHints });
            actionCount += 1;
          } else {
            await pressKeyAction(page, 'Enter');
            actionCount += 1;
          }
        } else {
          await pressKeyAction(page, 'Enter');
          actionCount += 1;
        }
        await syncStateAction(page, state, { force: true });
        return { ok: true, toolCalls: actionCount };
      } catch (err) {
        return {
          ok: false,
          error_code: EXECUTION_FAILED,
          toolCalls: actionCount,
          evidence: { message: err.message },
        };
      }
    };
  }

  let verifier = verifierOverride;
  if (!verifier) {
    verifier = ({ plan, snapshot }) =>
      verifySearchOutcome({
        page,
        state,
        plan,
        snapshot,
        deps: {
          extractContent: extractContentAction,
          syncState: syncStateAction,
        },
      });
  }

  let waitThenReverify = waitThenReverifyOverride;
  if (!waitThenReverify) {
    waitThenReverify = async () => {
      await waitStableAction(page, { stableChecks: 2, interval: 120, timeout: 2000 });
    };
  }

  const result = await executeSearchTask({
    query,
    observer,
    executor,
    verifier,
    waitThenReverify,
    maxAttempts: max_attempts,
    taskId: `search-tool-${Date.now()}`,
  });

  state.taskFrames.set(result.frame.taskId, result.frame);
  return stripTrace(result);
}
