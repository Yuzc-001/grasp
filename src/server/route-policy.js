function isBlockedHandoffState(handoffState) {
  return handoffState === 'handoff_required'
    || handoffState === 'handoff_in_progress'
    || handoffState === 'awaiting_reacquisition';
}

function buildEvidence({
  intent,
  selection,
  preflight,
  pageState,
  handoff,
  triggers,
}) {
  return {
    intent,
    engine: selection?.engine ?? 'runtime',
    session_trust: preflight?.session_trust ?? 'unknown',
    recommended_entry_strategy: preflight?.recommended_entry_strategy ?? 'direct',
    page_role: pageState?.currentRole ?? 'unknown',
    workspace_surface: pageState?.workspaceSurface ?? null,
    handoff_state: handoff?.state ?? 'idle',
    risk_gate_detected: pageState?.riskGateDetected ?? false,
    triggers,
  };
}

function inferIntentFromPageState(pageState = {}, lastIntent = null) {
  if (lastIntent) return lastIntent;

  const currentRole = pageState?.currentRole ?? 'unknown';
  if (currentRole === 'workspace' || pageState?.workspaceSurface != null) {
    return 'workspace';
  }
  if (currentRole === 'form' || currentRole === 'auth') {
    return 'submit';
  }
  return 'extract';
}

export function resolveRouteIntent({ intent = null, pageState = {}, lastIntent = null } = {}) {
  return inferIntentFromPageState(pageState, intent ?? lastIntent);
}

export function decideRoute({
  url,
  intent = 'extract',
  selection = {},
  preflight = {},
  pageState = {},
  handoff = {},
} = {}) {
  const handoffState = handoff?.state ?? 'idle';
  const currentRole = pageState?.currentRole ?? 'unknown';
  const workspaceLike = currentRole === 'workspace' || pageState?.workspaceSurface != null;
  const formLike = currentRole === 'form' || currentRole === 'auth';

  if (isBlockedHandoffState(handoffState) || pageState?.riskGateDetected || currentRole === 'checkpoint') {
    return {
      policy_template: 'gated_handoff',
      selected_mode: 'handoff',
      confidence: 'high',
      evidence: buildEvidence({
        intent,
        selection,
        preflight,
        pageState,
        handoff,
        triggers: ['gated_page_or_handoff_state'],
      }),
      alternatives: [],
      fallback_chain: [],
      requires_human: true,
      risk_level: 'high',
      next_step: 'request_handoff',
    };
  }

  if (intent === 'workspace' || workspaceLike) {
    return {
      policy_template: 'dynamic_workspace',
      selected_mode: 'workspace_runtime',
      confidence: intent === 'workspace' ? 'high' : 'medium',
      evidence: buildEvidence({
        intent,
        selection,
        preflight,
        pageState,
        handoff,
        triggers: [intent === 'workspace' ? 'workspace_intent' : 'workspace_surface'],
      }),
      alternatives: [
        { mode: 'handoff', reason: 'human_required_if_workspace_progress_blocks' },
      ],
      fallback_chain: ['handoff'],
      requires_human: false,
      risk_level: 'medium',
      next_step: 'workspace_inspect',
    };
  }

  if (intent === 'submit' || formLike) {
    return {
      policy_template: 'real_form',
      selected_mode: 'form_runtime',
      confidence: intent === 'submit' ? 'high' : 'medium',
      evidence: buildEvidence({
        intent,
        selection,
        preflight,
        pageState,
        handoff,
        triggers: [intent === 'submit' ? 'submit_intent' : 'form_surface'],
      }),
      alternatives: [
        { mode: 'handoff', reason: 'human_required_for_sensitive_or_blocked_form_steps' },
      ],
      fallback_chain: ['handoff'],
      requires_human: false,
      risk_level: 'high',
      next_step: 'form_inspect',
    };
  }

  if ((intent === 'read' || intent === 'extract' || intent === 'collect') && selection?.engine === 'data') {
    return {
      policy_template: 'public_content',
      selected_mode: 'public_read',
      confidence: 'high',
      evidence: buildEvidence({
        intent,
        selection,
        preflight,
        pageState,
        handoff,
        triggers: ['public_read_engine'],
      }),
      alternatives: [
        { mode: 'live_session', reason: 'browser_reuse_if_public_read_is_insufficient' },
      ],
      fallback_chain: ['live_session'],
      requires_human: false,
      risk_level: 'low',
      next_step: 'extract',
    };
  }

  return {
    policy_template: 'authenticated_content',
    selected_mode: 'live_session',
    confidence: preflight?.session_trust === 'high' ? 'high' : 'medium',
    evidence: buildEvidence({
      intent,
      selection,
      preflight,
      pageState,
      handoff,
      triggers: ['runtime_default'],
    }),
    alternatives: [
      { mode: 'handoff', reason: 'human_required_if_runtime_progress_blocks' },
    ],
    fallback_chain: ['handoff'],
    requires_human: false,
    risk_level: intent === 'act' ? 'medium' : 'low',
    next_step: 'inspect',
  };
}
