import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerState, getActiveTaskFrame } from '../../src/server/state.js';
import { createTaskFrame } from '../../src/server/task-frame.js';

test('task frames isolate task-specific state', () => {
  const state = createServerState();

  // Create two tasks
  state.taskFrames.set('task-a', createTaskFrame({ taskId: 'task-a', kind: 'workspace' }));
  state.taskFrames.set('task-b', createTaskFrame({ taskId: 'task-b', kind: 'extract' }));

  // Switch to task-a
  state.activeTaskId = 'task-a';
  const frameA = getActiveTaskFrame(state);
  frameA.history.push({ action: 'navigate', url: 'https://example.com/a' });
  frameA.semanticBindings.set('submit', 'B1');

  // Switch to task-b
  state.activeTaskId = 'task-b';
  const frameB = getActiveTaskFrame(state);
  frameB.history.push({ action: 'navigate', url: 'https://example.com/b' });
  frameB.semanticBindings.set('submit', 'B9');

  // Verify isolation
  assert.equal(state.taskFrames.get('task-a').history.length, 1);
  assert.equal(state.taskFrames.get('task-a').history[0].url, 'https://example.com/a');
  assert.equal(state.taskFrames.get('task-a').semanticBindings.get('submit'), 'B1');

  assert.equal(state.taskFrames.get('task-b').history.length, 1);
  assert.equal(state.taskFrames.get('task-b').history[0].url, 'https://example.com/b');
  assert.equal(state.taskFrames.get('task-b').semanticBindings.get('submit'), 'B9');
});

test('getActiveTaskFrame returns null when no task is active or task frame is missing', () => {
  const state = createServerState();
  assert.equal(getActiveTaskFrame(state), null);

  state.activeTaskId = 'missing-task';
  assert.equal(getActiveTaskFrame(state), null);

  state.taskFrames.set('real-task', createTaskFrame({ taskId: 'real-task', kind: 'extract' }));
  state.activeTaskId = 'real-task';
  assert.notEqual(getActiveTaskFrame(state), null);
  assert.equal(getActiveTaskFrame(state).taskId, 'real-task');
});
