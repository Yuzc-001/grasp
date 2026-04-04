import { getWorkspaceStatus } from './workspace-tasks.js';
import { typeByHintId } from '../layer3-action/actions.js';
import { executeGuardedAction } from './workspace-runtime.selection.js';
import { verifyActionOutcome } from './workspace-runtime.verify.js';
import {
  buildUnresolved,
  compactText,
  getComposer,
  getWorkspaceSurface,
  isLoadingShell,
  normalizeWorkspaceSnapshot,
} from './workspace-runtime.shared.js';

function buildUnsupportedWorkspace(requestedLabel) {
  return buildUnresolved('unsupported_workspace', requestedLabel);
}

export function resolveComposer(snapshot) {
  if (isLoadingShell(snapshot)) {
    return {
      composer: null,
      ambiguous: false,
      unresolved: buildUnresolved('loading_shell', 'composer'),
    };
  }

  const composer = getComposer(snapshot);
  if (composer) {
    return {
      composer,
      ambiguous: false,
    };
  }

  if (getWorkspaceSurface(snapshot) == null) {
    return {
      composer: null,
      ambiguous: false,
      unresolved: buildUnsupportedWorkspace('composer'),
    };
  }

  return {
    composer: null,
    ambiguous: false,
    unresolved: buildUnresolved('no_live_target', 'composer'),
  };
}

export function createWorkspaceWriteEvidence({ kind, target }) {
  return {
    kind,
    target,
    autosave_possible: true,
    write_side_effect: 'draft_mutation_possible',
  };
}

export async function draftIntoComposer(runtime, text, options = {}) {
  const snapshot = runtime?.snapshot ?? runtime;
  const resolution = resolveComposer(snapshot);

  if (!resolution.composer) {
    return {
      ok: false,
      unresolved: resolution.unresolved,
      snapshot,
    };
  }

  const composer = resolution.composer;
  if (!compactText(composer?.hint_id)) {
    return {
      ok: false,
      unresolved: buildUnresolved('no_live_target', 'composer', [composer]),
      snapshot,
    };
  }

  const page = runtime?.page ?? runtime;
  const type = runtime?.typeByHintId ?? typeByHintId;
  const rebuildHints = runtime?.rebuildHints;
  const prevUrl = typeof page?.url === 'function' ? page.url() : null;
  const prevDomRevision = snapshot?.domRevision ?? 0;
  const pressEnter = false;

  return executeGuardedAction(runtime, async () => {
    await type(page, composer.hint_id, text, pressEnter, { rebuildHints });
    return { composer, text };
  }, async ({ snapshot: refreshedSnapshot }) => {
    if (typeof page?.evaluate !== 'function' || typeof page?.url !== 'function') {
      return {
        ok: true,
        evidence: createWorkspaceWriteEvidence({ kind: 'draft_action', target: composer.kind ?? 'chat_composer' }),
      };
    }

    const newDomRevision = refreshedSnapshot?.domRevision ?? prevDomRevision;

    return verifyActionOutcome({
      page,
      kind: 'draft_action',
      target: composer.kind ?? 'chat_composer',
      expectedText: text,
      allowPageChange: false,
      prevUrl,
      prevDomRevision,
      newDomRevision,
      outcomeSignals: refreshedSnapshot?.outcome_signals ?? null,
      snapshot: refreshedSnapshot,
    });
  });
}

export async function draftWorkspaceAction(runtime, text, options = {}) {
  const state = runtime?.state ?? null;
  const gatewayStatus = getWorkspaceStatus(state ?? {});
  const initialSnapshot = normalizeWorkspaceSnapshot(runtime?.snapshot ?? runtime ?? {});

  if (gatewayStatus !== 'direct') {
    const composer = resolveComposer(initialSnapshot).composer ?? getComposer(initialSnapshot);

    return {
      status: 'blocked',
      reason: gatewayStatus,
      draft_present: initialSnapshot?.composer?.draft_present === true,
      snapshot: initialSnapshot,
      draft_evidence: {
        ...createWorkspaceWriteEvidence({ kind: 'draft_action', target: composer?.kind ?? 'chat_composer' }),
        draft_present: initialSnapshot?.composer?.draft_present === true,
      },
      action: {
        kind: 'draft_action',
        status: 'blocked',
      },
    };
  }

  const resolution = resolveComposer(initialSnapshot);
  if (!resolution.composer) {
    return {
      status: 'unresolved',
      draft_present: initialSnapshot?.composer?.draft_present === true,
      unresolved: resolution.unresolved,
      snapshot: initialSnapshot,
      action: {
        kind: 'draft_action',
        status: 'unresolved',
      },
    };
  }

  const composer = resolution.composer;
  if (!compactText(composer?.hint_id)) {
    return {
      status: 'unresolved',
      draft_present: initialSnapshot?.composer?.draft_present === true,
      unresolved: buildUnresolved('no_live_target', 'composer', [composer]),
      snapshot: initialSnapshot,
      action: {
        kind: 'draft_action',
        status: 'unresolved',
      },
    };
  }

  const draft = typeof runtime?.draftIntoComposer === 'function'
    ? runtime.draftIntoComposer
    : draftIntoComposer;

  const draftResult = await draft(runtime, text, options);
  const resultSnapshot = normalizeWorkspaceSnapshot(draftResult?.snapshot ?? runtime?.snapshot ?? initialSnapshot);

  if (runtime && typeof runtime === 'object') {
    runtime.snapshot = resultSnapshot;
  }

  if (!draftResult?.ok) {
    const resultStatus = draftResult?.unresolved ? 'unresolved' : 'failed';

    return {
      status: resultStatus,
      draft_present: resultSnapshot?.composer?.draft_present === true,
      unresolved: draftResult?.unresolved ?? null,
      error_code: draftResult?.error_code ?? null,
      retryable: draftResult?.retryable ?? null,
      suggested_next_step: draftResult?.suggested_next_step ?? null,
      snapshot: resultSnapshot,
      action: {
        kind: 'draft_action',
        status: resultStatus,
      },
    };
  }

  return {
    status: 'drafted',
    draft_present: resultSnapshot?.composer?.draft_present === true,
    snapshot: resultSnapshot,
    draft_evidence: {
      ...createWorkspaceWriteEvidence({ kind: 'draft_action', target: composer.kind ?? 'chat_composer' }),
      draft_present: resultSnapshot?.composer?.draft_present === true,
      summary: resultSnapshot?.summary?.summary ?? resultSnapshot?.summary_text ?? null,
    },
    action: {
      kind: 'draft_action',
      status: 'drafted',
    },
  };
}
