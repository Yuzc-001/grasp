import { mkdir, appendFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.grasp');
const LOG_PATH = join(LOG_DIR, 'audit.log');

function getAuditLogPath() {
  return process.env.GRASP_AUDIT_LOG_PATH || LOG_PATH;
}

function parseAuditLine(line) {
  const match = /^\[(.+?)\]\s+(\S+)\s+(.*)$/.exec(String(line ?? ''));
  if (!match) return null;

  const [, timestamp, action, remainder] = match;
  let detail = remainder.trim();
  let meta = null;
  const markerIndex = detail.lastIndexOf(' :: ');

  if (markerIndex !== -1) {
    const maybeJson = detail.slice(markerIndex + 4);
    try {
      meta = JSON.parse(maybeJson);
      detail = detail.slice(0, markerIndex).trim();
    } catch {
      meta = null;
    }
  }

  return {
    timestamp,
    action,
    detail,
    meta,
  };
}

/**
 * Append one audit entry. Fire-and-forget — failures are silently ignored.
 * @param {string} action  e.g. 'click', 'navigate', 'type'
 * @param {string} detail  e.g. '[B1] "发送"'
 */
export async function audit(action, detail, meta = null) {
  try {
    const logPath = getAuditLogPath();
    await mkdir(dirname(logPath), { recursive: true });
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const suffix = meta ? ` :: ${JSON.stringify(meta)}` : '';
    const line = `[${ts}] ${action.padEnd(14)} ${detail}${suffix}\n`;
    await appendFile(logPath, line, 'utf8');
  } catch {
    // Logging failures must never affect the main tool flow.
  }
}

export async function auditRouteDecision(trace) {
  const intent = trace?.intent ?? 'unknown';
  const mode = trace?.selected_mode ?? 'unknown';
  const url = trace?.url ?? 'unknown';
  await audit('route_decision', `${intent} -> ${mode} @ ${url}`, trace);
}

/**
 * Read the last N lines from the audit log.
 * @param {number} [n=50]
 * @returns {Promise<string[]>}
 */
export async function readLogs(n = 50) {
  try {
    const content = await readFile(getAuditLogPath(), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export async function readLatestRouteDecision() {
  try {
    const content = await readFile(getAuditLogPath(), 'utf8');
    const lines = content.split('\n').filter(Boolean).reverse();

    for (const line of lines) {
      const entry = parseAuditLine(line);
      if (entry?.action !== 'route_decision' || !entry.meta) continue;
      return {
        timestamp: entry.timestamp,
        detail: entry.detail,
        ...entry.meta,
      };
    }

    return null;
  } catch {
    return null;
  }
}
