import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServerState } from './state.js';
import { registerTools } from './tools.js';

export const SERVER_INFO = {
  name: 'grasp',
  version: '0.1.0',
};

export function createGraspServer() {
  const server = new McpServer(SERVER_INFO);
  const state = createServerState();

  registerTools(server, state);

  return { server, state };
}
