import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldMarkResumeVerified } from '../../src/server/tools.handoff.js';

test('resume should verify when continuation is ready even if reacquired is false', () => {
  const result = shouldMarkResumeVerified({
    verify: true,
    checkpointStillPresent: false,
    pageState: {
      reacquired: false,
    },
    continuation: {
      task_continuation_ok: true,
      continuation_ready: true,
    },
  });

  assert.equal(result, true);
});

test('resume should stay unverified when continuation explicitly failed', () => {
  const result = shouldMarkResumeVerified({
    verify: true,
    checkpointStillPresent: false,
    pageState: {
      reacquired: true,
    },
    continuation: {
      task_continuation_ok: false,
      continuation_ready: false,
    },
  });

  assert.equal(result, false);
});

test('resume should stay unverified without reacquisition or continuation readiness', () => {
  const result = shouldMarkResumeVerified({
    verify: true,
    checkpointStillPresent: false,
    pageState: {
      reacquired: false,
    },
    continuation: {
      task_continuation_ok: null,
      continuation_ready: false,
    },
  });

  assert.equal(result, false);
});
