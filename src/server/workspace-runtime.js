import { ACTION_NOT_VERIFIED, LOADING_PENDING } from './error-codes.js';
import { verifyGenericAction, verifyTypeResult } from './postconditions.js';
import { classifyWorkspaceSurface, summarizeWorkspaceSnapshot } from './workspace-tasks.js';
import { clickByHintId, typeByHintId } from '../layer3-action/actions.js';

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return compactText(value).toLowerCase();
}

function pick(snapshot, camelKey, snakeKey, fallback = null) {
  if (snapshot?.[camelKey] !== undefined) return snapshot[camelKey];
  if (snapshot?.[snakeKey] !== undefined) return snapshot[snakeKey];
  return fallback;
}

function getLiveItems(snapshot) {
  const items = pick(snapshot, 'liveItems', 'live_items', []);
  return Array.isArray(items) ? items : [];
}

function getComposer(snapshot) {
  const composer = pick(snapshot, 'composer', 'composer', null);
  return composer && typeof composer === 'object' ? composer : null;
}

function getWorkspaceSurface(snapshot) {
  return pick(snapshot, 'workspaceSurface', 'workspace_surface', null) ?? classifyWorkspaceSurface(snapshot);
}

function isLoadingShell(snapshot) {
  return pick(snapshot, 'loadingShell', 'loading_shell', false) === true
    || getWorkspaceSurface(snapshot) === 'loading_shell';
}

function buildUnresolved(reason, requestedLabel, matches = []) {
  return {
    reason,
    requested_label: compactText(requestedLabel),
    matches: matches.map((item) => ({
      label: item.label,
      hint_id: item.hint_id ?? null,
    })),
  };
}

function normalizeWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot;
  }

  const summary = summarizeWorkspaceSnapshot(snapshot);
  return {
    ...snapshot,
    summary: snapshot.summary !== undefined ? snapshot.summary : summary,
    summary_text: summary.summary,
    outcome_signals: summary.outcome_signals,
    loading_shell: summary.loading_shell,
    workspace_surface: summary.workspace_surface,
  };
}

function buildUnsupportedWorkspace(requestedLabel) {
  return buildUnresolved('unsupported_workspace', requestedLabel);
}

export function resolveLiveItem(snapshot, requestedLabel) {
  if (isLoadingShell(snapshot)) {
    return {
      item: null,
      ambiguous: false,
      matches: [],
      unresolved: buildUnresolved('loading_shell', requestedLabel),
    };
  }

  const liveItems = getLiveItems(snapshot);
  const normalized = normalizeLabel(requestedLabel);
  const matches = liveItems.filter((item) => normalizeLabel(item?.normalized_label ?? item?.label) === normalized);
  const hintBacked = matches.filter((item) => compactText(item?.hint_id));
  const identitySensitive = matches.length > 1 && hintBacked.length > 0;

  if (hintBacked.length === 1) {
    return {
      item: hintBacked[0],
      ambiguous: false,
      matches,
      identity_sensitive: identitySensitive,
    };
  }

  if (matches.length === 1) {
    return {
      item: matches[0],
      ambiguous: false,
      matches,
      identity_sensitive: identitySensitive,
    };
  }

  if (matches.length > 1) {
    return {
      item: null,
      ambiguous: true,
      matches,
      identity_sensitive: identitySensitive,
      unresolved: buildUnresolved('ambiguous_item', requestedLabel, hintBacked.length > 0 ? hintBacked : matches),
    };
  }

  if (getWorkspaceSurface(snapshot) == null) {
    return {
      item: null,
      ambiguous: false,
      matches: [],
      identity_sensitive: identitySensitive,
      unresolved: buildUnsupportedWorkspace(requestedLabel),
    };
  }

  return {
    item: null,
    ambiguous: false,
    matches: [],
    identity_sensitive: identitySensitive,
    unresolved: buildUnresolved('no_live_target', requestedLabel),
  };
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

export async function verifySelectionResult({
  snapshot,
  item,
  identitySensitive = false,
}) {
  const summary = summarizeWorkspaceSnapshot(snapshot ?? {});
  const liveItems = getLiveItems(snapshot);
  const normalizedLabel = normalizeLabel(item?.label);
  const activeItem = pick(snapshot, 'activeItem', 'active_item', null);
  const activeLabel = compactText(activeItem?.label ?? summary.active_item_label ?? '');
  const activeMatch = normalizeLabel(activeLabel) === normalizedLabel;
  const activeHintMatch = Boolean(compactText(activeItem?.hint_id)) && compactText(activeItem?.hint_id) === compactText(item?.hint_id);
  const selectedMatch = liveItems.some((liveItem) => (
    liveItem?.selected === true
    && normalizeLabel(liveItem?.normalized_label ?? liveItem?.label) === normalizedLabel
    && compactText(liveItem?.hint_id) === compactText(item?.hint_id)
  ));
  const detailAlignment = pick(snapshot, 'detailAlignment', 'detail_alignment', summary.detail_alignment);
  const selectionWindow = pick(snapshot, 'selectionWindow', 'selection_window', summary.selection_window);

  if ((selectedMatch || activeHintMatch || (activeMatch && !identitySensitive)) && detailAlignment !== 'mismatch' && selectionWindow !== 'not_found') {
    return {
      ok: true,
      evidence: {
        target: item?.label ?? null,
        hint_id: item?.hint_id ?? null,
        active_item_label: activeLabel || null,
        active_item_hint_id: compactText(activeItem?.hint_id) || null,
        detail_alignment: detailAlignment,
        selection_window: selectionWindow,
        active_match: activeMatch,
        active_hint_match: activeHintMatch,
        selected_match: selectedMatch,
        identity_sensitive: identitySensitive,
        summary: summary.summary,
      },
    };
  }

  return {
    ok: false,
    error_code: ACTION_NOT_VERIFIED,
    retryable: true,
    suggested_next_step: 'reverify',
    evidence: {
      target: item?.label ?? null,
      hint_id: item?.hint_id ?? null,
      active_item_label: activeLabel || null,
      active_item_hint_id: compactText(activeItem?.hint_id) || null,
      detail_alignment: detailAlignment,
      selection_window: selectionWindow,
      active_match: activeMatch,
      active_hint_match: activeHintMatch,
      selected_match: selectedMatch,
      identity_sensitive: identitySensitive,
      summary: summary.summary,
    },
  };
}

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
      || pick(snapshot, 'workspaceSurface', 'workspace_surface', null) === 'loading_shell'
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

export async function executeGuardedAction(runtimeOrOptions, execute, verify) {
  const options = runtimeOrOptions && typeof runtimeOrOptions === 'object' && 'runtime' in runtimeOrOptions
    ? runtimeOrOptions
    : {
        runtime: runtimeOrOptions,
        execute,
        verify,
      };
  const runtime = options.runtime;
  const run = options.execute ?? execute;
  const check = options.verify ?? verify;

  const executionResult = await run();
  const refreshedSnapshot = typeof runtime?.refreshSnapshot === 'function'
    ? await runtime.refreshSnapshot()
    : runtime?.snapshot ?? null;
  const snapshot = normalizeWorkspaceSnapshot(refreshedSnapshot);

  if (typeof runtime?.persistSnapshot === 'function') {
    await runtime.persistSnapshot(snapshot);
  }

  if (runtime && typeof runtime === 'object') {
    runtime.snapshot = snapshot;
  }

  const verification = typeof check === 'function'
    ? await check({ executionResult, snapshot })
    : { ok: true };

  return {
    ...verification,
    executionResult,
    snapshot,
  };
}

export async function selectItemByHint(runtime, requestedLabel, options = {}) {
  const snapshot = runtime?.snapshot ?? runtime;
  const resolution = resolveLiveItem(snapshot, requestedLabel);

  if (!resolution.item) {
    return {
      ok: false,
      unresolved: resolution.unresolved,
      snapshot,
    };
  }

  const item = resolution.item;
  if (!compactText(item?.hint_id)) {
    return {
      ok: false,
      unresolved: buildUnresolved('no_live_target', requestedLabel, [item]),
      snapshot,
    };
  }

  const page = runtime?.page ?? runtime;
  const click = runtime?.clickByHintId ?? clickByHintId;
  const rebuildHints = runtime?.rebuildHints;

  return executeGuardedAction(runtime, async () => {
    await click(page, item.hint_id, { rebuildHints });
    return { item };
  }, async ({ snapshot: refreshedSnapshot }) => {
    return verifySelectionResult({
      snapshot: refreshedSnapshot,
      item,
      identitySensitive: resolution.identity_sensitive ?? false,
    });
  });
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
