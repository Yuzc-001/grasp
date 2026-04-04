import { classifyWorkspaceSurface, summarizeWorkspaceSnapshot } from './workspace-tasks.js';

export function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeLabel(value) {
  return compactText(value).toLowerCase();
}

export function pick(snapshot, camelKey, snakeKey, fallback = null) {
  if (snapshot?.[camelKey] !== undefined) return snapshot[camelKey];
  if (snapshot?.[snakeKey] !== undefined) return snapshot[snakeKey];
  return fallback;
}

export function getLiveItems(snapshot) {
  const items = pick(snapshot, 'liveItems', 'live_items', []);
  return Array.isArray(items) ? items : [];
}

export function getComposer(snapshot) {
  const composer = pick(snapshot, 'composer', 'composer', null);
  return composer && typeof composer === 'object' ? composer : null;
}

export function getActionControls(snapshot) {
  const controls = pick(snapshot, 'actionControls', 'action_controls', []);
  return Array.isArray(controls) ? controls : [];
}

export function getSendActionControls(snapshot) {
  return getActionControls(snapshot).filter((control) => control?.action_kind === 'send');
}

export function getWorkspaceSurface(snapshot) {
  return pick(snapshot, 'workspaceSurface', 'workspace_surface', null) ?? classifyWorkspaceSurface(snapshot);
}

export function isLoadingShell(snapshot) {
  return pick(snapshot, 'loadingShell', 'loading_shell', false) === true
    || getWorkspaceSurface(snapshot) === 'loading_shell';
}

export function buildUnresolved(reason, requestedLabel, matches = []) {
  return {
    reason,
    requested_label: compactText(requestedLabel),
    matches: matches.map((item) => ({
      label: item.label,
      hint_id: item.hint_id ?? null,
    })),
  };
}

export function normalizeWorkspaceSnapshot(snapshot) {
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

export function getSelectionMatchLabel(item) {
  return normalizeLabel(item?.normalized_label ?? item?.label);
}

export function getSelectionSnapshotDetails(snapshot) {
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
