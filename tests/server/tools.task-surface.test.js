import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerTaskTools } from '../../src/server/tools.task-surface.js';
import { createServerState } from '../../src/server/state.js';
import { rememberTaskResult } from '../../src/server/task-frame.js';

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

test('create_task stores goal and target url for the task panel', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();

  registerTaskTools(server, state);

  const tool = calls.find((entry) => entry.name === 'create_task');
  const result = await tool.handler({
    taskId: 'task-docs',
    kind: 'extract',
    goal: '抓取帮助文档',
    target_url: 'https://example.com/docs',
  });

  assert.equal(result.meta.task.goal, '抓取帮助文档');
  assert.equal(result.meta.task.target_url, 'https://example.com/docs');
  assert.equal(state.activeTaskId, 'task-docs');
});

test('get_task exposes last result and artifacts for a tracked task', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();

  registerTaskTools(server, state);

  const createTool = calls.find((entry) => entry.name === 'create_task');
  const getTool = calls.find((entry) => entry.name === 'get_task');
  await createTool.handler({ taskId: 'task-report', kind: 'collect' });
  const frame = state.taskFrames.get('task-report');
  rememberTaskResult(frame, {
    tool: 'extract_batch',
    status: 'direct',
    summary: '2 records',
    page: { url: 'https://example.com/a' },
    artifacts: [{ path: 'C:\\temp\\batch-extract.json' }],
  });

  const result = await getTool.handler({ taskId: 'task-report' });

  assert.equal(result.meta.task.last_result.tool, 'extract_batch');
  assert.equal(result.meta.task.artifacts.length, 1);
  assert.equal(result.meta.task.artifacts[0].path, 'C:\\temp\\batch-extract.json');
});

test('cancel_task marks a tracked task as cancelled and clears the active slot', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();

  registerTaskTools(server, state);

  const createTool = calls.find((entry) => entry.name === 'create_task');
  const cancelTool = calls.find((entry) => entry.name === 'cancel_task');
  await createTool.handler({ taskId: 'task-stop', kind: 'extract' });
  const result = await cancelTool.handler({ taskId: 'task-stop', reason: '用户取消' });

  assert.equal(result.meta.task.status, 'cancelled');
  assert.equal(state.activeTaskId, null);
});

test('get_governance_status exposes permission mode and preferred tools', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();
  state.pageState.currentRole = 'content';
  state.lastRouteTrace = {
    status: 'direct',
    selected_mode: 'public_read',
    next_step: 'extract',
  };

  registerTaskTools(server, state);

  const tool = calls.find((entry) => entry.name === 'get_governance_status');
  const result = await tool.handler();

  assert.equal(result.meta.governance.permission_mode, 'read_only');
  assert.match(result.content[0].text, /Preferred tools:/);
});

test('get_activity_log reads parsed entries and keeps task ids visible', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = createServerState();
  const logPath = path.join(os.tmpdir(), `grasp-audit-${Date.now()}.log`);
  process.env.GRASP_AUDIT_LOG_PATH = logPath;
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `[2026-04-04 10:00:00] navigate       <task-a> https://example.com\n`, 'utf8');

  registerTaskTools(server, state);

  const tool = calls.find((entry) => entry.name === 'get_activity_log');
  const result = await tool.handler({ limit: 5 });

  assert.equal(result.meta.entries.length, 1);
  assert.equal(result.meta.entries[0].taskId, 'task-a');
  assert.match(result.content[0].text, /<task-a>/);
  delete process.env.GRASP_AUDIT_LOG_PATH;
});
