import { z } from 'zod';

import { buildGatewayResponse } from './gateway-response.js';
import { getActivePage } from '../layer1-bridge/chrome.js';
import { clickByHintId } from '../layer3-action/actions.js';
import { syncPageState } from './state.js';
import { collectVisibleWorkspaceSnapshot, getWorkspaceContinuation, getWorkspaceStatus, summarizeWorkspaceSnapshot } from './workspace-tasks.js';
import { draftWorkspaceAction, executeWorkspaceAction, selectWorkspaceItem } from './workspace-runtime.js';

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

function toPublicSelectionItem(item, selected = item?.selected === true) {
  if (!item) return null;
  return {
    label: String(item?.label ?? '').replace(/\s+/g, ' ').trim(),
    selected: selected === true,
  };
}

function toPublicSelectionEvidence(evidence, selected = false) {
  if (!evidence) return null;

  return {
    requested_label: String(evidence?.requested_label ?? '').replace(/\s+/g, ' ').trim(),
    selected_item: toPublicSelectionItem(evidence?.selected_item, selected),
    active_item: toPublicActiveItem(evidence?.active_item),
    detail_alignment: evidence?.detail_alignment ?? 'unknown',
    selection_window: evidence?.selection_window ?? 'not_found',
    recovery_hint: evidence?.recovery_hint ?? null,
    match_count: evidence?.match_count ?? 0,
    summary: evidence?.summary ?? 'unknown',
  };
}

function toPublicSelectionUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: String(unresolved.requested_label ?? '').replace(/\s+/g, ' ').trim(),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

function toPublicDraftEvidence(draftEvidence) {
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

function toPublicDraftUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: String(unresolved.requested_label ?? '').replace(/\s+/g, ' ').trim(),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

function toPublicDraftFailure(result) {
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

function toPublicExecuteUnresolved(unresolved) {
  if (!unresolved) return null;

  return {
    reason: unresolved.reason ?? 'unknown',
    requested_label: String(unresolved.requested_label ?? '').replace(/\s+/g, ' ').trim(),
    recovery_hint: unresolved.recovery_hint ?? null,
  };
}

function toPublicExecuteFailure(failure) {
  if (!failure) return null;

  return {
    error_code: failure.error_code ?? null,
    retryable: failure.retryable ?? null,
    suggested_next_step: failure.suggested_next_step ?? null,
  };
}

function toPublicExecuteVerification(verification) {
  if (!verification) return null;

  return {
    delivered: verification.delivered === true,
    composer_cleared: verification.composer_cleared === true,
    active_item_stable: verification.active_item_stable === true,
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

function createWorkspaceRebuildHints(page, state, syncState) {
  return async () => {
    await syncState(page, state, { force: true });
    return null;
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
  const actionDependency = deps[toolName === 'select_live_item' ? 'selectLiveItem' : 'executeAction'];

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

function registerWorkspaceDraftActionTool(server, state, deps) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const draftAction = deps.draftWorkspaceAction ?? draftWorkspaceAction;

  server.registerTool(
    'draft_action',
    {
      description: 'Draft text into the current workspace composer and return the refreshed workspace snapshot.',
      inputSchema: {
        text: z.string().describe('Draft text to write into the current workspace composer'),
      },
    },
    async ({ text }) => {
      const page = await getPage();
      const { pageInfo, snapshot, workspace, workspaceSummary, workspaceSurface } = await loadWorkspacePageContext(page, state, syncState, collectSnapshot);
      const status = getWorkspaceStatus(state);
      const continuationAction = status === 'direct' ? 'workspace_inspect' : 'request_handoff';

      if (status !== 'direct') {
        return buildGatewayResponse({
          status,
          page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'workspace',
          status: 'blocked',
          draft_evidence: null,
          unresolved: null,
          failure: null,
          action: {
            kind: 'draft_action',
            status: 'blocked',
          },
          snapshot: workspace,
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

      const draftResult = await draftAction({
        state,
        page,
        snapshot,
        refreshSnapshot: async () => {
          await syncState(page, state, { force: true });
          return collectSnapshot(page, state);
        },
      }, text);
      const refreshedSnapshot = draftResult.snapshot ?? snapshot;
      const refreshedView = buildWorkspaceSnapshotView(refreshedSnapshot);
      const pageInfoAfter = {
        title: await page.title(),
        url: page.url(),
      };
      const publicDraftEvidence = toPublicDraftEvidence(draftResult.draft_evidence);
      const publicUnresolved = toPublicDraftUnresolved(draftResult.unresolved);
      const publicFailure = toPublicDraftFailure(draftResult);
      const publicSnapshot = refreshedView.workspace;

      return buildGatewayResponse({
        status,
        page: toGatewayPage(pageInfoAfter, state),
        result: {
          task_kind: 'workspace',
          status: draftResult.status ?? 'unresolved',
          draft_evidence: publicDraftEvidence,
          unresolved: publicUnresolved,
          failure: publicFailure,
          action: {
            kind: 'draft_action',
            status: draftResult.status ?? 'unresolved',
          },
          snapshot: publicSnapshot,
          workspace: publicSnapshot,
          summary: `Workspace ${refreshedView.workspaceSurface} • ${refreshedView.workspaceSummary.active_item_label ?? 'no active item'}`,
        },
        continuation: getWorkspaceContinuation(state, 'workspace_inspect'),
        evidence: {
          workspace_surface: refreshedView.workspaceSurface,
          active_item_label: refreshedView.workspaceSummary.active_item_label ?? null,
          loading_shell: refreshedView.workspaceSummary.loading_shell ?? false,
          blocking_modal_count: refreshedView.workspaceSummary.blocking_modal_count ?? 0,
          draft_evidence: publicDraftEvidence,
          failure: publicFailure,
        },
      });
    }
  );
}

function registerWorkspaceExecuteActionTool(server, state, deps) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const actionExecutor = deps.executeWorkspaceAction ?? executeWorkspaceAction;

  server.registerTool(
    'execute_action',
    {
      description: 'Execute the current workspace send action after explicit confirmation and return the refreshed workspace snapshot.',
      inputSchema: {
        action: z.enum(['send']).default('send'),
        mode: z.enum(['preview', 'confirm']).default('preview'),
        confirmation: z.string().optional(),
      },
    },
    async ({ action = 'send', mode = 'preview', confirmation } = {}) => {
      const page = await getPage();
      const { pageInfo, snapshot, workspace, workspaceSummary, workspaceSurface } = await loadWorkspacePageContext(page, state, syncState, collectSnapshot);
      const status = getWorkspaceStatus(state);
      const continuationAction = status === 'direct' ? 'workspace_inspect' : 'request_handoff';
      const executeResult = await actionExecutor({
        state,
        page,
        snapshot,
        clickByHintId: deps.clickByHintId ?? clickByHintId,
        executeGuardedAction: deps.executeGuardedAction,
        verifyActionOutcome: deps.verifyActionOutcome,
        rebuildHints: deps.rebuildHints,
        refreshSnapshot: async () => {
          await syncState(page, state, { force: true });
          return collectSnapshot(page, state);
        },
      }, {
        action,
        mode,
        confirmation,
      });
      const refreshedSnapshot = executeResult.snapshot ?? snapshot;
      const refreshedView = buildWorkspaceSnapshotView(refreshedSnapshot);
      const pageInfoAfter = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status,
        page: toGatewayPage(pageInfoAfter, state),
        result: {
          task_kind: 'workspace',
          status: executeResult.status ?? 'failed',
          blocked: executeResult.blocked === true,
          executed: executeResult.executed === true,
          reason: executeResult.reason ?? null,
          unresolved: toPublicExecuteUnresolved(executeResult.unresolved),
          failure: toPublicExecuteFailure(executeResult.failure),
          verification: toPublicExecuteVerification(executeResult.verification),
          action: {
            kind: 'execute_action',
            status: executeResult.action?.status ?? (executeResult.status === 'success' ? 'executed' : executeResult.status ?? 'blocked'),
          },
          snapshot: refreshedView.workspace,
          workspace: refreshedView.workspace,
          summary: `Workspace ${refreshedView.workspaceSurface} • ${refreshedView.workspaceSummary.active_item_label ?? 'no active item'}`,
        },
        continuation: getWorkspaceContinuation(state, continuationAction),
        evidence: {
          workspace_surface: refreshedView.workspaceSurface,
          active_item_label: refreshedView.workspaceSummary.active_item_label ?? null,
          loading_shell: refreshedView.workspaceSummary.loading_shell ?? false,
          blocking_modal_count: refreshedView.workspaceSummary.blocking_modal_count ?? 0,
          blocked: executeResult.blocked === true,
          executed: executeResult.executed === true,
          reason: executeResult.reason ?? null,
          verification: toPublicExecuteVerification(executeResult.verification),
          failure: toPublicExecuteFailure(executeResult.failure),
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

  server.registerTool(
    'select_live_item',
    {
      description: 'Select a visible workspace item by label and return the refreshed workspace snapshot.',
      inputSchema: {
        item: z.string().describe('Visible item label to select in the current workspace'),
      },
    },
    async ({ item }) => {
      const page = await getPage();
      const { pageInfo, snapshot, workspace, workspaceSummary, workspaceSurface } = await loadWorkspacePageContext(page, state, syncState, collectSnapshot);
      const status = getWorkspaceStatus(state);
      const rebuildHints = createWorkspaceRebuildHints(page, state, syncState);
      const selection = await selectWorkspaceItem({
        state,
        page,
        snapshot,
        refreshSnapshot: async () => {
          await syncState(page, state, { force: true });
          return collectSnapshot(page, state);
        },
        selectItemByHint: async (candidate) => {
          if (typeof deps.selectLiveItem === 'function') {
            return deps.selectLiveItem({
              page,
              item: candidate,
              snapshot,
              workspace,
              workspaceSummary,
              workspaceSurface,
            });
          }

          if (!candidate?.hint_id) {
            return {
              ok: false,
              unresolved: {
                reason: 'no_live_target',
                requested_label: item,
                matches: [],
                recovery_hint: 'retry_selection',
              },
            };
          }

          await clickByHintId(page, candidate.hint_id, { rebuildHints });
          return { ok: true };
        },
      }, item);
      const refreshedSnapshot = selection.snapshot ?? snapshot;
      const refreshedView = buildWorkspaceSnapshotView(refreshedSnapshot);
      const pageInfoAfter = {
        title: await page.title(),
        url: page.url(),
      };
      const publicSnapshot = refreshedView.workspace;
      const publicSelectedItem = toPublicSelectionItem(selection.selected_item, selection.status === 'selected');
      const publicActiveItem = toPublicActiveItem(selection.active_item);
      const publicSelectionEvidence = toPublicSelectionEvidence(selection.selection_evidence, selection.status === 'selected');
      const publicUnresolved = toPublicSelectionUnresolved(selection.unresolved);

      return buildGatewayResponse({
        status,
        page: toGatewayPage(pageInfoAfter, state),
        result: {
          task_kind: 'workspace',
          status: selection.status,
          selected_item: publicSelectedItem,
          active_item: publicActiveItem,
          detail_alignment: selection.detail_alignment,
          snapshot: publicSnapshot,
          selection_evidence: publicSelectionEvidence,
          unresolved: publicUnresolved,
          action: {
            kind: 'select_live_item',
            status: selection.status,
          },
          workspace: publicSnapshot,
          summary: `Workspace ${refreshedView.workspaceSurface} • ${selection.active_item?.label ?? selection.selected_item?.label ?? refreshedView.workspaceSummary.active_item_label ?? 'no active item'}`,
        },
        continuation: getWorkspaceContinuation(state, 'workspace_inspect'),
        evidence: {
          workspace_surface: refreshedView.workspaceSurface,
          active_item_label: selection.active_item?.label ?? refreshedView.workspaceSummary.active_item_label ?? null,
          loading_shell: refreshedView.workspaceSummary.loading_shell ?? false,
          blocking_modal_count: refreshedView.workspaceSummary.blocking_modal_count ?? 0,
          selection_evidence: publicSelectionEvidence,
        },
      });
    }
  );
  registerWorkspaceDraftActionTool(server, state, deps);
  registerWorkspaceExecuteActionTool(server, state, deps);
}
