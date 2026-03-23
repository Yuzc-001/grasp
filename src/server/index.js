import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServerState } from './state.js';
import { registerTools } from './tools.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

export const SERVER_INFO = {
  name: 'grasp',
  version,
};

export function createGraspServer() {
  const server = new McpServer(SERVER_INFO);
  const state = createServerState();

  registerTools(server, state);

  return { server, state };
}
