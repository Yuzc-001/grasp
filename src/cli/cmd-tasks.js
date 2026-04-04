import { readLogEntries } from '../server/audit.js';

function summarizeTasks(entries = []) {
  const grouped = new Map();

  for (const entry of entries) {
    if (!entry?.taskId) continue;
    const current = grouped.get(entry.taskId) ?? {
      taskId: entry.taskId,
      count: 0,
      last_timestamp: null,
      last_action: null,
      last_detail: null,
    };

    current.count += 1;
    current.last_timestamp = entry.timestamp;
    current.last_action = entry.action;
    current.last_detail = entry.detail;
    grouped.set(entry.taskId, current);
  }

  return [...grouped.values()];
}

export async function runTasks(args = []) {
  let limit = 200;

  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '--lines' || args[index] === '-n') && args[index + 1]) {
      limit = parseInt(args[index + 1], 10) || 200;
      index += 1;
    }
  }

  const entries = await readLogEntries(limit);
  const tasks = summarizeTasks(entries);

  if (tasks.length === 0) {
    console.log('No tracked task activity found in the audit log yet.');
    return;
  }

  console.log('');
  console.log(`  Recent Tasks  (from last ${entries.length} log entries)`);
  console.log('');

  for (const task of tasks) {
    console.log(`  ${task.taskId}`);
    console.log(`    Events: ${task.count}`);
    console.log(`    Last:   [${task.last_timestamp}] ${task.last_action} ${task.last_detail}`);
  }

  console.log('');
}
