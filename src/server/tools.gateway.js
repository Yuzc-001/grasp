import { z } from 'zod';

import { buildGatewayResponse } from './gateway-response.js';
import { enterWithStrategy } from './tools.strategy.js';

function toGatewayPage(outcome, state) {
  return {
    title: outcome.title ?? 'unknown',
    url: outcome.url,
    page_role: outcome.pageState?.currentRole ?? state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: outcome.pageState?.graspConfidence ?? state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: outcome.pageState?.riskGateDetected ?? state.pageState?.riskGateDetected ?? false,
  };
}

function buildGatewayOutcome(outcome) {
  const strategy = outcome.preflight?.recommended_entry_strategy ?? 'direct';
  const trust = outcome.preflight?.session_trust ?? 'medium';

  if (strategy === 'handoff_or_preheat') {
    return {
      status: 'gated',
      canContinue: false,
      suggestedNextAction: outcome.pageState?.riskGateDetected ? 'request_handoff' : 'preheat_session',
    };
  }

  if (strategy === 'preheat_before_direct_entry' || trust === 'low') {
    return {
      status: 'warmup',
      canContinue: true,
      suggestedNextAction: 'preheat_session',
    };
  }

  return {
    status: 'direct',
    canContinue: true,
    suggestedNextAction: 'inspect',
  };
}

export function registerGatewayTools(server, state, deps = {}) {
  const enter = deps.enterWithStrategy ?? enterWithStrategy;

  server.registerTool(
    'entry',
    {
      description: 'Enter a URL through the gateway using preflight strategy metadata.',
      inputSchema: {
        url: z.string().url().describe('Target URL to enter'),
      },
    },
    async ({ url }) => {
      const outcome = await enter({ url, state });
      const gatewayOutcome = buildGatewayOutcome(outcome);

      return buildGatewayResponse({
        status: gatewayOutcome.status,
        page: toGatewayPage(outcome, state),
        continuation: {
          can_continue: gatewayOutcome.canContinue,
          suggested_next_action: gatewayOutcome.suggestedNextAction,
          handoff_state: state.handoff?.state ?? 'idle',
        },
        evidence: { strategy: outcome.preflight ?? null },
      });
    }
  );
}
