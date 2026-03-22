import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerState } from '../../../src/server/state.js';
import {
  requestHandoff,
  markHandoffInProgress,
  markAwaitingReacquisition,
  markResumedUnverified,
  markResumeVerified,
  clearHandoff,
} from '../../../src/grasp/handoff/events.js';
import { assessGatewayContinuation, assessResumeContinuation } from '../../../src/server/continuity.js';
import { createFakePage } from '../../helpers/fake-page.js';

test('handoff runtime path can move from request to verified resume', () => {
  const state = createServerState();

  state.handoff = requestHandoff(state.handoff, 'login_required', 'please log in');
  assert.equal(state.handoff.state, 'handoff_required');

  state.handoff = markHandoffInProgress(state.handoff, 'human is logging in');
  assert.equal(state.handoff.state, 'handoff_in_progress');

  state.handoff = markAwaitingReacquisition(state.handoff, 'done, reacquire');
  assert.equal(state.handoff.state, 'awaiting_reacquisition');

  state.handoff = markResumedUnverified(state.handoff, { url: 'https://example.com/app' }, 'resumed but not checked');
  assert.equal(state.handoff.state, 'resumed_unverified');

  state.handoff = markResumeVerified(state.handoff, { url: 'https://example.com/app' }, 'resume confirmed');
  assert.equal(state.handoff.state, 'resumed_verified');

  state.handoff = clearHandoff(state.handoff);
  assert.equal(state.handoff.state, 'idle');
});

test('resume continuation mismatch can force resumed_unverified', async () => {
  const state = createServerState();
  state.pageState = {
    currentRole: 'docs',
    reacquired: true,
  };

  const page = createFakePage({
    url: () => 'https://playwright.dev/docs/intro',
    evaluate: async (_fn, selector) => selector === 'main',
  });

  state.handoff = requestHandoff(state.handoff, 'login_required', 'persist anchors', {
    expected_url_contains: '/dashboard',
    expected_page_role: 'auth',
    expected_selector: '#definitely-missing',
  });
  state.handoff = markAwaitingReacquisition(state.handoff, 'done, reacquire');

  const continuation = await assessResumeContinuation(page, state, {
    expected_url_contains: state.handoff.expected_url_contains,
    expected_page_role: state.handoff.expected_page_role,
    expected_selector: state.handoff.expected_selector,
  });

  assert.equal(continuation.task_continuation_ok, false);
  assert.equal(continuation.passed_checks, 0);
  assert.equal(continuation.suggested_next_action, 'do_not_continue');

  state.handoff = markResumedUnverified(state.handoff, {
    url: page.url(),
    details: { continuation },
  }, 'anchor mismatch');

  assert.equal(state.handoff.state, 'resumed_unverified');
  assert.equal(state.handoff.evidence.details.continuation.task_continuation_ok, false);
});

test('resume continuation can report readiness and next action when expected affordance returns', async () => {
  const state = createServerState();
  state.pageState = {
    currentRole: 'docs',
    reacquired: true,
  };
  state.hintMap = [
    { id: 'B1', label: 'Search docs', type: 'button', x: 0, y: 0 },
    { id: 'L1', label: 'Getting Started', type: 'a', x: 0, y: 0 },
  ];

  const page = createFakePage({
    url: () => 'https://playwright.dev/docs/intro',
    evaluate: async (_fn, selector) => selector === 'main',
  });

  const continuation = await assessResumeContinuation(page, state, {
    expected_url_contains: '/docs/intro',
    expected_page_role: 'docs',
    expected_selector: 'main',
    continuation_goal: 'continue docs search workflow',
    expected_hint_label: 'Search',
  });

  assert.equal(continuation.task_continuation_ok, true);
  assert.equal(continuation.continuation_ready, true);
  assert.equal(continuation.suggested_next_action, 'use_hint_matching:Search');
  assert.equal(continuation.continuation_goal, 'continue docs search workflow');
});

test('gateway continuation reports resumed when handoff anchors match again', async () => {
  const state = createServerState();
  state.pageState = {
    currentRole: 'docs',
    reacquired: true,
  };
  state.hintMap = [
    { id: 'B1', label: 'Search docs', type: 'button', x: 0, y: 0 },
  ];

  const page = createFakePage({
    url: () => 'https://playwright.dev/docs/intro',
    evaluate: async (_fn, selector) => selector === 'main',
  });

  state.handoff = requestHandoff(state.handoff, 'login_required', 'persist anchors', {
    expected_url_contains: '/docs/intro',
    expected_page_role: 'docs',
    expected_selector: 'main',
    continuation_goal: 'continue docs search workflow',
    expected_hint_label: 'Search',
  });
  state.handoff = markResumeVerified(state.handoff, { url: page.url() }, 'resume confirmed');

  const continuation = await assessGatewayContinuation(page, state);

  assert.equal(continuation.status, 'resumed');
  assert.equal(continuation.continuation.suggested_next_action, 'use_hint_matching:Search');
});
