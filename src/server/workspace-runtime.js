import { ACTION_NOT_VERIFIED, LOADING_PENDING } from './error-codes.js';
import { verifyGenericAction, verifyTypeResult } from './postconditions.js';
import { classifyWorkspaceSurface, getWorkspaceStatus, summarizeWorkspaceSnapshot } from './workspace-tasks.js';
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

function getActionControls(snapshot) {
  const controls = pick(snapshot, 'actionControls', 'action_controls', []);
  return Array.isArray(controls) ? controls : [];
}

function getSendLikeActionControls(snapshot) {
  return getActionControls(snapshot).filter((control) => {
    const label = String(control?.label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label.includes('发送')
      || label.includes('send')
      || label.includes('回复')
      || label.includes('提交');
  });
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

function buildSelectionUnresolved(reason, requestedLabel, matches = [], recoveryHint = null) {
  return {
    ...buildUnresolved(reason, requestedLabel, matches),
    recovery_hint: recoveryHint,
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

function buildWorkspaceExecuteBlocked(reason, requestedLabel, snapshot) {
  return {
    status: 'blocked',
    blocked: true,
    executed: false,
    reason,
    unresolved: null,
    failure: null,
    action: {
      kind: 'execute_action',
      status: 'blocked',
    },
    snapshot: normalizeWorkspaceSnapshot(snapshot ?? null),
    workspace: null,
    summary: null,
    requested_label: compactText(requestedLabel),
  };
}

function buildWorkspaceExecuteUnresolved(reason, requestedLabel, matches = [], recoveryHint = null, snapshot = null) {
  return {
    status: 'unresolved',
    blocked: false,
    executed: false,
    reason,
    unresolved: {
      reason,
      requested_label: compactText(requestedLabel),
      recovery_hint: recoveryHint,
      matches,
    },
    failure: null,
    action: {
      kind: 'execute_action',
      status: 'unresolved',
    },
    snapshot: normalizeWorkspaceSnapshot(snapshot ?? null),
    workspace: null,
    summary: null,
    requested_label: compactText(requestedLabel),
  };
}

function buildWorkspaceExecuteFailed(failure, snapshot) {
  return {
    status: 'failed',
    blocked: false,
    executed: true,
    reason: 'verification_failed',
    unresolved: null,
    failure,
    action: {
      kind: 'execute_action',
      status: 'failed',
    },
    snapshot: normalizeWorkspaceSnapshot(snapshot ?? null),
    workspace: null,
    summary: null,
  };
}

function getSelectionMatchLabel(item) {
  return normalizeLabel(item?.normalized_label ?? item?.label);
}

function getSelectionSnapshotDetails(snapshot) {
  const summary = summarizeWorkspaceSnapshot(snapshot ?? {});
  const activeItem = pick(snapshot, 'activeItem', 'active_item', null)
    ?? (summary.active_item_label ? { label: summary.active_item_label } : null);
  const detailAlignment = pick(snapshot, 'detailAlignment', 'detail_alignment', summary.detail_alignment);
  const selectionWindow = pick(snapshot, 'selectionWindow', 'selection_window', summary.selection_window);

  return {
    summary,
    activeItem,
    detailAlignment,
    selectionWindow,
  };
}

function resolveWorkspaceSelection(snapshot, requestedLabel) {
  if (isLoadingShell(snapshot)) {
    return {
      item: null,
      matches: [],
      unresolved: buildSelectionUnresolved('loading_shell', requestedLabel, [], 'reinspect_workspace'),
    };
  }

  const liveItems = getLiveItems(snapshot);
  const normalized = normalizeLabel(requestedLabel);
  const matches = liveItems.filter((item) => getSelectionMatchLabel(item) === normalized);

  if (matches.length > 1) {
    return {
      item: null,
      matches,
      unresolved: buildSelectionUnresolved('ambiguous_item', requestedLabel, matches, 'scroll_list'),
    };
  }

  if (matches.length === 0) {
    return {
      item: null,
      matches: [],
      unresolved: buildSelectionUnresolved(
        'not_in_visible_window',
        requestedLabel,
        [],
        liveItems.length > 0 ? 'scroll_list' : 'reinspect_workspace',
      ),
    };
  }

  return {
    item: matches[0],
    matches,
  };
}

function buildSelectionEvidence({
  requestedLabel,
  item,
  summary,
  activeItem,
  detailAlignment,
  selectionWindow,
  recoveryHint,
  matches = [],
}) {
  return {
    requested_label: compactText(requestedLabel),
    selected_item: item ? {
      label: item.label ?? null,
      hint_id: item.hint_id ?? null,
      selected: item.selected === true,
    } : null,
    active_item: activeItem ? {
      label: activeItem.label ?? null,
      hint_id: activeItem.hint_id ?? null,
      selected: activeItem.selected === true,
    } : null,
    detail_alignment: detailAlignment,
    selection_window: selectionWindow,
    recovery_hint: recoveryHint ?? null,
    match_count: matches.length,
    summary: summary.summary,
  };
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

export async function selectWorkspaceItem(runtime, requestedLabel) {
  const state = runtime?.state ?? null;
  if (getWorkspaceStatus(state ?? {}) !== 'direct') {
    const snapshot = normalizeWorkspaceSnapshot(runtime?.snapshot ?? runtime ?? {});
    const details = getSelectionSnapshotDetails(snapshot);

    return {
      status: 'blocked',
      reason: getWorkspaceStatus(state ?? {}),
      selected_item: null,
      active_item: details.activeItem,
      detail_alignment: details.detailAlignment,
      snapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item: null,
        summary: details.summary,
        activeItem: details.activeItem,
        detailAlignment: details.detailAlignment,
        selectionWindow: details.selectionWindow,
        recoveryHint: 'reinspect_workspace',
        matches: [],
      }),
    };
  }

  const initialSnapshot = normalizeWorkspaceSnapshot(runtime?.snapshot ?? runtime ?? {});
  const resolution = resolveWorkspaceSelection(initialSnapshot, requestedLabel);

  if (!resolution.item) {
    const details = getSelectionSnapshotDetails(initialSnapshot);
    return {
      status: 'unresolved',
      unresolved: resolution.unresolved,
      selected_item: null,
      active_item: details.activeItem,
      detail_alignment: details.detailAlignment,
      snapshot: initialSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item: null,
        summary: details.summary,
        activeItem: details.activeItem,
        detailAlignment: details.detailAlignment,
        selectionWindow: details.selectionWindow,
        recoveryHint: resolution.unresolved?.recovery_hint ?? null,
        matches: resolution.matches ?? [],
      }),
    };
  }

  const item = resolution.item;
  const selectItem = typeof runtime?.selectItemByHint === 'function'
    ? runtime.selectItemByHint
    : typeof runtime?.clickByHintId === 'function' && compactText(item?.hint_id)
      ? async (candidate) => {
          const page = runtime?.page ?? runtime;
          await runtime.clickByHintId(page, candidate.hint_id, { rebuildHints: runtime?.rebuildHints });
          return { ok: true };
        }
      : null;

  if (typeof selectItem !== 'function') {
    const details = getSelectionSnapshotDetails(initialSnapshot);
    return {
      status: 'unresolved',
      unresolved: buildSelectionUnresolved('no_live_target', requestedLabel, [item], 'retry_selection'),
      selected_item: item,
      active_item: details.activeItem,
      detail_alignment: details.detailAlignment,
      snapshot: initialSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item,
        summary: details.summary,
        activeItem: details.activeItem,
        detailAlignment: details.detailAlignment,
        selectionWindow: details.selectionWindow,
        recoveryHint: 'retry_selection',
        matches: resolution.matches ?? [item],
      }),
    };
  }

  const executionResult = await selectItem(item);
  if (executionResult && executionResult.ok === false) {
    const details = getSelectionSnapshotDetails(initialSnapshot);
    return {
      status: 'unresolved',
      unresolved: executionResult.unresolved ?? buildSelectionUnresolved('retry_selection', requestedLabel, [item], 'retry_selection'),
      selected_item: item,
      active_item: details.activeItem,
      detail_alignment: details.detailAlignment,
      snapshot: initialSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item,
        summary: details.summary,
        activeItem: details.activeItem,
        detailAlignment: details.detailAlignment,
        selectionWindow: details.selectionWindow,
        recoveryHint: executionResult.unresolved?.recovery_hint ?? 'retry_selection',
        matches: resolution.matches ?? [item],
      }),
    };
  }

  const refreshedSnapshot = normalizeWorkspaceSnapshot(
    typeof runtime?.refreshSnapshot === 'function'
      ? await runtime.refreshSnapshot()
      : runtime?.snapshot ?? runtime ?? {},
  );

  if (typeof runtime?.persistSnapshot === 'function') {
    await runtime.persistSnapshot(refreshedSnapshot);
  }

  if (runtime && typeof runtime === 'object') {
    runtime.snapshot = refreshedSnapshot;
  }

  const refreshedDetails = getSelectionSnapshotDetails(refreshedSnapshot);
  const refreshedLiveItems = getLiveItems(refreshedSnapshot);
  const normalizedLabel = normalizeLabel(requestedLabel);
  const targetHintId = compactText(item?.hint_id);
  const activeMatch = normalizeLabel(refreshedDetails.activeItem?.label) === normalizedLabel;
  const activeHintMatch = targetHintId && compactText(refreshedDetails.activeItem?.hint_id) === targetHintId;
  const selectedMatch = refreshedLiveItems.some((liveItem) => (
    liveItem?.selected === true
    && getSelectionMatchLabel(liveItem) === normalizedLabel
  ));
  const selectedHintMatch = targetHintId && refreshedLiveItems.some((liveItem) => (
    liveItem?.selected === true
    && compactText(liveItem?.hint_id) === targetHintId
  ));
  const detailAlignment = refreshedDetails.detailAlignment;
  const selectionConfirmed = targetHintId
    ? activeHintMatch || selectedHintMatch
    : activeMatch || selectedMatch;

  if (detailAlignment === 'mismatch') {
    return {
      status: 'unresolved',
      unresolved: buildSelectionUnresolved('detail_panel_mismatch', requestedLabel, [item], 'reinspect_workspace'),
      selected_item: item,
      active_item: refreshedDetails.activeItem,
      detail_alignment: detailAlignment,
      snapshot: refreshedSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item,
        summary: refreshedDetails.summary,
        activeItem: refreshedDetails.activeItem,
        detailAlignment,
        selectionWindow: refreshedDetails.selectionWindow,
        recoveryHint: 'reinspect_workspace',
        matches: resolution.matches ?? [item],
      }),
    };
  }

  if (selectionConfirmed) {
    return {
      status: 'selected',
      selected_item: item,
      active_item: refreshedDetails.activeItem,
      detail_alignment: detailAlignment,
      snapshot: refreshedSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item,
        summary: refreshedDetails.summary,
        activeItem: refreshedDetails.activeItem,
        detailAlignment,
        selectionWindow: refreshedDetails.selectionWindow,
        recoveryHint: refreshedDetails.summary.recovery_hint ?? null,
        matches: resolution.matches ?? [item],
      }),
    };
  }

  return {
    status: 'unresolved',
    unresolved: buildSelectionUnresolved('virtualized_window_changed', requestedLabel, [item], 'retry_selection'),
    selected_item: item,
    active_item: refreshedDetails.activeItem,
    detail_alignment: detailAlignment,
    snapshot: refreshedSnapshot,
    selection_evidence: buildSelectionEvidence({
      requestedLabel,
      item,
      summary: refreshedDetails.summary,
      activeItem: refreshedDetails.activeItem,
      detailAlignment,
      selectionWindow: refreshedDetails.selectionWindow,
      recoveryHint: 'retry_selection',
      matches: resolution.matches ?? [item],
    }),
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

export async function executeWorkspaceAction(runtime, options = {}) {
  const state = runtime?.state ?? null;
  const gatewayStatus = getWorkspaceStatus(state ?? {});
  const initialSnapshot = normalizeWorkspaceSnapshot(runtime?.snapshot ?? runtime ?? {});
  const action = options?.action ?? 'send';
  const mode = options?.mode ?? 'preview';
  const confirmation = options?.confirmation;

  if (gatewayStatus !== 'direct') {
    return {
      status: 'blocked',
      blocked: true,
      executed: false,
      reason: gatewayStatus,
      unresolved: null,
      failure: null,
      action: {
        kind: 'execute_action',
        status: 'blocked',
      },
      snapshot: initialSnapshot,
      workspace: null,
      summary: null,
    };
  }

  if (action !== 'send') {
    return buildWorkspaceExecuteUnresolved('unsupported_action', action, [], null, initialSnapshot);
  }

  const sendControl = getSendLikeActionControls(initialSnapshot)[0] ?? null;
  if (!sendControl || !compactText(sendControl?.hint_id)) {
    return buildWorkspaceExecuteUnresolved('no_live_target', 'send', sendControl ? [sendControl] : [], 'reinspect_workspace', initialSnapshot);
  }

  if (mode === 'preview') {
    return buildWorkspaceExecuteBlocked('preview_safe', 'send', initialSnapshot);
  }

  if (confirmation !== 'EXECUTE') {
    return buildWorkspaceExecuteBlocked('confirmation_required', 'send', initialSnapshot);
  }

  const page = runtime?.page ?? runtime;
  const click = runtime?.clickByHintId ?? clickByHintId;
  const rebuildHints = runtime?.rebuildHints;
  const execute = runtime?.executeGuardedAction ?? executeGuardedAction;
  const verify = runtime?.verifyActionOutcome ?? verifyActionOutcome;

  const execution = await execute({
    runtime,
    execute: async () => {
      await click(page, sendControl.hint_id, { rebuildHints });
      return { control: sendControl };
    },
    verify: async ({ snapshot: refreshedSnapshot, executionResult }) => {
      const verification = await verify({
        page,
        kind: 'execute_action',
        target: 'send',
        hintId: sendControl.hint_id,
        outcomeSignals: refreshedSnapshot?.outcome_signals ?? null,
        snapshot: refreshedSnapshot,
      });

      if (!verification.ok) {
        return {
          ok: false,
          failure: {
            error_code: verification.error_code ?? 'ACTION_NOT_VERIFIED',
            retryable: verification.retryable ?? true,
            suggested_next_step: verification.suggested_next_step ?? 'reverify',
          },
          evidence: verification.evidence ?? {
            kind: 'execute_action',
            target: 'send',
            executionResult,
          },
        };
      }

      return {
        ok: true,
        evidence: verification.evidence ?? {
          kind: 'execute_action',
          target: 'send',
          executionResult,
        },
        verification: {
          delivered: refreshedSnapshot?.outcome_signals?.delivered === true,
          composer_cleared: refreshedSnapshot?.outcome_signals?.composer_cleared === true,
          active_item_stable: refreshedSnapshot?.outcome_signals?.active_item_stable === true,
        },
      };
    },
  });

  const resultSnapshot = normalizeWorkspaceSnapshot(execution?.snapshot ?? runtime?.snapshot ?? initialSnapshot);

  if (runtime && typeof runtime === 'object') {
    runtime.snapshot = resultSnapshot;
  }

  if (!execution?.ok) {
    return buildWorkspaceExecuteFailed(
      execution?.failure ?? {
        error_code: execution?.error_code ?? 'ACTION_NOT_VERIFIED',
        retryable: execution?.retryable ?? true,
        suggested_next_step: execution?.suggested_next_step ?? 'reverify',
      },
      resultSnapshot,
    );
  }

  return {
    status: 'success',
    blocked: false,
    executed: true,
    reason: null,
    unresolved: null,
    failure: null,
    verification: execution.verification ?? {
      delivered: resultSnapshot?.outcome_signals?.delivered === true,
      composer_cleared: resultSnapshot?.outcome_signals?.composer_cleared === true,
      active_item_stable: resultSnapshot?.outcome_signals?.active_item_stable === true,
    },
    action: {
      kind: 'execute_action',
      status: 'executed',
    },
    snapshot: resultSnapshot,
    workspace: null,
    summary: resultSnapshot?.summary?.summary ?? resultSnapshot?.summary_text ?? null,
  };
}
