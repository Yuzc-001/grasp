import { ACTION_NOT_VERIFIED, LOADING_PENDING } from './error-codes.js';
import { verifyGenericAction, verifyTypeResult } from './postconditions.js';
import {
  compactText,
  getComposer,
  getWorkspaceSurface,
  isLoadingShell,
  pick,
} from './workspace-runtime.shared.js';
import { summarizeWorkspaceSnapshot } from './workspace-tasks.js';

export async function verifyActionOutcome({
  page,
  kind,
  target,
  hintId,
  expectedText,
  allowPageChange = false,
  prevUrl = null,
  prevDomRevision = null,
  prevActiveId = null,
  newDomRevision = null,
  outcomeSignals = null,
  snapshot = null,
}) {
  const loadingShell = snapshot
    ? pick(snapshot, 'loadingShell', 'loading_shell', false) === true
      || getWorkspaceSurface(snapshot) === 'loading_shell'
      || isLoadingShell(snapshot)
    : false;

  if (loadingShell) {
    return {
      ok: false,
      error_code: LOADING_PENDING,
      retryable: true,
      suggested_next_step: 'reverify',
      evidence: summarizeWorkspaceSnapshot(snapshot ?? {}),
    };
  }

  if (kind === 'draft_action' || expectedText !== undefined) {
    const typeResult = await verifyTypeResult({
      page,
      expectedText: expectedText ?? '',
      allowPageChange,
      prevUrl,
      prevDomRevision,
      newDomRevision,
    });

    if (typeResult.ok) {
      return typeResult;
    }

    const composer = getComposer(snapshot);
    const draftText = compactText(composer?.draft_text ?? composer?.draftText ?? '');
    if (composer?.draft_present === true && draftText === compactText(expectedText)) {
      return {
        ok: true,
        evidence: {
          kind,
          target,
          composer_kind: composer.kind ?? null,
          draft_present: true,
          draft_text: draftText,
          summary: snapshot ? pick(snapshot, 'summary', 'summary', null) : null,
        },
      };
    }

    return typeResult;
  }

  if (hintId) {
    return verifyGenericAction({
      page,
      hintId,
      prevDomRevision,
      prevUrl,
      prevActiveId,
      newDomRevision,
    });
  }

  if (outcomeSignals?.delivered || outcomeSignals?.composer_cleared || outcomeSignals?.active_item_stable) {
    return {
      ok: true,
      evidence: {
        kind,
        target,
        outcomeSignals,
      },
    };
  }

  return {
    ok: false,
    error_code: ACTION_NOT_VERIFIED,
    retryable: true,
    suggested_next_step: 'reverify',
    evidence: {
      kind,
      target,
      outcomeSignals,
    },
  };
}
