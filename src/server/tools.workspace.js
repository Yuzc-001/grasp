import { z } from 'zod';

import { guardExpectedBoundary } from './boundary-guard.js';

import { getActivePage } from '../layer1-bridge/chrome.js';
import { clickByHintId } from '../layer3-action/actions.js';
import { syncPageState } from './state.js';
import { buildWorkspaceVerification, collectVisibleWorkspaceSnapshot, getWorkspaceContinuation, getWorkspaceStatus } from './workspace-tasks.js';

import { draftWorkspaceAction, executeWorkspaceAction, selectWorkspaceItem } from './workspace-runtime.js';

import {



  buildWorkspaceSnapshotView,



  getWorkspaceNextAction,



  toPublicActiveItem,


  toPublicDraftEvidence,

  toPublicDraftFailure,

  toPublicDraftUnresolved,

  toPublicExecuteFailure,

  toPublicExecuteUnresolved,

  toPublicExecuteVerification,

  toPublicSelectionEvidence,

  toPublicSelectionItem,

  toPublicSelectionUnresolved,

} from './tools.workspace.view.js';

import { readBrowserInstance } from '../runtime/browser-instance.js';

import { requireConfirmedRuntimeInstance } from './runtime-confirmation.js';

import {

  buildWorkspaceDraftResponse,

  buildWorkspaceExecuteResponse,

  buildWorkspaceSelectionResponse,

  buildWorkspaceToolResponse,

  buildWorkspaceResultSummary,

} from './tools.workspace.response.js';




const WORKSPACE_ITEM_SELECTOR = 'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]';

function toGatewayPage(page, state) {
  return {
    title: page.title,
    url: page.url,
    page_role: state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: state.pageState?.riskGateDetected ?? false,
  };
}

function getWorkspaceBoundaryGuard(state, toolName, pageInfo) {
  return guardExpectedBoundary({
    toolName,
    expectedBoundary: 'workspace_runtime',
    status: getWorkspaceStatus(state),
    page: toGatewayPage(pageInfo, state),
    handoffState: state.handoff?.state ?? 'idle',
  });
}


function createWorkspaceRebuildHints(page, state, syncState) {
  return async () => {
    await syncState(page, state, { force: true });
    return null;
  };
}

async function clickWorkspaceItemByLabel(page, requestedLabel) {
  const point = await page.evaluate(({ selector, requestedLabel: label }) => {
    function compactText(value) {
      return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function normalizeLabel(value) {
      return compactText(value).toLowerCase();
    }

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function getText(el) {
      return compactText(el.getAttribute('aria-label') || el.textContent || el.value || '');
    }

    const normalized = normalizeLabel(label);
    if (!normalized) return null;

    const target = [...document.querySelectorAll(selector)]
      .find((el) => isVisible(el) && normalizeLabel(getText(el)) === normalized);

    if (!target) return null;

    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, {
    selector: WORKSPACE_ITEM_SELECTOR,
    requestedLabel,
  });

  if (!point) {
    return false;
  }

  await page.mouse.click(point.x, point.y);
  return true;
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

      return buildWorkspaceToolResponse({

        status,

        page: toGatewayPage(pageInfo, state),

        result: {

          task_kind: 'workspace',

          action: {

            kind: actionKind,

            status: status === 'direct' ? (delegated ? 'delegated' : 'unimplemented') : 'blocked',

          },

          workspace,

          summary: buildWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary),

        },

        continuation: getWorkspaceContinuation(state, continuationAction),

        workspaceSurface,

        workspaceSummary,

      });

    }
  );
}

function registerWorkspaceDraftActionTool(server, state, deps) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const draftAction = deps.draftWorkspaceAction ?? draftWorkspaceAction;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));

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
      await syncState(page, state, { force: true });
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };
      const boundaryMismatch = getWorkspaceBoundaryGuard(state, 'draft_action', pageInfo);
      if (boundaryMismatch) return boundaryMismatch;
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'draft_action');
      if (confirmationError) return confirmationError;
      const snapshot = await collectSnapshot(page, state);
      const { workspaceSummary, workspaceSurface, workspace } = buildWorkspaceSnapshotView(snapshot);
      const status = getWorkspaceStatus(state);
      const continuationAction = status === 'direct' ? 'workspace_inspect' : 'request_handoff';

      if (status !== 'direct') {
        return buildWorkspaceDraftResponse({

          status,

          page: toGatewayPage(pageInfo, state),

          continuation: getWorkspaceContinuation(state, continuationAction),

          workspaceSurface,

          workspaceSummary,

          workspace,

          runtime: instance ? { instance } : undefined,

          resultStatus: 'blocked',

          draftEvidence: null,

          unresolved: null,

          failure: null,

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

      return buildWorkspaceDraftResponse({

        status,

        page: toGatewayPage(pageInfoAfter, state),

        continuation: getWorkspaceContinuation(state, 'workspace_inspect'),

        workspaceSurface: refreshedView.workspaceSurface,

        workspaceSummary: refreshedView.workspaceSummary,

        workspace: publicSnapshot,

        runtime: instance ? { instance } : undefined,

        resultStatus: draftResult.status ?? 'unresolved',

        draftEvidence: publicDraftEvidence,

        unresolved: publicUnresolved,

        failure: publicFailure,

      });

    }
  );
}

function registerWorkspaceExecuteActionTool(server, state, deps) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const actionExecutor = deps.executeWorkspaceAction ?? executeWorkspaceAction;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));

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
      await syncState(page, state, { force: true });
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };
      const boundaryMismatch = getWorkspaceBoundaryGuard(state, 'execute_action', pageInfo);
      if (boundaryMismatch) return boundaryMismatch;
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'execute_action');
      if (confirmationError) return confirmationError;
      const snapshot = await collectSnapshot(page, state);
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
      await syncState(page, state, { force: true });
      const finalSnapshot = await collectSnapshot(page, state);
      const finalView = buildWorkspaceSnapshotView(finalSnapshot);
      const finalStatus = getWorkspaceStatus(state);
      const continuationAction = finalStatus === 'direct' ? 'verify_outcome' : 'request_handoff';
      const pageInfoAfter = {
        title: await page.title(),
        url: page.url(),
      };

      return buildWorkspaceExecuteResponse({

        status: finalStatus,

        page: toGatewayPage(pageInfoAfter, state),

        continuation: getWorkspaceContinuation(state, continuationAction),

        workspaceSurface: finalView.workspaceSurface,

        workspaceSummary: finalView.workspaceSummary,

        workspace: finalView.workspace,

        runtime: instance ? { instance } : undefined,

        executeResult,

        unresolved: toPublicExecuteUnresolved(executeResult.unresolved),

        failure: toPublicExecuteFailure(executeResult.failure),

        verification: toPublicExecuteVerification(executeResult.verification),

      });

    }
  );
}

function registerWorkspaceVerifyOutcomeTool(server, state, deps) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));

  server.registerTool(
    'verify_outcome',
    {
      description: 'Rebuild a fresh workspace snapshot, verify the current outcome, and suggest the next step.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const instance = await getBrowserInstance();
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };
      const boundaryMismatch = getWorkspaceBoundaryGuard(state, 'verify_outcome', pageInfo);
      if (boundaryMismatch) return boundaryMismatch;
      const snapshot = await collectSnapshot(page, state);
      const workspaceSurface = snapshot.workspace_surface ?? snapshot.workspaceSurface ?? 'unknown';
      const verification = buildWorkspaceVerification(snapshot);
      const status = getWorkspaceStatus(state);
      const suggestedNextAction = status === 'direct' ? verification.ready_for_next_action : 'request_handoff';
      const publicVerification = status === 'direct'
        ? verification
        : {
            ...verification,
            ready_for_next_action: 'request_handoff',
          };
      return buildWorkspaceToolResponse({
        status,
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'workspace',
          verification: publicVerification,
          suggested_next_action: suggestedNextAction,
          summary: buildWorkspaceResultSummary(workspaceSurface, null, publicVerification),
        },
        continuation: getWorkspaceContinuation(state, suggestedNextAction),
        workspaceSurface,
        workspaceSummary: {
          active_item_label: publicVerification.active_item_label,
          loading_shell: publicVerification.loading_shell,
          blocking_modal_count: publicVerification.blocking_modal_present ? 1 : 0,
        },
        extraEvidence: {
          blocking_modal_present: publicVerification.blocking_modal_present,
          detail_alignment: publicVerification.detail_alignment,
          ready_for_next_action: publicVerification.ready_for_next_action,
        },
        runtime: instance ? { instance } : undefined,
      });
    }
  );
}

export function registerWorkspaceTools(server, state, deps = {}) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleWorkspaceSnapshot ?? collectVisibleWorkspaceSnapshot;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));
  const toolDeps = { ...deps, getBrowserInstance };

  server.registerTool(
    'workspace_inspect',
    {
      description: 'Inspect the current workspace surface, live items, and composer state.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const instance = await getBrowserInstance();
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };
      const boundaryMismatch = getWorkspaceBoundaryGuard(state, 'workspace_inspect', pageInfo);
      if (boundaryMismatch) return boundaryMismatch;
      const snapshot = await collectSnapshot(page, state);
      const { workspace, workspaceSummary, workspaceSurface } = buildWorkspaceSnapshotView(snapshot);

      return buildWorkspaceToolResponse({
        status: getWorkspaceStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'workspace',
          workspace,
          summary: buildWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary),
        },
        continuation: getWorkspaceContinuation(state, getWorkspaceNextAction(snapshot)),
        workspaceSurface,
        workspaceSummary: {
          ...workspaceSummary,
          loading_shell: workspaceSummary.loading_shell ?? workspace.loading_shell,
          blocking_modal_count: workspaceSummary.blocking_modal_count ?? workspace.blocking_modals.length,
        },
        runtime: instance ? { instance } : undefined,
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
      await syncState(page, state, { force: true });
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };
      const boundaryMismatch = getWorkspaceBoundaryGuard(state, 'select_live_item', pageInfo);
      if (boundaryMismatch) return boundaryMismatch;
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'select_live_item');
      if (confirmationError) return confirmationError;
      const snapshot = await collectSnapshot(page, state);
      const { workspace, workspaceSummary, workspaceSurface } = buildWorkspaceSnapshotView(snapshot);
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
            const clicked = await clickWorkspaceItemByLabel(page, candidate?.label ?? item);
            if (clicked) {
              return { ok: true };
            }

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

      return buildWorkspaceSelectionResponse({

        status,

        page: toGatewayPage(pageInfoAfter, state),

        continuation: getWorkspaceContinuation(state, 'workspace_inspect'),

        workspaceSurface: refreshedView.workspaceSurface,

        workspaceSummary: refreshedView.workspaceSummary,

        workspace: publicSnapshot,

        runtime: instance ? { instance } : undefined,

        selection,

        selectedItem: publicSelectedItem,

        activeItem: publicActiveItem,

        selectionEvidence: publicSelectionEvidence,

        unresolved: publicUnresolved,

        summaryOverrides: {

          active_item_label: selection.active_item?.label ?? selection.selected_item?.label ?? refreshedView.workspaceSummary.active_item_label ?? null,

        },

        extraEvidence: {

          active_item_label: selection.active_item?.label ?? refreshedView.workspaceSummary.active_item_label ?? null,

        },

      });

    }
  );
  registerWorkspaceDraftActionTool(server, state, toolDeps);
  registerWorkspaceExecuteActionTool(server, state, toolDeps);
  registerWorkspaceVerifyOutcomeTool(server, state, toolDeps);
}
