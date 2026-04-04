import { buildPageProjection } from './page-projection.js';
import { resolveRouteIntent, decideRoute } from './route-policy.js';
import { selectEngine } from './engine-selection.js';
import { readStablePageTitle } from '../layer1-bridge/chrome.js';
import { getActiveTaskFrame } from './state.js';
import { rememberTaskResult } from './task-frame.js';

export function toGatewayPage({ title, url, final_url, pageState }, state, { preferCurrentUrl = false } = {}) {
  const resolvedUrl = final_url ?? url ?? null;
  const pageUrl = preferCurrentUrl
    ? state.lastUrl ?? resolvedUrl ?? 'unknown'
    : resolvedUrl ?? state.lastUrl ?? 'unknown';

  return {
    title: title ?? 'unknown',
    url: pageUrl,
    page_role: pageState?.currentRole ?? state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: pageState?.graspConfidence ?? state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: pageState?.riskGateDetected ?? state.pageState?.riskGateDetected ?? false,
  };
}

export function isBlockedHandoffState(handoffState) {
  return handoffState === 'handoff_required'
    || handoffState === 'handoff_in_progress'
    || handoffState === 'awaiting_reacquisition';
}

export function isGatedPageState(pageState = {}) {
  return pageState.riskGateDetected || pageState.currentRole === 'checkpoint';
}

export function getEntryDirectNextAction(pageState = {}) {
  if (pageState.currentRole === 'workspace' || (pageState.workspaceSurface != null && pageState.currentRole !== 'navigation-heavy')) {
    return 'workspace_inspect';
  }
  if (pageState.currentRole === 'form' || pageState.currentRole === 'auth') {
    return 'form_inspect';
  }
  return 'extract';
}

export function resolvedDirectEntry(outcome = {}) {
  return outcome.verified === true && !isGatedPageState(outcome.pageState ?? {});
}

export function getEffectiveEntryHandoff(outcome = {}) {
  if (resolvedDirectEntry(outcome)) {
    return {
      ...(outcome.handoff ?? {}),
      state: 'idle',
    };
  }

  return outcome.handoff ?? null;
}

export function getGatewayStatus(state) {
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

export function getGatewayContinuation(state, suggestedNextAction) {
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

export function buildGatewayOutcome(outcome) {
  const strategy = outcome.preflight?.recommended_entry_strategy ?? 'direct';
  const trust = outcome.preflight?.session_trust ?? 'medium';
  const handoffState = outcome.handoff?.state ?? 'idle';
  const pageState = outcome.pageState ?? {};

  if (resolvedDirectEntry(outcome)) {
    return {
      status: 'direct',
      canContinue: true,
      suggestedNextAction: getEntryDirectNextAction(pageState),
    };
  }

  if (isBlockedHandoffState(handoffState) || isGatedPageState(pageState)) {
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

export function getRouteForState({ url, state, intent = null }) {
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

export async function projectPageContent({
  page,
  state,
  selection,
  include_markdown = false,
  deps = {},
} = {}) {
  const {
    syncState,
    observeContent,
    readFastPathContent,
    waitUntilStable,
    extractMainContent,
  } = deps;

  if (selection.engine === 'runtime') {
    await syncState(page, state, { force: true });
    const fastPath = await readFastPathContent(page);
    if (fastPath) {
      return buildPageProjection({
        ...selection,
        surface: fastPath.surface,
        title: fastPath.title,
        url: fastPath.url,
        mainText: fastPath.mainText,
        includeMarkdown: include_markdown,
      });
    }
  } else {
    await syncState(page, state, { force: true });
  }

  const observed = await observeContent({
    page,
    deps: {
      waitStable: waitUntilStable,
      extractContent: extractMainContent,
    },
    include_markdown,
  });

  return buildPageProjection({
    ...selection,
    surface: 'content',
    title: await readStablePageTitle(page),
    url: page.url(),
    mainText: observed.main_text,
    markdown: observed.markdown,
    includeMarkdown: include_markdown,
  });
}

export function getBatchStatus(records = []) {
  if (records.length === 0) return 'direct';
  const directCount = records.filter((record) => record.status === 'direct').length;
  if (directCount === records.length) return 'direct';
  if (directCount > 0) return 'mixed';
  return 'handoff_required';
}

export function rememberGatewayTask(state, {
  tool,
  status,
  summary = null,
  route = null,
  page = null,
  artifacts = null,
} = {}) {
  const frame = getActiveTaskFrame(state);
  if (!frame) return;
  rememberTaskResult(frame, {
    tool,
    status,
    summary,
    route,
    page,
    artifacts,
  });
}
