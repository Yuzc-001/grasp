import { registerGatewayTools } from './tools.gateway.js';
import { registerFormTools } from './tools.form.js';
import { registerWorkspaceTools } from './tools.workspace.js';
import { registerStrategyTools } from './tools.strategy.js';
import { registerHandoffTools } from './tools.handoff.js';
import { registerActionTools } from './tools.actions.js';
import { registerTaskTools } from './tools.task-surface.js';

export function registerTools(server, state) {
  registerGatewayTools(server, state);
  registerFormTools(server, state);
  registerWorkspaceTools(server, state);
  registerStrategyTools(server, state);
  registerHandoffTools(server, state);
  registerActionTools(server, state);
  registerTaskTools(server, state);

  return server;
}

