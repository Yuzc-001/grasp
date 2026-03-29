import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTaskTools } from '../../src/server/tools.task-surface.js';
import { createServerState } from '../../src/server/state.js';

test('list_tasks lists active tasks with their status', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();

  registerTaskTools(server, state);

  const listTool = calls.find((entry) => entry.name === 'list_tasks');
  const switchTool = calls.find((entry) => entry.name === 'switch_task');

  // Initial list is empty-ish
  const emptyResult = await listTool.handler();
  assert.equal(emptyResult.content[0].text, 'No active tasks tracked.');

  // Create tasks
  await switchTool.handler({ taskId: 'task-1', kind: 'workspace' });
  await switchTool.handler({ taskId: 'task-2', kind: 'extract' });

  // task-2 is active
  const result = await listTool.handler();
  assert.equal(result.meta.tasks.length, 2);
  assert.equal(result.meta.tasks.find(t => t.taskId === 'task-1').active, false);
  assert.equal(result.meta.tasks.find(t => t.taskId === 'task-2').active, true);
});

test('switch_task creates new tasks and switches between existing ones', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();

  registerTaskTools(server, state);

  const switchTool = calls.find((entry) => entry.name === 'switch_task');

  // New task
  const createResult = await switchTool.handler({ taskId: 'task-new', kind: 'workspace' });
  assert.equal(createResult.meta.is_new, true);
  assert.equal(state.activeTaskId, 'task-new');
  assert.equal(state.taskFrames.size, 1);

  // Switch to existing task
  const switchResult = await switchTool.handler({ taskId: 'task-new' });
  assert.equal(switchResult.meta.is_new, false);
  assert.equal(state.activeTaskId, 'task-new');
  assert.equal(state.taskFrames.size, 1);
});
