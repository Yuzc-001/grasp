import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const LOG_PATH = join(homedir(), '.grasp', 'audit.log');

async function readLines(n) {
  try {
    const content = await readFile(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export async function runLogs(args) {
  let lines = 50;
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--lines' || args[i] === '-n') && args[i + 1]) {
      lines = parseInt(args[++i], 10) || 50;
    } else if (args[i] === '--follow' || args[i] === '-f') {
      follow = true;
    }
  }

  const entries = await readLines(lines);
  if (entries.length === 0) {
    console.log('No log entries yet.');
    if (!follow) return;
  } else {
    entries.forEach(l => console.log(l));
  }

  if (!follow) return;

  // Follow mode: poll every 500ms, print new lines
  console.log('--- following (Ctrl+C to stop) ---');
  let lastCount = entries.length;

  setInterval(async () => {
    try {
      const content = await readFile(LOG_PATH, 'utf8');
      const all = content.split('\n').filter(Boolean);
      if (all.length > lastCount) {
        all.slice(lastCount).forEach(l => console.log(l));
        lastCount = all.length;
      }
    } catch {
      // Log file removed or inaccessible — keep waiting
    }
  }, 500);
}
