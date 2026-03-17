/**
 * Auto-configure Grasp into detected AI clients.
 * Supported: Claude Code, Codex CLI, Cursor
 *
 * OpenClaw is an agent gateway (not an MCP client) — not applicable here.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir, platform } from 'os';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const GRASP_MCP_JSON = { command: 'npx', args: ['-y', 'grasp'] };
const env = process.env;

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasCommand(cmd) {
  try {
    execSync(platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

async function writeMcpJson(filePath) {
  await mkdir(join(filePath, '..'), { recursive: true });
  let config = {};
  try { config = JSON.parse(await readFile(filePath, 'utf8')); } catch { /* new file */ }
  config.mcpServers ??= {};
  if (JSON.stringify(config.mcpServers.grasp) === JSON.stringify(GRASP_MCP_JSON)) {
    return 'already-configured';
  }
  config.mcpServers.grasp = GRASP_MCP_JSON;
  await writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return 'written';
}

async function writeCodexToml(filePath) {
  await mkdir(join(filePath, '..'), { recursive: true });
  let content = '';
  try { content = await readFile(filePath, 'utf8'); } catch { /* new file */ }
  if (content.includes('[mcp_servers.grasp]')) return 'already-configured';
  const entry = '\n[mcp_servers.grasp]\ntype    = "stdio"\ncommand = "npx"\nargs    = ["-y", "grasp"]\n';
  await writeFile(filePath, content + entry, 'utf8');
  return 'written';
}

// ─── Client definitions ──────────────────────────────────────────────────────

const CLIENTS = [

  // Claude Code CLI
  {
    id: 'claude-code',
    label: 'Claude Code',
    installed: () => hasCommand('claude'),
    configure: async () => {
      try {
        const out = execSync('claude mcp list', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (out.includes('grasp:')) return 'already-configured';
      } catch { /* no entries yet */ }
      try {
        execSync('claude mcp add grasp -- npx -y grasp', { stdio: 'ignore' });
        return 'written';
      } catch { return 'failed'; }
    },
  },

  // Codex CLI
  {
    id: 'codex',
    label: 'Codex CLI',
    installed: () => hasCommand('codex'),
    configure: async () => writeCodexToml(join(homedir(), '.codex', 'config.toml')),
  },

  // Cursor
  {
    id: 'cursor',
    label: 'Cursor',
    installed: () => {
      if (hasCommand('cursor')) return true;
      if (platform() === 'win32')
        return existsSync(join(env.LOCALAPPDATA ?? '', 'Programs', 'cursor', 'Cursor.exe'));
      if (platform() === 'darwin') return existsSync('/Applications/Cursor.app');
      return false;
    },
    configure: async () => writeMcpJson(join(homedir(), '.cursor', 'mcp.json')),
  },

];

// ─── Public API ──────────────────────────────────────────────────────────────

export function detectClients() {
  return CLIENTS.filter(c => c.installed()).map(c => c.id);
}

export async function autoConfigureAll(clientIds) {
  const results = [];
  for (const id of clientIds) {
    const client = CLIENTS.find(c => c.id === id);
    if (!client) continue;
    try {
      const result = await client.configure();
      results.push({ id, label: client.label, result });
    } catch (err) {
      results.push({ id, label: client.label, result: 'failed', error: err.message });
    }
  }
  return results;
}
