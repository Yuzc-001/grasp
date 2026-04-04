import { clickByHintId } from '../layer3-action/actions.js';
import { getWorkspaceStatus } from './workspace-tasks.js';
import { executeGuardedAction } from './workspace-runtime.selection.js';
import { verifyActionOutcome } from './workspace-runtime.verify.js';
import {
  compactText,
  getComposer,
  getSendActionControls,
  getWorkspaceSurface,
  isLoadingShell,
  normalizeWorkspaceSnapshot,
  pick,
} from './workspace-runtime.shared.js';

export function getWorkspaceExecuteSignals(snapshot) {
  const summary = pick(snapshot, 'summary', 'summary', null) ?? {};
  const composer = getComposer(snapshot);
  const blockingModals = pick(snapshot, 'blockingModals', 'blocking_modals', []);
  const sendControl = getSendActionControls(snapshot)[0] ?? null;

  return {
    loadingShell: isLoadingShell(snapshot),
    blockingModalCount: Array.isArray(blockingModals) ? blockingModals.length : 0,
    draftPresent: composer?.draft_present === true || summary?.draft_present === true,
    activeItemStable: summary?.outcome_signals?.active_item_stable === true || summary?.active_item_stable === true,
    sendControl,
  };
}

export function canExecuteWorkspaceSend(snapshot) {
  const signals = getWorkspaceExecuteSignals(snapshot);

  return signals.loadingShell === false
    && signals.blockingModalCount === 0
    && signals.draftPresent === true
    && signals.activeItemStable === true
    && signals.sendControl !== null;
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

  const workspaceExecuteSignals = getWorkspaceExecuteSignals(initialSnapshot);
  if (!workspaceExecuteSignals.sendControl || !compactText(workspaceExecuteSignals.sendControl?.hint_id)) {
    return buildWorkspaceExecuteUnresolved('no_live_target', 'send', workspaceExecuteSignals.sendControl ? [workspaceExecuteSignals.sendControl] : [], 'reinspect_workspace', initialSnapshot);
  }

  if (!canExecuteWorkspaceSend(initialSnapshot)) {
    return buildWorkspaceExecuteBlocked('not_ready_to_execute', 'send', initialSnapshot);
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
      await click(page, workspaceExecuteSignals.sendControl.hint_id, { rebuildHints });
      return { control: workspaceExecuteSignals.sendControl };
    },
    verify: async ({ snapshot: refreshedSnapshot, executionResult }) => {
      const verification = await verify({
        page,
        kind: 'execute_action',
        target: 'send',
        outcomeSignals: refreshedSnapshot?.outcome_signals ?? null,
        snapshot: refreshedSnapshot,
      });
      const sendDelivered = refreshedSnapshot?.outcome_signals?.delivered === true;
      const composerCleared = refreshedSnapshot?.outcome_signals?.composer_cleared === true;
      const sendSucceeded = sendDelivered || composerCleared;

      if (!sendSucceeded) {
        return {
          ok: false,
          failure: {
            error_code: verification?.error_code ?? 'ACTION_NOT_VERIFIED',
            retryable: verification?.retryable ?? true,
            suggested_next_step: verification?.suggested_next_step ?? 'reverify',
          },
          evidence: verification?.evidence ?? {
            kind: 'execute_action',
            target: 'send',
            executionResult,
          },
        };
      }

      return {
        ok: true,
        evidence: verification?.evidence ?? {
          kind: 'execute_action',
          target: 'send',
          executionResult,
        },
        verification: {
          delivered: sendDelivered,
          composer_cleared: composerCleared,
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
