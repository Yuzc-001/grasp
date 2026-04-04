import { textResponse } from './responses.js';
import { buildAgentBoundary, buildAgentBoundaryLines } from './route-boundary.js';
import { buildAgentPrompt } from './prompt-assembly.js';

function normalizeLines(value) {
  return Array.isArray(value) ? value : [value];
}

function buildRuntimeGoal(boundaryKey) {
  if (boundaryKey === 'public_read') {
    return 'Read the current page on the active route and extract useful content.';
  }

  if (boundaryKey === 'live_session') {
    return 'Inspect the live session before switching into a specialized runtime surface.';
  }

  if (boundaryKey === 'session_warmup') {
    return 'Recover session trust before direct runtime actions.';
  }

  if (boundaryKey === 'form_runtime') {
    return 'Complete the current form through the guarded form surface.';
  }

  if (boundaryKey === 'workspace_runtime') {
    return 'Operate on the current workspace item through guarded runtime actions.';
  }

  if (boundaryKey === 'handoff') {
    return 'Pause direct action and recover the task through human handoff.';
  }

  return 'Stay on the current runtime path and gather the next piece of evidence.';
}

function buildRuntimeNextGap(boundaryKey, nextStep) {
  if (boundaryKey === 'public_read') {
    return nextStep === 'extract'
      ? 'Need fresh extraction evidence from the current readable page.'
      : 'Need fresh readable-page evidence before deeper actions.';
  }

  if (boundaryKey === 'live_session') {
    return 'Need fresh live-session inspection evidence before deeper actions.';
  }

  if (boundaryKey === 'session_warmup') {
    return 'Need stronger session-trust evidence before direct entry.';
  }

  if (boundaryKey === 'form_runtime') {
    return nextStep === 'safe_submit'
      ? 'Need final form verification before confirmed submit.'
      : 'Need refreshed form-state evidence before submit.';
  }

  if (boundaryKey === 'workspace_runtime') {
    return nextStep === 'execute_action'
      ? 'Need draft and preview evidence before execution.'
      : 'Need stable workspace-state evidence before guarded execution.';
  }

  if (boundaryKey === 'handoff') {
    return 'Need human recovery evidence before the runtime can continue.';
  }

  return 'Need a fresh runtime-state read before the next action.';
}

function buildRuntimeState({ agentBoundary, route, page, continuation, runtime }) {
  if (!agentBoundary) return null;

  return {
    goal: buildRuntimeGoal(agentBoundary.key),
    current_boundary: agentBoundary.key,
    redlines: [...agentBoundary.avoid],
    evidence_anchor: {
      route_mode: route?.selected_mode ?? agentBoundary.key,
      page_role: page?.page_role ?? null,
      url: page?.url ?? null,
      handoff_state: continuation?.handoff_state ?? null,
      instance_display: runtime?.instance?.display ?? null,
    },
    next_gap: buildRuntimeNextGap(
      agentBoundary.key,
      continuation?.suggested_next_action ?? agentBoundary.next_step ?? null
    ),
  };
}

export function buildGatewayResponse({
  status,
  page,
  result = {},
  continuation = {},
  evidence = {},
  runtime = {},
  route = null,
  error_code = null,
  message,
}) {
  const agentBoundary = buildAgentBoundary({
    status,
    page,
    result,
    continuation,
    route,
  });
  const agentPrompt = buildAgentPrompt({
    status,
    page,
    result,
    continuation,
    route,
    agentBoundary,
  });
  const boundaryLines = buildAgentBoundaryLines(agentBoundary);
  const runtimeState = buildRuntimeState({
    agentBoundary,
    route,
    page,
    continuation,
    runtime,
  });
  const lines = message
    ? [...normalizeLines(message), ...boundaryLines].filter(Boolean)
    : [
        `Status: ${status}`,
        `Page: ${page?.title ?? 'unknown'}`,
        `URL: ${page?.url ?? 'unknown'}`,
        runtime?.instance?.display ? `Instance: ${runtime.instance.display}` : null,
        runtime?.instance?.warning ? `Instance warning: ${runtime.instance.warning}` : null,
        route?.selected_mode ? `Route: ${route.selected_mode}` : null,
        ...boundaryLines,
        result.summary ? `Summary: ${result.summary}` : null,
        continuation.suggested_next_action ? `Next: ${continuation.suggested_next_action}` : null,
      ].filter(Boolean);

  return textResponse(lines, {
    status,
    page,
    result,
    continuation,
    evidence,
    runtime,
    ...(runtimeState ? { runtime_state: runtimeState } : {}),
    ...(agentBoundary ? { agent_boundary: agentBoundary } : {}),
    ...(agentPrompt ? { agent_prompt: agentPrompt } : {}),
    ...(error_code ? { error_code } : {}),
    ...(route ? { route } : {}),
  });
}
