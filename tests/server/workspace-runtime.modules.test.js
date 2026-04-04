import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveComposer as resolveComposerFromRuntime,
  draftIntoComposer as draftIntoComposerFromRuntime,
  draftWorkspaceAction as draftWorkspaceActionFromRuntime,
  executeWorkspaceAction as executeWorkspaceActionFromRuntime,
  verifyActionOutcome as verifyActionOutcomeFromRuntime,
} from '../../src/server/workspace-runtime.js';

import {
  resolveComposer,
  draftIntoComposer,
  draftWorkspaceAction,
} from '../../src/server/workspace-runtime.draft.js';

import { executeWorkspaceAction } from '../../src/server/workspace-runtime.execute.js';
import { verifyActionOutcome } from '../../src/server/workspace-runtime.verify.js';

test('workspace runtime split modules expose the same callable surface as workspace-runtime.js', () => {
  assert.equal(resolveComposerFromRuntime, resolveComposer);
  assert.equal(draftIntoComposerFromRuntime, draftIntoComposer);
  assert.equal(draftWorkspaceActionFromRuntime, draftWorkspaceAction);
  assert.equal(executeWorkspaceActionFromRuntime, executeWorkspaceAction);
  assert.equal(verifyActionOutcomeFromRuntime, verifyActionOutcome);
});
