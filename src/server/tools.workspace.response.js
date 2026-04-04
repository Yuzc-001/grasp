import { buildGatewayResponse } from './gateway-response.js';
import { formatWorkspaceResultSummary } from './tools.workspace.view.js';

export function buildWorkspaceEvidence(workspaceSurface, workspaceSummary, extraEvidence = {}) {
  return {
    workspace_surface: workspaceSurface,
    active_item_label: workspaceSummary?.active_item_label ?? null,
    loading_shell: workspaceSummary?.loading_shell ?? false,
    blocking_modal_count: workspaceSummary?.blocking_modal_count ?? 0,
    ...extraEvidence,
  };
}

export function buildWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary) {
  return formatWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary);
}

export function buildWorkspaceToolResponse({
  status,
  page,
  result,
  continuation,
  workspaceSurface,
  workspaceSummary,
  extraEvidence = {},
  runtime = undefined,
}) {
  return buildGatewayResponse({
    status,
    page,
    result,
    continuation,
    evidence: buildWorkspaceEvidence(workspaceSurface, workspaceSummary, extraEvidence),
    runtime,
  });
}

export function buildWorkspaceDraftResponse({
  status,
  page,
  continuation,
  workspaceSurface,
  workspaceSummary,
  workspace,
  runtime,
  resultStatus,
  draftEvidence,
  unresolved,
  failure,
  extraEvidence = {},
}) {
  return buildWorkspaceToolResponse({
    status,
    page,
    result: {
      task_kind: 'workspace',
      status: resultStatus,
      draft_evidence: draftEvidence,
      unresolved,
      failure,
      action: {
        kind: 'draft_action',
        status: resultStatus,
      },
      snapshot: workspace,
      workspace,
      summary: buildWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary),
    },
    continuation,
    workspaceSurface,
    workspaceSummary,
    extraEvidence: {
      draft_evidence: draftEvidence,
      failure,
      ...extraEvidence,
    },
    runtime,
  });
}

export function buildWorkspaceExecuteResponse({
  status,
  page,
  continuation,
  workspaceSurface,
  workspaceSummary,
  workspace,
  runtime,
  executeResult,
  unresolved,
  failure,
  verification,
  extraEvidence = {},
}) {
  return buildWorkspaceToolResponse({
    status,
    page,
    result: {
      task_kind: 'workspace',
      status: executeResult.status ?? 'failed',
      blocked: executeResult.blocked === true,
      executed: executeResult.executed === true,
      reason: executeResult.reason ?? null,
      unresolved,
      failure,
      verification,
      action: {
        kind: 'execute_action',
        status: executeResult.action?.status ?? (executeResult.status === 'success' ? 'executed' : executeResult.status ?? 'blocked'),
      },
      snapshot: workspace,
      workspace,
      summary: buildWorkspaceResultSummary(workspaceSurface, workspace, workspaceSummary),
    },
    continuation,
    workspaceSurface,
    workspaceSummary,
    extraEvidence: {
      blocked: executeResult.blocked === true,
      executed: executeResult.executed === true,
      reason: executeResult.reason ?? null,
      verification,
      failure,
      ...extraEvidence,
    },
    runtime,
  });
}

export function buildWorkspaceSelectionResponse({
  status,
  page,
  continuation,
  workspaceSurface,
  workspaceSummary,
  workspace,
  runtime,
  selection,
  selectedItem,
  activeItem,
  selectionEvidence,
  unresolved,
  summaryOverrides = {},
  extraEvidence = {},
}) {
  const effectiveSummary = {
    ...workspaceSummary,
    ...summaryOverrides,
  };

  return buildWorkspaceToolResponse({
    status,
    page,
    result: {
      task_kind: 'workspace',
      status: selection.status,
      selected_item: selectedItem,
      active_item: activeItem,
      detail_alignment: selection.detail_alignment,
      snapshot: workspace,
      selection_evidence: selectionEvidence,
      unresolved,
      action: {
        kind: 'select_live_item',
        status: selection.status,
      },
      workspace,
      summary: buildWorkspaceResultSummary(workspaceSurface, workspace, effectiveSummary),
    },
    continuation,
    workspaceSurface,
    workspaceSummary: effectiveSummary,
    extraEvidence: {
      selection_evidence: selectionEvidence,
      ...extraEvidence,
    },
    runtime,
  });
}
