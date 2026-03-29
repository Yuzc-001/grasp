import { z } from 'zod';
import { createTaskFrame } from './task-frame.js';
import { textResponse } from './responses.js';

export function registerTaskTools(server, state) {
  server.registerTool(
    'list_tasks',
    {
      description: 'List all currently tracked tasks in the runtime.',
      inputSchema: {},
    },
    async () => {
      const tasks = Array.from(state.taskFrames.values()).map((frame) => ({
        taskId: frame.taskId,
        kind: frame.kind,
        attempts: frame.attempts,
        active: state.activeTaskId === frame.taskId,
      }));

      if (tasks.length === 0) {
        return textResponse('No active tasks tracked.');
      }

      const lines = tasks.map((t) =>
        `[${t.active ? '*' : ' '}] ${t.taskId} (kind: ${t.kind}, attempts: ${t.attempts})`
      );

      return textResponse([
        'Tracked Tasks:',
        '',
        ...lines,
        '',
        '* = currently active task',
      ], { tasks });
    }
  );

  server.registerTool(
    'switch_task',
    {
      description: 'Switch the active task context or create a new task frame.',
      inputSchema: {
        taskId: z.string().describe('Unique ID for the task'),
        kind: z.enum(['read', 'extract', 'act', 'submit', 'workspace', 'collect']).optional().describe('Task kind (used when creating a new task)'),
      },
    },
    async ({ taskId, kind = 'extract' }) => {
      let frame = state.taskFrames.get(taskId);
      const isNew = !frame;

      if (isNew) {
        frame = createTaskFrame({ taskId, kind });
        state.taskFrames.set(taskId, frame);
      }

      state.activeTaskId = taskId;

      return textResponse(
        isNew
          ? `Created and switched to new task: ${taskId} (kind: ${kind})`
          : `Switched to existing task: ${taskId}`,
        { taskId, kind: frame.kind, is_new: isNew }
      );
    }
  );
}
