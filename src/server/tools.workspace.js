import { buildGatewayResponse } from './gateway-response.js';
import { getActivePage } from '../layer1-bridge/chrome.js';
import { syncPageState } from './state.js';
import { collectVisibleWorkspaceSnapshot, getWorkspaceContinuation, getWorkspaceStatus, summarizeWorkspaceSnapshot } from './workspace-tasks.js';

function toGatewayPage(page, state) {
  return {
    title: page.title,
    url: page.url,
    page_role: state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: state.pageState?.riskGateDetected ?? false,
  };
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
  return pick(snapshot, 'activeItem', 'active_item', null);
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

function isActiveItemStable(snapshot, summary) {
  if (summary?.outcome_signals?.active_item_stable === true) {
    return true;
  }

  if (summary?.active_item_stable === true) {
    return true;
  }

  return false;
}

function toPublicLiveItem(item) {
  return {
    label: String(item?.label ?? '').replace(/\s+/g, ' ').trim(),
    selected: item?.selected === true,
  };
}

function toPublicActiveItem(item) {
  if (!item) return null;
  return {
    label: String(item?.label ?? '').replace(/\s+/g, ' ').trim(),
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
    label: String(control?.label ?? '').replace(/\s+/g, ' ').trim(),
    action_kind: control?.action_kind ?? 'action',
  };
}

function toPublicBlockingModal(modal) {
  return {
    label: String(modal?.label ?? '').replace(/\s+/g, ' ').trim(),
  };
}

function toPublicWorkspaceSummary(summary, snapshot) {
  const blockingModalLabels = Array.isArray(summary?.blocking_modal_labels)
    ? summary.blocking_modal_labels
    : getBlockingModals(snapshot)
        .map((modal) => String(modal?.label ?? '').replace(/\s+/g, ' ').trim())
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

function getWorkspaceNextAction(snapshot) {
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
  const activeItemStable = isActiveItemStable(snapshot, summary);
  const draftPresent = composer?.draft_present === true || summary?.draft_present === true;
  const sendLikeControls = getSendLikeActionControls(snapshot);

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

function buildWorkspaceSnapshotView(snapshot) {
  const workspaceSummary = snapshot.summary ?? summarizeWorkspaceSnapshot(snapshot);
  const workspaceSurface = snapshot.workspace_surface ?? snapshot.workspaceSurface ?? workspaceSummary.workspace_surface;

  return {
    workspaceSummary: toPublicWorkspaceSummary(workspaceSummary, snapshot),
    workspaceSurface,
    workspace: {
      workspace_surface: workspaceSurface,
      live_items: getLiveItems(snapshot).map(toPublicLiveItem),
      active_item: toPublicActiveItem(getActiveItem(snapshot)),
      composer: toPublicComposer(getComposer(snapshot)),
      action_controls: getActionControls(snapshot).map(toPublicActionControl),
      blocking_modals: getBlockingModals(snapshot).map(toPublicBlockingModal),
      loading_shell: getLoadingShell(snapshot),
      summary: toPublicWorkspaceSummary(workspaceSummary, snapshot),
    },
  };
}

async function loadWorkspacePageContext(page, state, syncState, collectSnapshot) {
  await syncState(page, state, { force: true });
  const snapshot = await collectSnapshot(page, state);
  const pageInfo = {
    title: await page.title(),
    url: page.url(),
  };

  return {
    pageInfo,
    snapshot,
    ...buildWorkspaceSnapshotView(snapshot),
  };
}

function registerWorkspaceActionTool(server, state, deps, toolName, actionKind) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const actionDependency = deps[toolName === 'select_live_item' ? 'selectLiveItem' : toolName === 'draft_action' ? 'draftAction' : 'executeAction'];

  server.registerTool(
    toolName,
    {
      description: `Placeholder workspace action for ${actionKind}.`,
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      const { pageInfo, snapshot, workspace, workspaceSummary, workspaceSurface } = await loadWorkspacePageContext(page, state, syncState, collectSnapshot);
      const status = getWorkspaceStatus(state);
      const continuationAction = status === 'direct' ? 'workspace_inspect' : 'request_handoff';
      const delegated = status === 'direct' && typeof actionDependency === 'function';

      if (delegated) {
        await actionDependency({
          page,
          snapshot,
          workspace,
          workspaceSummary,
          workspaceSurface,
        });
      }

      return buildGatewayResponse({
        status,
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'workspace',
          action: {
            kind: actionKind,
            status: status === 'direct' ? (delegated ? 'delegated' : 'unimplemented') : 'blocked',
          },
          workspace,
          summary: `Workspace ${workspaceSurface} • ${workspaceSummary.active_item_label ?? 'no active item'}`,
        },
        continuation: getWorkspaceContinuation(state, continuationAction),
        evidence: {
          workspace_surface: workspaceSurface,
          active_item_label: workspaceSummary.active_item_label ?? null,
          loading_shell: workspaceSummary.loading_shell ?? false,
          blocking_modal_count: workspaceSummary.blocking_modal_count ?? 0,
        },
      });
    }
  );
}

export function registerWorkspaceTools(server, state, deps = {}) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;

  server.registerTool(
    'workspace_inspect',
    {
      description: 'Inspect the current workspace surface, live items, and composer state.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      const { pageInfo, snapshot, workspace, workspaceSummary, workspaceSurface } = await loadWorkspacePageContext(page, state, syncState, collectSnapshot);

      return buildGatewayResponse({
        status: getWorkspaceStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'workspace',
          workspace,
          summary: `Workspace ${workspaceSurface} • ${workspaceSummary.active_item_label ?? 'no active item'}`,
        },
        continuation: getWorkspaceContinuation(state, getWorkspaceNextAction(snapshot)),
        evidence: {
          workspace_surface: workspaceSurface,
          active_item_label: workspaceSummary.active_item_label ?? null,
          loading_shell: workspaceSummary.loading_shell ?? getLoadingShell(snapshot),
          blocking_modal_count: workspaceSummary.blocking_modal_count ?? getBlockingModals(snapshot).length,
        },
      });
    }
  );

  registerWorkspaceActionTool(server, state, deps, 'select_live_item', 'select_live_item');
  registerWorkspaceActionTool(server, state, deps, 'draft_action', 'draft_action');
  registerWorkspaceActionTool(server, state, deps, 'execute_action', 'execute_action');
}
