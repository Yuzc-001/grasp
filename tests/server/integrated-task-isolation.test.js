import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerState } from '../../src/server/state.js';
import { registerActionTools } from '../../src/server/tools.actions.js';
import { registerTaskTools } from '../../src/server/tools.task-surface.js';
import { createFakePage } from '../helpers/fake-page.js';

test('integrated task switching isolates action history via dependency injection', async () => {
  const state = createServerState();
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  
  // Create fake page
  const page = createFakePage({ url: 'https://initial.com', title: 'initial' });
  
  registerActionTools(server, state, {
    getActivePage: async () => page,
    navigateTo: async (url) => {
      page.url = () => url;
      return page;
    },
    syncPageState: async () => {} // Skip browser evaluate
  });
  registerTaskTools(server, state);

  const navigateTool = calls.find(t => t.name === 'navigate');
  const switchTool = calls.find(t => t.name === 'switch_task');

  // 1. Setup Task A and perform action
  await switchTool.handler({ taskId: 'task-A', kind: 'workspace' });
  await navigateTool.handler({ url: 'https://site-a.com' });

  // 2. Setup Task B and perform action
  await switchTool.handler({ taskId: 'task-B', kind: 'extract' });
  await navigateTool.handler({ url: 'https://site-b.com' });

  // 3. Verify Isolation
  const frameA = state.taskFrames.get('task-A');
  const frameB = state.taskFrames.get('task-B');

  assert.ok(frameA, 'Frame A should exist');
  assert.ok(frameB, 'Frame B should exist');

  assert.equal(frameA.history.length, 1, 'Frame A should have 1 entry');
  assert.equal(frameB.history.length, 1, 'Frame B should have 1 entry');
  
  assert.equal(frameA.history[0].action, 'navigate');
  assert.equal(frameA.history[0].detail, 'https://site-a.com');
  
  assert.equal(frameB.history[0].action, 'navigate');
  assert.equal(frameB.history[0].detail, 'https://site-b.com');

  // 4. Return to Task A and perform another action
  await switchTool.handler({ taskId: 'task-A' });
  await navigateTool.handler({ url: 'https://site-a-deep.com' });

  assert.equal(frameA.history.length, 2, 'Frame A should now have 2 entries');
  assert.equal(frameA.history[1].detail, 'https://site-a-deep.com');
  assert.equal(frameB.history.length, 1, 'Frame B should still have 1 entry');
});
