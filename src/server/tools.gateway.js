import { z } from 'zod';

import { buildGatewayResponse } from './gateway-response.js';
import { extractObservedContent } from './observe.js';
import { assessGatewayContinuation } from './continuity.js';
import { getActivePage } from '../layer1-bridge/chrome.js';
import { syncPageState } from './state.js';
import { enterWithStrategy } from './tools.strategy.js';

function toGatewayPage({ title, url, pageState }, state) {
  return {
    title: title ?? 'unknown',
    url,
    page_role: pageState?.currentRole ?? state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: pageState?.graspConfidence ?? state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: pageState?.riskGateDetected ?? state.pageState?.riskGateDetected ?? false,
  };
}

function getGatewayStatus(state) {
  const pageState = state.pageState ?? {};
  const handoffState = state.handoff?.state ?? 'idle';
  if (handoffState === 'handoff_required' || pageState.riskGateDetected || pageState.currentRole === 'checkpoint') {
    return 'gated';
  }
  return 'direct';
}

function getGatewayContinuation(state, suggestedNextAction) {
  const handoffState = state.handoff?.state ?? 'idle';
  if (getGatewayStatus(state) === 'gated') {
    return {
      can_continue: false,
      suggested_next_action: 'request_handoff',
      handoff_state: handoffState,
    };
  }

  return {
    can_continue: true,
    suggested_next_action: suggestedNextAction,
    handoff_state: handoffState,
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
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const observeContent = deps.extractObservedContent ?? extractObservedContent;

  server.registerTool(
    'entry',
    {
      description: 'Enter a URL through the gateway using preflight strategy metadata.',
      inputSchema: {
        url: z.string().url().describe('Target URL to enter'),
      },
    },
    async ({ url }) => {
      const outcome = await enter({ url, state, deps: { auditName: 'entry' } });
      const gatewayOutcome = buildGatewayOutcome(outcome);

      return buildGatewayResponse({
        status: gatewayOutcome.status,
        page: toGatewayPage(outcome, state),
        continuation: {
          can_continue: gatewayOutcome.canContinue,
          suggested_next_action: gatewayOutcome.suggestedNextAction,
          handoff_state: outcome.handoff?.state ?? state.handoff?.state ?? 'idle',
        },
        evidence: { strategy: outcome.preflight ?? null },
      });
    }
  );

  server.registerTool(
    'inspect',
    {
      description: 'Inspect the current gateway page status and handoff state.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });

      return buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: await page.title(),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: getGatewayContinuation(state, 'extract'),
      });
    }
  );

  server.registerTool(
    'extract',
    {
      description: 'Extract a concise summary of the current page content.',
      inputSchema: {
        include_markdown: z.boolean().optional().describe('Include a minimal Markdown rendering of the extracted content'),
      },
    },
    async ({ include_markdown = false } = {}) => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const result = await observeContent({
        page,
        deps: {
          waitStable: deps.waitUntilStable,
          extractContent: deps.extractMainContent,
        },
        include_markdown,
      });

      return buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: await page.title(),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        result,
        continuation: getGatewayContinuation(state, 'inspect'),
      });
    }
  );

  server.registerTool(
    'continue',
    {
      description: 'Decide the next continuation step without triggering browser actions.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const outcome = await assessGatewayContinuation(page, state);

      return buildGatewayResponse({
        status: outcome.status,
        page: toGatewayPage({
          title: await page.title(),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: outcome.continuation,
      });
    }
  );
}
