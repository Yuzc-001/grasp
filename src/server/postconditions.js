import { ACTION_NOT_VERIFIED } from './error-codes.js';

const EXECUTION_CONTEXT_DESTROYED = 'Execution context was destroyed';

function isExecutionContextDestroyed(error) {
  return typeof error?.message === 'string' && error.message.includes(EXECUTION_CONTEXT_DESTROYED);
}

export async function verifyTypeResult({
  page,
  expectedText,
  allowPageChange = false,
  prevUrl = null,
  prevDomRevision = null,
  newDomRevision = null,
}) {
  const currentUrl = page.url();
  const hasPrevDom = typeof prevDomRevision === 'number';
  const hasNewDom = typeof newDomRevision === 'number';
  const domRevisionValue = hasNewDom ? newDomRevision : hasPrevDom ? prevDomRevision : null;
  const domChanged = hasPrevDom && hasNewDom && newDomRevision !== prevDomRevision;
  const urlChanged = prevUrl != null && currentUrl !== prevUrl;
  const navigationObserved = allowPageChange && (domChanged || urlChanged);
  const baseEvidence = {
    url: currentUrl,
    domRevision: domRevisionValue,
    navigationObserved,
  };

  try {
    const evidence = await page.evaluate(() => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase() ?? '';
      const value = active?.value ?? '';
      const text = active?.innerText?.trim?.() ?? active?.textContent?.trim?.() ?? '';
      const isFormField = ['input', 'textarea'].includes(tag) || active?.isContentEditable;
      return { value, text, tag, isFormField };
    });

    const wroteExpectedText = evidence.value === expectedText || evidence.text === expectedText;
    if (wroteExpectedText && evidence.isFormField) {
      return { ok: true, evidence };
    }

    if (navigationObserved) {
      return { ok: true, evidence: baseEvidence };
    }

    return {
      ok: false,
      error_code: ACTION_NOT_VERIFIED,
      retryable: true,
      suggested_next_step: 'reverify',
      evidence,
    };
  } catch (error) {
    if (navigationObserved && isExecutionContextDestroyed(error)) {
      return { ok: true, evidence: baseEvidence };
    }

    return {
      ok: false,
      error_code: ACTION_NOT_VERIFIED,
      retryable: true,
      suggested_next_step: 'reverify',
      evidence: { ...baseEvidence, error: error?.message ?? null },
    };
  }
}

export async function verifyGenericAction({ page, hintId, prevDomRevision, prevUrl, prevActiveId, newDomRevision }) {
  const currentUrl = page.url();
  const domRevisionValue = typeof newDomRevision === 'number' ? newDomRevision : null;
  const baseEvidence = {
    url: currentUrl,
    domRevision: domRevisionValue,
  };

  let snapshot;
  let evaluateError = null;
  try {
    snapshot = await page.evaluate((targetId) => {
      const el = targetId ? document.querySelector(`[data-grasp-id="${targetId}"]`) : null;
      const activeId = document.activeElement?.getAttribute('data-grasp-id') ?? null;
      return {
        elementVisible: !!el,
        activeId,
      };
    }, hintId);
  } catch (error) {
    evaluateError = error;
    snapshot = {
      elementVisible: false,
      activeId: null,
    };
  }

  const domChanged = typeof newDomRevision === 'number' && typeof prevDomRevision === 'number' && newDomRevision !== prevDomRevision;
  const urlChanged = prevUrl != null && currentUrl !== prevUrl;
  const activeChanged = snapshot.activeId !== prevActiveId;
  const navigationObserved = domChanged || urlChanged;

  if (navigationObserved || activeChanged) {
    return {
      ok: true,
      evidence: {
        ...baseEvidence,
        elementVisible: snapshot.elementVisible,
        activeId: snapshot.activeId,
        navigationObserved,
      },
    };
  }

  return {
    ok: false,
    error_code: ACTION_NOT_VERIFIED,
    retryable: true,
    suggested_next_step: 'reverify',
    evidence: {
      ...baseEvidence,
      elementVisible: snapshot.elementVisible,
      activeId: snapshot.activeId,
      navigationObserved,
      error: evaluateError?.message ?? null,
    },
  };
}
