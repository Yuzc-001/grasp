import { ACTION_NOT_VERIFIED } from './error-codes.js';

export async function verifyTypeResult({ page, expectedText }) {
  const evidence = await page.evaluate(() => {
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase() ?? '';
    const value = active?.value ?? '';
    const isFormField = ['input', 'textarea'].includes(tag) || active?.isContentEditable;
    return { value, tag, isFormField };
  });

  if (evidence.value === expectedText && evidence.isFormField) {
    return { ok: true, evidence };
  }

  return {
    ok: false,
    error_code: ACTION_NOT_VERIFIED,
    retryable: true,
    suggested_next_step: 'reverify',
    evidence,
  };
}

export async function verifyGenericAction({ page, hintId, prevDomRevision, prevUrl, prevActiveId, newDomRevision }) {
  const snapshot = await page.evaluate((targetId) => {
    const el = targetId ? document.querySelector(`[data-grasp-id="${targetId}"]`) : null;
    const activeId = document.activeElement?.getAttribute('data-grasp-id') ?? null;
    return {
      elementVisible: !!el,
      activeId,
    };
  }, hintId);

  const currentUrl = page.url();
  const domChanged = typeof newDomRevision === 'number' && newDomRevision !== prevDomRevision;
  const urlChanged = currentUrl !== prevUrl;
  const activeChanged = snapshot.activeId !== prevActiveId;

  if (domChanged || urlChanged || snapshot.elementVisible || activeChanged) {
    return {
      ok: true,
      evidence: {
        url: currentUrl,
        elementVisible: snapshot.elementVisible,
        activeId: snapshot.activeId,
        domRevision: newDomRevision,
      },
    };
  }

  return {
    ok: false,
    error_code: ACTION_NOT_VERIFIED,
    retryable: true,
    suggested_next_step: 'reverify',
    evidence: {
      url: currentUrl,
      elementVisible: snapshot.elementVisible,
      activeId: snapshot.activeId,
      domRevision: newDomRevision,
    },
  };
}
