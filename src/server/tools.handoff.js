import { z } from 'zod';

import { getActivePage } from '../layer1-bridge/chrome.js';
import { textResponse } from './responses.js';
import { syncPageState } from './state.js';
import { audit } from './audit.js';
import {
  requestHandoff,
  markHandoffInProgress,
  markAwaitingReacquisition,
  markResumedUnverified,
  markResumeVerified,
  clearHandoff,
} from '../grasp/handoff/events.js';
import { readHandoffState, writeHandoffState } from '../grasp/handoff/persist.js';
import { capturePageEvidence } from '../grasp/verify/evidence.js';
import { assessResumeContinuation } from './continuity.js';

export function getHandoffContinuationAnchors(handoff = {}) {
  return {
    expected_url_contains: handoff.expected_url_contains ?? null,
    expected_page_role: handoff.expected_page_role ?? null,
    expected_selector: handoff.expected_selector ?? null,
    continuation_goal: handoff.continuation_goal ?? null,
    expected_hint_label: handoff.expected_hint_label ?? null,
  };
}

export function shouldMarkResumeVerified({
  verify = true,
  checkpointStillPresent = false,
  pageState = {},
  continuation = {},
}) {
  if (!verify || checkpointStillPresent) return false;

  const pageReacquired = !!pageState?.reacquired;
  const taskVerified = continuation?.task_continuation_ok;
  const continuationReady = continuation?.continuation_ready === true;

  if (taskVerified === false) return false;

  return pageReacquired || continuationReady;
}

export function registerHandoffTools(server, state) {
  server.registerTool(
    'request_handoff',
    {
      description: 'Mark that the current task/page requires a human step before the agent can continue.',
      inputSchema: {
        reason: z.string().describe('Why human help is required, e.g. login_required, captcha_required'),
        note: z.string().optional().describe('Optional note for the human/operator'),
        expected_url_contains: z.string().optional().describe('Optional task anchor persisted into handoff state'),
        expected_page_role: z.string().optional().describe('Optional task anchor persisted into handoff state'),
        expected_selector: z.string().optional().describe('Optional task anchor persisted into handoff state'),
        continuation_goal: z.string().optional().describe('Human-readable description of the task that should become continue-ready after resume'),
        expected_hint_label: z.string().optional().describe('Expected next affordance label that should reappear after resume'),
      },
    },
    async ({ reason, note, expected_url_contains, expected_page_role, expected_selector, continuation_goal, expected_hint_label }) => {
      state.handoff = requestHandoff(await readHandoffState(), reason, note ?? null, {
        expected_url_contains,
        expected_page_role,
        expected_selector,
        continuation_goal,
        expected_hint_label,
      });
      await writeHandoffState(state.handoff);
      await audit('handoff_request', `${reason}${note ? ` :: ${note}` : ''}`);
      return textResponse([
        `Handoff requested: ${reason}`,
        ...(note ? [`Note: ${note}`] : []),
        'State: handoff_required',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'mark_handoff_in_progress',
    {
      description: 'Mark that a human is currently performing the required browser step.',
      inputSchema: {
        note: z.string().optional().describe('Optional note about the in-progress human step'),
      },
    },
    async ({ note } = {}) => {
      state.handoff = markHandoffInProgress(await readHandoffState(), note ?? null);
      await writeHandoffState(state.handoff);
      await audit('handoff_progress', note ?? 'in progress');
      return textResponse([
        'Handoff is now in progress.',
        ...(note ? [`Note: ${note}`] : []),
        'State: handoff_in_progress',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'mark_handoff_done',
    {
      description: 'Mark that the human step is done and Grasp should now reacquire the page state.',
      inputSchema: {
        note: z.string().optional().describe('Optional note left by the human/operator'),
      },
    },
    async ({ note } = {}) => {
      state.handoff = markAwaitingReacquisition(await readHandoffState(), note ?? null);
      await writeHandoffState(state.handoff);
      await audit('handoff_done', note ?? 'awaiting reacquisition');
      return textResponse([
        'Human step marked done.',
        ...(note ? [`Note: ${note}`] : []),
        'State: awaiting_reacquisition',
        'Next: call resume_after_handoff to reacquire page state.',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'resume_after_handoff',
    {
      description: 'Reacquire page state after a human step, then mark the handoff as resumed.',
      inputSchema: {
        verify: z.boolean().optional().describe('Require visible reacquisition evidence before marking verified'),
        note: z.string().optional().describe('Optional note about the resumed state'),
        expected_url_contains: z.string().optional().describe('Optional task anchor: URL should contain this substring after resume'),
        expected_page_role: z.string().optional().describe('Optional task anchor: page role should match after resume'),
        expected_selector: z.string().optional().describe('Optional task anchor: selector should be present after resume'),
        continuation_goal: z.string().optional().describe('Optional continuation goal for resumed task'),
        expected_hint_label: z.string().optional().describe('Optional expected next affordance label after resume'),
      },
    },
    async ({ verify = true, note, expected_url_contains, expected_page_role, expected_selector, continuation_goal, expected_hint_label } = {}) => {
      const page = await getActivePage();
      await syncPageState(page, state, { force: true });
      const currentHandoff = await readHandoffState();
      const anchors = {
        ...getHandoffContinuationAnchors(currentHandoff),
        expected_url_contains: expected_url_contains ?? currentHandoff.expected_url_contains,
        expected_page_role: expected_page_role ?? currentHandoff.expected_page_role,
        expected_selector: expected_selector ?? currentHandoff.expected_selector,
        continuation_goal: continuation_goal ?? currentHandoff.continuation_goal,
        expected_hint_label: expected_hint_label ?? currentHandoff.expected_hint_label,
      };
      const continuation = await assessResumeContinuation(page, state, anchors);
      const checkpointStillPresent = state.pageState?.currentRole === 'checkpoint' || state.pageState?.riskGateDetected === true;
      const effectiveContinuation = checkpointStillPresent
        ? {
            ...continuation,
            continuation_ready: false,
            suggested_next_action: state.pageState?.suggestedNextAction ?? 'handoff_required',
          }
        : continuation;
      const evidence = await capturePageEvidence(page, state, {
        action: 'resume_after_handoff',
        details: {
          pageIdentity: state.pageState?.pageIdentity ?? null,
          continuation: effectiveContinuation,
        },
      });

      const taskVerified = continuation.task_continuation_ok;
      const shouldVerify = shouldMarkResumeVerified({
        verify,
        checkpointStillPresent,
        pageState: state.pageState,
        continuation: effectiveContinuation,
      });

      if (shouldVerify) {
        state.handoff = markResumeVerified(currentHandoff, evidence, note ?? null);
      } else {
        state.handoff = markResumedUnverified(currentHandoff, evidence, note ?? null);
      }
      await writeHandoffState(state.handoff);
      await audit('handoff_resume', `${state.handoff.state}${note ? ` :: ${note}` : ''}`);

      return textResponse([
        `Resume state: ${state.handoff.state}`,
        `Page role: ${state.pageState?.currentRole ?? 'unknown'}`,
        `Grasp confidence: ${state.pageState?.graspConfidence ?? 'unknown'}`,
        `Reacquired: ${state.pageState?.reacquired ? 'yes' : 'no'}`,
        `Task continuation: ${taskVerified === null ? 'not checked' : taskVerified ? 'ok' : 'failed'}`,
        `Checkpoint still present: ${checkpointStillPresent ? 'yes' : 'no'}`,
        `Continuation ready: ${effectiveContinuation.continuation_ready ? 'yes' : 'no'}`,
        `Suggested next action: ${effectiveContinuation.suggested_next_action}`,
      ], { handoff: state.handoff, evidence, continuation: effectiveContinuation, checkpointStillPresent });
    }
  );

  server.registerTool(
    'clear_handoff',
    {
      description: 'Clear the current handoff state and return to idle.',
      inputSchema: {},
    },
    async () => {
      state.handoff = clearHandoff(await readHandoffState());
      await writeHandoffState(state.handoff);
      await audit('handoff_clear', 'idle');
      return textResponse('Handoff cleared. State: idle', { handoff: state.handoff });
    }
  );
}
