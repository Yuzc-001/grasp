import { getWorkspaceStatus, summarizeWorkspaceSnapshot } from './workspace-tasks.js';

import { clickByHintId } from '../layer3-action/actions.js';

import {

  buildUnresolved,

  compactText,

  getLiveItems,

  getSelectionMatchLabel,

  getSelectionSnapshotDetails,

  getWorkspaceSurface,

  isLoadingShell,

  normalizeLabel,

  normalizeWorkspaceSnapshot,

  pick,

} from './workspace-runtime.shared.js';


function buildSelectionUnresolved(reason, requestedLabel, matches = [], recoveryHint = null) {
  return {
    ...buildUnresolved(reason, requestedLabel, matches),
    recovery_hint: recoveryHint,
  };
}

function buildUnsupportedWorkspace(requestedLabel) {
  return buildUnresolved('unsupported_workspace', requestedLabel);
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

export async function verifySelectionResult({ snapshot, item, identitySensitive = false }) {
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
    error_code: 'ACTION_NOT_VERIFIED',
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

  const rawInitialSnapshot = runtime?.snapshot ?? runtime ?? {};
  const initialSnapshot = normalizeWorkspaceSnapshot(rawInitialSnapshot);
  const initialPageUrl = typeof runtime?.page?.url === 'function' ? runtime.page.url() : null;
  const initialDomRevision = state?.pageState?.domRevision ?? null;
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
  const navigationLike = pick(rawInitialSnapshot, 'workspaceSurface', 'workspace_surface', null) === 'list'
    || state?.pageState?.workspaceSurface === 'list'
    || state?.pageState?.currentRole === 'navigation-heavy';
  if (navigationLike && item.selected === true) {
    const details = getSelectionSnapshotDetails(initialSnapshot);
    return {
      status: 'selected',
      selected_item: item,
      active_item: details.activeItem ?? { label: item.label },
      detail_alignment: details.detailAlignment,
      snapshot: initialSnapshot,
      selection_evidence: buildSelectionEvidence({
        requestedLabel,
        item,
        summary: details.summary,
        activeItem: details.activeItem ?? { label: item.label, selected: true },
        detailAlignment: details.detailAlignment,
        selectionWindow: details.selectionWindow,
        recoveryHint: details.summary.recovery_hint ?? null,
        matches: resolution.matches ?? [item],
      }),
    };
  }

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

  const rawRefreshedSnapshot = typeof runtime?.refreshSnapshot === 'function'
    ? await runtime.refreshSnapshot()
    : runtime?.snapshot ?? runtime ?? {};
  const refreshedSnapshot = normalizeWorkspaceSnapshot(rawRefreshedSnapshot);
  const refreshedPageUrl = typeof runtime?.page?.url === 'function' ? runtime.page.url() : null;
  const refreshedDomRevision = state?.pageState?.domRevision ?? null;

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
    liveItem?.selected === true && getSelectionMatchLabel(liveItem) === normalizedLabel
  ));
  const selectedHintMatch = targetHintId && refreshedLiveItems.some((liveItem) => (
    liveItem?.selected === true && compactText(liveItem?.hint_id) === targetHintId
  ));
  const detailAlignment = refreshedDetails.detailAlignment;
  const navigationLikeAfter = pick(rawInitialSnapshot, 'workspaceSurface', 'workspace_surface', null) === 'list'
    || pick(rawRefreshedSnapshot, 'workspaceSurface', 'workspace_surface', null) === 'list'
    || state?.pageState?.workspaceSurface === 'list'
    || state?.pageState?.currentRole === 'navigation-heavy';
  const navigationTransitionDetected = (
    initialPageUrl && refreshedPageUrl && initialPageUrl !== refreshedPageUrl
  ) || (
    initialDomRevision !== null && refreshedDomRevision !== null && initialDomRevision !== refreshedDomRevision
  );
  const labelStillVisible = refreshedLiveItems.some((liveItem) => getSelectionMatchLabel(liveItem) === normalizedLabel);
  const navigationConfirmed = navigationLikeAfter
    && detailAlignment !== 'mismatch'
    && (
      selectedMatch
      || activeMatch
      || (navigationTransitionDetected && labelStillVisible && refreshedDetails.selectionWindow !== 'not_found')
    );
  const selectionConfirmed = targetHintId
    ? activeHintMatch || selectedHintMatch || navigationConfirmed
    : activeMatch || selectedMatch || navigationConfirmed;

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
