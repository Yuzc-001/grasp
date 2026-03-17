import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export const CONFIG_DIR = join(homedir(), '.grasp');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  cdpUrl: 'http://localhost:9222',
  safeMode: true,
};

export async function readConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeConfig(updates) {
  await mkdir(CONFIG_DIR, { recursive: true });
  const current = await readConfig();
  const merged = { ...current, ...updates };
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
