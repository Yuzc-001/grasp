import { mkdir, appendFile, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.grasp');
const LOG_PATH = join(LOG_DIR, 'audit.log');

/**
 * Append one audit entry. Fire-and-forget — failures are silently ignored.
 * @param {string} action  e.g. 'click', 'navigate', 'type'
 * @param {string} detail  e.g. '[B1] "发送"'
 */
export async function audit(action, detail) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `[${ts}] ${action.padEnd(10)} ${detail}\n`;
    await appendFile(LOG_PATH, line, 'utf8');
  } catch {
    // Logging failures must never affect the main tool flow.
  }
}

/**
 * Read the last N lines from the audit log.
 * @param {number} [n=50]
 * @returns {Promise<string[]>}
 */
export async function readLogs(n = 50) {
  try {
    const content = await readFile(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}
