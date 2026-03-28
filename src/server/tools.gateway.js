import { z } from 'zod';

import { buildGatewayResponse } from './gateway-response.js';
import { extractObservedContent } from './observe.js';
import { assessGatewayContinuation } from './continuity.js';
import { getActivePage } from '../layer1-bridge/chrome.js';
import { syncPageState } from './state.js';
import { enterWithStrategy } from './tools.strategy.js';
import { readBossFastPath } from './fast-path-router.js';
import { buildPageProjection } from './page-projection.js';
import { selectEngine } from './engine-selection.js';
import { decideRoute, resolveRouteIntent } from './route-policy.js';
import { auditRouteDecision, readLatestRouteDecision } from './audit.js';
import { textResponse } from './responses.js';
import { ROUTE_BLOCKED } from './error-codes.js';

function toGatewayPage({ title, url, pageState }, state, { preferCurrentUrl = false } = {}) {
  const pageUrl = preferCurrentUrl
    ? state.lastUrl ?? 'unknown'
    : url ?? state.lastUrl ?? 'unknown';

  return {
    title: title ?? 'unknown',
    url: pageUrl,
    page_role: pageState?.currentRole ?? state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: pageState?.graspConfidence ?? state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: pageState?.riskGateDetected ?? state.pageState?.riskGateDetected ?? false,
  };
}

function isBlockedHandoffState(handoffState) {
  return handoffState === 'handoff_required'
    || handoffState === 'handoff_in_progress'
    || handoffState === 'awaiting_reacquisition';
}

function getGatewayStatus(state) {
  const pageState = state.pageState ?? {};
  const handoffState = state.handoff?.state ?? 'idle';
  if (isBlockedHandoffState(handoffState)) {
    return 'handoff_required';
  }
  if (pageState.riskGateDetected || pageState.currentRole === 'checkpoint') {
    return 'gated';
  }
  return 'direct';
}

function getGatewayContinuation(state, suggestedNextAction) {
  const handoffState = state.handoff?.state ?? 'idle';
  if (getGatewayStatus(state) !== 'direct') {
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
  const handoffState = outcome.handoff?.state ?? 'idle';
  const pageState = outcome.pageState ?? {};

  if (isBlockedHandoffState(handoffState) || pageState.riskGateDetected || pageState.currentRole === 'checkpoint') {
    return {
      status: 'gated',
      canContinue: false,
      suggestedNextAction: 'request_handoff',
    };
  }

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

function getRouteForState({ url, state, intent = null }) {
  const resolvedIntent = resolveRouteIntent({
    intent,
    pageState: state.pageState,
    lastIntent: state.lastRouteTrace?.intent ?? null,
  });

  return decideRoute({
    url,
    intent: resolvedIntent,
    selection: selectEngine({ tool: resolvedIntent, url }),
    preflight: state.lastRouteTrace?.evidence
      ? {
          session_trust: state.lastRouteTrace.evidence.session_trust,
          recommended_entry_strategy: state.lastRouteTrace.evidence.recommended_entry_strategy,
        }
      : {},
    pageState: state.pageState,
    handoff: state.handoff,
  });
}

export function registerGatewayTools(server, state, deps = {}) {
  const enter = deps.enterWithStrategy ?? enterWithStrategy;
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const observeContent = deps.extractObservedContent ?? extractObservedContent;
  const auditRoute = deps.auditRouteDecision ?? auditRouteDecision;
  const readLatestRoute = deps.readLatestRouteDecision ?? readLatestRouteDecision;

  server.registerTool(
    'entry',
    {
      description: 'Enter a URL through the gateway using preflight strategy metadata.',
      inputSchema: {
        url: z.string().url().describe('Target URL to enter'),
        intent: z.enum(['read', 'extract', 'act', 'submit', 'workspace', 'collect']).optional().describe('Task intent used to choose the best route'),
      },
    },
    async ({ url, intent = 'extract' }) => {
      const outcome = await enter({ url, state, deps: { auditName: 'entry' } });
      const gatewayOutcome = buildGatewayOutcome(outcome);
      const preferCurrentUrl = outcome.preflight?.recommended_entry_strategy === 'handoff_or_preheat';
      const route = decideRoute({
        url,
        intent,
        selection: selectEngine({ tool: intent, url }),
        preflight: outcome.preflight,
        pageState: outcome.pageState ?? state.pageState,
        handoff: outcome.handoff ?? state.handoff,
      });
      const routeTrace = {
        url,
        intent,
        status: gatewayOutcome.status,
        ...route,
        failure_type: route.selected_mode === 'handoff' ? 'route_blocked' : 'none',
        error_code: route.selected_mode === 'handoff' ? ROUTE_BLOCKED : null,
      };

      state.lastRouteTrace = routeTrace;
      await auditRoute(routeTrace);

      return buildGatewayResponse({
        status: gatewayOutcome.status,
        page: toGatewayPage(outcome, state, { preferCurrentUrl }),
        continuation: {
          can_continue: gatewayOutcome.canContinue,
          suggested_next_action: gatewayOutcome.suggestedNextAction,
          handoff_state: outcome.handoff?.state ?? state.handoff?.state ?? 'idle',
        },
        evidence: { strategy: outcome.preflight ?? null },
        route: routeTrace,
        ...(routeTrace.error_code ? { error_code: routeTrace.error_code } : {}),
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
      const page = await getPage({ state });
      await syncState(page, state, { force: true });
      const route = getRouteForState({ url: page.url(), state });

      return buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: await page.title(),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: getGatewayContinuation(state, 'extract'),
        route,
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
      const page = await getPage({ state });
      const selection = selectEngine({ tool: 'extract', url: page.url() });
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });
      let projectedFastPath = null;

      if (selection.engine === 'runtime') {
        await syncState(page, state, { force: true });
        const fastPath = await readBossFastPath(page);
        if (fastPath) {
          projectedFastPath = buildPageProjection({
            ...selection,
            surface: fastPath.surface,
            title: fastPath.title,
            url: fastPath.url,
            mainText: fastPath.mainText,
            includeMarkdown: include_markdown,
          });
        }
      }

      const result = projectedFastPath ?? await (async () => {
        if (selection.engine !== 'runtime') {
          await syncState(page, state, { force: true });
        }
        const observed = await observeContent({
          page,
          deps: {
            waitStable: deps.waitUntilStable,
            extractContent: deps.extractMainContent,
          },
          include_markdown,
        });
        return buildPageProjection({
          ...selection,
          surface: 'content',
          title: await page.title(),
          url: page.url(),
          mainText: observed.main_text,
          markdown: observed.markdown,
          includeMarkdown: include_markdown,
        });
      })();

      return buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: projectedFastPath?.title ?? await page.title(),
          url: projectedFastPath?.url ?? page.url(),
          pageState: state.pageState,
        }, state),
        result: projectedFastPath ?? result,
        continuation: getGatewayContinuation(state, 'inspect'),
        route,
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
      const page = await getPage({ state });
      await syncState(page, state, { force: true });
      const outcome = await assessGatewayContinuation(page, state);
      const route = getRouteForState({ url: page.url(), state });

      return buildGatewayResponse({
        status: outcome.status,
        page: toGatewayPage({
          title: await page.title(),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: outcome.continuation,
        route,
      });
    }
  );

  server.registerTool(
    'explain_route',
    {
      description: 'Explain the latest route decision and why Grasp chose it.',
      inputSchema: {},
    },
    async () => {
      const route = state.lastRouteTrace ?? await readLatestRoute();

      if (!route) {
        return textResponse([
          'Route explanation unavailable.',
          'No route decision recorded yet.',
          'Call entry(url, intent) first.',
        ]);
      }

      const fallback = route.fallback_chain?.length
        ? route.fallback_chain.join(' -> ')
        : 'none';
      const triggers = route.evidence?.triggers?.length
        ? route.evidence.triggers.join(', ')
        : 'none';
      const alternatives = route.alternatives?.length
        ? route.alternatives.map((candidate) => `${candidate.mode} (${candidate.reason})`).join('; ')
        : 'none';

      return textResponse([
        'Route explanation',
        `Mode: ${route.selected_mode ?? 'unknown'}`,
        `Template: ${route.policy_template ?? 'unknown'}`,
        `Intent: ${route.intent ?? 'unknown'}`,
        `Status: ${route.status ?? 'unknown'}`,
        `Confidence: ${route.confidence ?? 'unknown'}`,
        `Risk: ${route.risk_level ?? 'unknown'}`,
        `Requires human: ${route.requires_human ? 'yes' : 'no'}`,
        `Next: ${route.next_step ?? 'unknown'}`,
        `Fallback: ${fallback}`,
        `Alternatives: ${alternatives}`,
        `Failure type: ${route.failure_type ?? 'none'}`,
        `Evidence: ${triggers}`,
      ], { route });
    }
  );
}
