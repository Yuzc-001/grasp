import { z } from 'zod';

import { getAuditLogPath, readLogEntries } from './audit.js';
import { buildAgentBoundary } from './route-boundary.js';
import { textResponse } from './responses.js';
import { isSafeModeEnabled } from './state.js';
import { createTaskFrame, touchTaskFrame } from './task-frame.js';

function toTaskMeta(frame, state) {
  return {
    taskId: frame.taskId,
    kind: frame.kind,
    attempts: frame.attempts,
    status: frame.status ?? 'active',
    active: state.activeTaskId === frame.taskId,
    goal: frame.goal ?? null,
    target_url: frame.targetUrl ?? null,
    last_tool: frame.lastTool ?? null,
    artifact_count: Array.isArray(frame.artifacts) ? frame.artifacts.length : 0,
    updated_at: frame.updatedAt ?? null,
  };
}

function buildPermissionMode(boundaryKey) {
  if (boundaryKey === 'handoff') return 'blocked';
  if (boundaryKey === 'public_read') return 'read_only';
  if (boundaryKey === 'session_warmup') return 'warmup_only';
  if (boundaryKey === 'live_session') return 'guarded_runtime';
  if (boundaryKey === 'form_runtime' || boundaryKey === 'workspace_runtime') return 'guarded_write';
  return 'unknown';
}

function buildGovernanceSummary(state) {
  const boundary = buildAgentBoundary({
    status: state.lastRouteTrace?.status ?? 'direct',
    continuation: {
      suggested_next_action: state.lastRouteTrace?.next_step ?? null,
    },
    route: state.lastRouteTrace,
    page: {
      page_role: state.pageState?.currentRole ?? null,
    },
  });
  const safeMode = isSafeModeEnabled();

  return {
    safe_mode: safeMode,
    boundary: boundary?.key ?? null,
    permission_mode: buildPermissionMode(boundary?.key ?? null),
    preferred_tools: boundary?.preferred_tools ?? [],
    avoid: boundary?.avoid ?? [],
    confirmation: boundary?.confirmation ?? null,
    high_risk_policy: safeMode
      ? 'intercept_high_risk_actions'
      : 'allow_runtime_actions_without_safe_mode_intercept',
    activity_log_path: getAuditLogPath(),
  };
}

export function registerTaskTools(server, state) {
  server.registerTool(
    'list_tasks',
    {
      description: 'List all currently tracked tasks in the runtime.',
      inputSchema: {},
    },
    async () => {
      const tasks = Array.from(state.taskFrames.values()).map((frame) => toTaskMeta(frame, state));

      if (tasks.length === 0) {
        return textResponse('No active tasks tracked.');
      }

      const lines = tasks.map((task) =>
        `[${task.active ? '*' : ' '}] ${task.taskId} (kind: ${task.kind}, status: ${task.status}, attempts: ${task.attempts}, artifacts: ${task.artifact_count})`
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
    'create_task',
    {
      description: 'Create a tracked task frame with optional goal and target URL, then switch into it.',
      inputSchema: {
        taskId: z.string().describe('Unique ID for the task'),
        kind: z.enum(['read', 'extract', 'act', 'submit', 'workspace', 'collect']).optional().describe('Task kind used to initialize the frame'),
        goal: z.string().optional().describe('Plain-language task goal shown in the task panel'),
        target_url: z.string().url().optional().describe('Optional target URL associated with the task'),
      },
    },
    async ({ taskId, kind = 'extract', goal = null, target_url = null }) => {
      let frame = state.taskFrames.get(taskId);
      const isNew = !frame;

      if (!frame) {
        frame = createTaskFrame({ taskId, kind });
        state.taskFrames.set(taskId, frame);
      }

      touchTaskFrame(frame, {
        status: frame.status === 'cancelled' ? 'active' : (frame.status ?? 'active'),
        goal: goal ?? frame.goal ?? null,
        targetUrl: target_url ?? frame.targetUrl ?? null,
      });
      state.activeTaskId = taskId;

      return textResponse(
        isNew
          ? `Created task ${taskId} and switched into it.`
          : `Updated task ${taskId} and switched into it.`,
        {
          task: toTaskMeta(frame, state),
          is_new: isNew,
        }
      );
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

      touchTaskFrame(frame);
      state.activeTaskId = taskId;

      return textResponse(
        isNew
          ? `Created and switched to new task: ${taskId} (kind: ${kind})`
          : `Switched to existing task: ${taskId}`,
        { taskId, kind: frame.kind, is_new: isNew, task: toTaskMeta(frame, state) }
      );
    }
  );

  server.registerTool(
    'get_task',
    {
      description: 'Show the current state, latest result, and artifacts for a tracked task.',
      inputSchema: {
        taskId: z.string().describe('Tracked task ID to inspect'),
      },
    },
    async ({ taskId }) => {
      const frame = state.taskFrames.get(taskId);
      if (!frame) {
        return textResponse(`Task not found: ${taskId}`, {
          error_code: 'TASK_NOT_FOUND',
          taskId,
        });
      }

      return textResponse([
        `Task: ${frame.taskId}`,
        `Kind: ${frame.kind}`,
        `Status: ${frame.status ?? 'active'}`,
        `Goal: ${frame.goal ?? 'none'}`,
        `Target URL: ${frame.targetUrl ?? 'none'}`,
        `Last tool: ${frame.lastTool ?? 'none'}`,
        `Artifacts: ${Array.isArray(frame.artifacts) ? frame.artifacts.length : 0}`,
      ], {
        task: {
          ...toTaskMeta(frame, state),
          last_result: frame.lastResult ?? null,
          artifacts: frame.artifacts ?? [],
          history: frame.history ?? [],
        },
      });
    }
  );

  server.registerTool(
    'cancel_task',
    {
      description: 'Cancel a tracked task and remove it from the active slot.',
      inputSchema: {
        taskId: z.string().describe('Tracked task ID to cancel'),
        reason: z.string().optional().describe('Optional cancellation reason'),
      },
    },
    async ({ taskId, reason = null }) => {
      const frame = state.taskFrames.get(taskId);
      if (!frame) {
        return textResponse(`Task not found: ${taskId}`, {
          error_code: 'TASK_NOT_FOUND',
          taskId,
        });
      }

      const cancelledAt = new Date().toISOString();
      touchTaskFrame(frame, {
        status: 'cancelled',
        cancelledAt,
        lastResult: {
          tool: 'cancel_task',
          status: 'cancelled',
          summary: reason ?? 'cancelled_by_user',
          route: null,
          page: null,
          recordedAt: cancelledAt,
        },
      });

      if (state.activeTaskId === taskId) {
        state.activeTaskId = null;
      }

      return textResponse(
        `Cancelled task: ${taskId}`,
        {
          task: {
            ...toTaskMeta(frame, state),
            cancelled_at: cancelledAt,
            cancel_reason: reason,
          },
        }
      );
    }
  );

  server.registerTool(
    'get_activity_log',
    {
      description: 'Read the latest runtime activity log, optionally filtered to one task.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional().describe('Number of recent entries to return'),
        taskId: z.string().optional().describe('Optional task ID filter'),
      },
    },
    async ({ limit = 20, taskId = null } = {}) => {
      const entries = await readLogEntries(limit, { taskId });
      if (entries.length === 0) {
        return textResponse('No activity entries found.', {
          entries: [],
          taskId,
          path: getAuditLogPath(),
        });
      }

      return textResponse([
        `Activity log: ${entries.length} entries`,
        `Path: ${getAuditLogPath()}`,
        '',
        ...entries.map((entry) => `[${entry.timestamp}] ${entry.action}${entry.taskId ? ` <${entry.taskId}>` : ''} ${entry.detail}`),
      ], {
        entries,
        taskId,
        path: getAuditLogPath(),
      });
    }
  );

  server.registerTool(
    'get_governance_status',
    {
      description: 'Show the current runtime governance pack: safe mode, permission mode, and preferred tool surface.',
      inputSchema: {},
    },
    async () => {
      const governance = buildGovernanceSummary(state);

      return textResponse([
        `Safe mode: ${governance.safe_mode ? 'on' : 'off'}`,
        `Boundary: ${governance.boundary ?? 'unknown'}`,
        `Permission mode: ${governance.permission_mode}`,
        `High-risk policy: ${governance.high_risk_policy}`,
        `Preferred tools: ${governance.preferred_tools.join(', ') || 'none'}`,
      ], { governance });
    }
  );
}
