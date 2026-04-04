import { summarizeWorkspaceSnapshot } from './workspace-tasks.js';

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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

function getBlockingModals(snapshot) {
  const modals = pick(snapshot, 'blockingModals', 'blocking_modals', []);
  return Array.isArray(modals) ? modals : [];
}

function getLoadingShell(snapshot) {
  return pick(snapshot, 'loadingShell', 'loading_shell', false) === true;
}

function getActiveItem(snapshot) {
  const activeItem = pick(snapshot, 'activeItem', 'active_item', null);
  if (activeItem) {
    return activeItem;
  }

  const summaryLabel = compactText(snapshot?.summary?.active_item_label ?? '');
  if (summaryLabel) {
    return { label: summaryLabel };
  }

  const selectedLiveItem = getLiveItems(snapshot).find((item) => item?.selected === true);
  if (selectedLiveItem?.label) {
    return { label: compactText(selectedLiveItem.label) };
  }

  return null;
}

function toPublicLiveItem(item) {
  return {
    label: compactText(item?.label),
    selected: item?.selected === true,
  };
}

export function toPublicActiveItem(item) {
  if (!item) return null;
  return {
    label: compactText(item?.label),
  };
}

function toPublicComposer(composer) {
  if (!composer) return null;
  return {
    kind: composer.kind ?? 'chat_composer',
    draft_present: composer?.draft_present === true,
  };
}

function toPublicActionControl(control) {
  return {
    label: compactText(control?.label),
    action_kind: control?.action_kind ?? 'action',
  };
}

function toPublicBlockingModal(modal) {
  return {
    label: compactText(modal?.label),
  };
}

export function toPublicSelectionItem(item, selected = item?.selected === true) {
  if (!item) return null;
  return {
    label: compactText(item?.label),
    selected: selected === true,
  };
}

export function toPublicSelectionEvidence(evidence, selected = false) {
  if (!evidence) return null;

  return {
    requested_label: compactText(evidence?.requested_label),
    selected_item: toPublicSelectionItem(evidence?.selected_item, selected),
    active_item: toPublicActiveItem(evidence?.active_item),
    detail_alignment: evidence?.detail_alignment ?? 'unknown',
    selection_window: evidence?.selection_window ?? 'not_found',
    recovery_hint: evidence?.recovery_hint ?? null,
    match_count: evidence?.match_count ?? 0,
    summary: evidence?.summary ?? 'unknown',
  };
}

export function toPublicSelectionUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: compactText(unresolved.requested_label),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

export function toPublicDraftEvidence(draftEvidence) {
  if (!draftEvidence) return null;

  return {
    kind: draftEvidence.kind ?? 'draft_action',
    target: draftEvidence.target ?? 'chat_composer',
    autosave_possible: draftEvidence.autosave_possible === true,
    write_side_effect: draftEvidence.write_side_effect ?? 'draft_mutation_possible',
    draft_present: draftEvidence.draft_present === true,
    summary: draftEvidence.summary ?? null,
  };
}

export function toPublicDraftUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: compactText(unresolved.requested_label),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

export function toPublicDraftFailure(result) {
  const errorCode = result?.error_code ?? null;
  const retryable = result?.retryable;
  const suggestedNextStep = result?.suggested_next_step ?? null;

  if (!errorCode && retryable === undefined && suggestedNextStep == null) {
    return null;
  }

  return {
    error_code: errorCode,
    retryable: retryable ?? null,
    suggested_next_step: suggestedNextStep,
  };
}

export function toPublicExecuteUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: compactText(unresolved.requested_label),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

export function toPublicExecuteFailure(failure) {
  if (!failure) return null;

  return {
    error_code: failure.error_code ?? null,
    retryable: failure.retryable ?? null,
    suggested_next_step: failure.suggested_next_step ?? null,
  };
}

export function toPublicExecuteVerification(verification) {
  if (!verification) return null;

  return {
    delivered: verification.delivered === true,
    composer_cleared: verification.composer_cleared === true,
    active_item_stable: verification.active_item_stable === true,
  };
}

export function toPublicWorkspaceSummary(summary, snapshot) {
  const blockingModalLabels = Array.isArray(summary?.blocking_modal_labels)
    ? summary.blocking_modal_labels
    : getBlockingModals(snapshot)
        .map((modal) => compactText(modal?.label))
        .filter(Boolean);

  return {
    active_item_label: summary?.active_item_label ?? null,
    draft_present: summary?.draft_present === true,
    loading_shell: summary?.loading_shell === true,
    blocking_modal_count: summary?.blocking_modal_count ?? blockingModalLabels.length,
    blocking_modal_labels: blockingModalLabels,
    detail_alignment: summary?.detail_alignment ?? 'unknown',
    selection_window: summary?.selection_window ?? 'not_found',
    recovery_hint: summary?.recovery_hint ?? null,
    summary: summary?.summary ?? 'unknown',
  };
}

export function formatWorkspaceSurfaceLabel(workspaceSurface) {
  return String(workspaceSurface ?? 'unknown')
    .replace(/_/g, ' ')
    .trim();
}

export function getWorkspaceSummaryLabel(workspace, workspaceSummary) {
  const activeLabel = compactText(
    workspaceSummary?.active_item_label
      ?? workspace?.active_item?.label
      ?? workspace?.live_items?.find((item) => item?.selected === true)?.label
      ?? ''
  );

  return activeLabel || 'no active item';
}

export function formatWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary) {
  return `Workspace ${formatWorkspaceSurfaceLabel(workspaceSurface)} • ${getWorkspaceSummaryLabel(workspace, workspaceSummary)}`;
}

export function getWorkspaceNextAction(snapshot) {
  const summary = pick(snapshot, 'summary', 'summary', null);
  const loadingShell = getLoadingShell(snapshot) || summary?.loading_shell === true;
  if (loadingShell) {
    return 'workspace_inspect';
  }

  const blockingModals = getBlockingModals(snapshot);
  if (blockingModals.length > 0) {
    return 'workspace_inspect';
  }

  const liveItems = getLiveItems(snapshot);
  const activeItem = getActiveItem(snapshot);
  const composer = getComposer(snapshot);
  const activeItemStable = summary?.outcome_signals?.active_item_stable === true || summary?.active_item_stable === true;
  const draftPresent = composer?.draft_present === true || summary?.draft_present === true;
  const sendLikeControls = getActionControls(snapshot).filter((control) => control?.action_kind === 'send');

  if (!activeItem && liveItems.length > 0) {
    return 'select_live_item';
  }

  if (composer && activeItemStable && draftPresent && sendLikeControls.length > 0) {
    return 'execute_action';
  }

  if (composer && activeItemStable) {
    return 'draft_action';
  }

  if (liveItems.length > 0) {
    return 'select_live_item';
  }

  return 'workspace_inspect';
}

export function buildWorkspaceSnapshotView(snapshot) {
  const workspaceSummary = summarizeWorkspaceSnapshot(snapshot);
  const workspaceSurface = snapshot.workspace_surface ?? snapshot.workspaceSurface ?? workspaceSummary.workspace_surface;
  const publicWorkspaceSummary = toPublicWorkspaceSummary(workspaceSummary, snapshot);

  return {
    workspaceSummary: publicWorkspaceSummary,
    workspaceSurface,
    workspace: {
      workspace_surface: workspaceSurface,
      live_items: getLiveItems(snapshot).map(toPublicLiveItem),
      active_item: toPublicActiveItem(getActiveItem(snapshot)),
      composer: toPublicComposer(getComposer(snapshot)),
      action_controls: getActionControls(snapshot).map(toPublicActionControl),
      blocking_modals: getBlockingModals(snapshot).map(toPublicBlockingModal),
      loading_shell: getLoadingShell(snapshot),
      summary: publicWorkspaceSummary,
    },
  };
}
