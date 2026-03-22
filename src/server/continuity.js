export function buildCheckpointHandoffSuggestion(pageState = {}, pageUrl = '') {
  const checkpointKind = pageState.checkpointKind ?? 'unknown';
  const role = pageState.currentRole ?? 'unknown';
  const reason = checkpointKind === 'waiting_room'
    ? 'checkpoint_waiting_room'
    : checkpointKind === 'challenge'
      ? 'checkpoint_challenge'
      : checkpointKind === 'verification'
        ? 'checkpoint_verification'
        : 'checkpoint_required';

  const note = `Checkpoint detected (${checkpointKind}) at ${pageUrl || 'current page'}; human presence may be required before continuation can resume.`;

  return {
    reason,
    note,
    expected_url_contains: (() => {
      try {
        const url = new URL(pageUrl);
        return url.hostname;
      } catch {
        return null;
      }
    })(),
    expected_page_role: role === 'checkpoint' ? null : role,
    expected_selector: null,
    continuation_goal: 'resume after checkpoint clearance',
    expected_hint_label: null,
    checkpoint_kind: checkpointKind,
    checkpoint_signals: pageState.checkpointSignals ?? [],
    suggested_next_action: pageState.suggestedNextAction ?? 'handoff_required',
  };
}

export function buildSessionTrustPreflight(targetUrl, pageState = {}, handoff = {}) {
  let hostname = null;
  let currentHostname = null;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {}
  try {
    currentHostname = pageState?.lastUrl ? new URL(pageState.lastUrl).hostname.toLowerCase() : null;
  } catch {}

  const sameTargetContext = !!(hostname && currentHostname && hostname === currentHostname);

  const highRiskHost = hostname && (
    hostname.includes('chatgpt.com') ||
    hostname.includes('openai.com') ||
    hostname.includes('github.com')
  );

  const checkpointActive = sameTargetContext && (pageState.currentRole === 'checkpoint' || pageState.riskGateDetected === true);
  const priorHandoffForSameHost = !!(handoff.expected_url_contains && hostname && handoff.expected_url_contains.includes(hostname));

  let sessionTrust = 'medium';
  let recommendedEntryStrategy = 'direct';
  const trustSignals = [];

  if (highRiskHost) trustSignals.push('high_risk_host');
  if (priorHandoffForSameHost) trustSignals.push('prior_handoff_context_for_host');
  if (sameTargetContext) {
    trustSignals.push('same_target_context');
  }
  if (checkpointActive) trustSignals.push('active_checkpoint_detected');

  if (highRiskHost && checkpointActive) {
    sessionTrust = 'low';
    recommendedEntryStrategy = 'handoff_or_preheat';
  } else if (highRiskHost && priorHandoffForSameHost) {
    sessionTrust = 'medium';
    recommendedEntryStrategy = 'resume_existing_session';
  } else if (highRiskHost) {
    sessionTrust = 'low';
    recommendedEntryStrategy = 'preheat_before_direct_entry';
  }

  return {
    target_url: targetUrl,
    hostname,
    current_hostname: currentHostname,
    same_target_context: sameTargetContext,
    session_trust: sessionTrust,
    recommended_entry_strategy: recommendedEntryStrategy,
    trust_signals: trustSignals,
    checkpoint_active: checkpointActive,
  };
}

export async function assessResumeContinuation(page, state, anchors = {}) {
  const {
    expected_url_contains = null,
    expected_page_role = null,
    expected_selector = null,
    continuation_goal = null,
    expected_hint_label = null,
  } = anchors;

  const checks = [];
  const currentUrl = page?.url?.() ?? '';
  const currentRole = state?.pageState?.currentRole ?? 'unknown';

  if (expected_url_contains) {
    checks.push({ kind: 'url_contains', expected: expected_url_contains, ok: currentUrl.includes(expected_url_contains), actual: currentUrl });
  }

  if (expected_page_role) {
    checks.push({ kind: 'page_role', expected: expected_page_role, ok: currentRole === expected_page_role, actual: currentRole });
  }

  if (expected_selector) {
    let found = false;
    try {
      found = await page.evaluate((selector) => Boolean(document.querySelector(selector)), expected_selector);
    } catch {}
    checks.push({ kind: 'selector_present', expected: expected_selector, ok: found, actual: found });
  }

  if (expected_hint_label) {
    const hintMatch = (state?.hintMap ?? []).find((hint) =>
      String(hint?.label ?? '').toLowerCase().includes(String(expected_hint_label).toLowerCase())
    );
    checks.push({ kind: 'hint_label_present', expected: expected_hint_label, ok: Boolean(hintMatch), actual: hintMatch?.label ?? null });
  }

  const requiredChecks = checks.length;
  const passedChecks = checks.filter((check) => check.ok).length;
  const taskContinuationOk = requiredChecks === 0 ? null : passedChecks === requiredChecks;
  const continuationReady = taskContinuationOk === true && (!expected_hint_label || checks.some((check) => check.kind === 'hint_label_present' && check.ok));
  const suggestedNextAction = continuationReady
    ? expected_hint_label
      ? `use_hint_matching:${expected_hint_label}`
      : continuation_goal
        ? `continue_goal:${continuation_goal}`
        : 'continue_task'
    : taskContinuationOk === false
      ? 'do_not_continue'
      : 'needs_confirmation';

  return {
    required_checks: requiredChecks,
    passed_checks: passedChecks,
    task_continuation_ok: taskContinuationOk,
    continuation_ready: continuationReady,
    continuation_goal,
    suggested_next_action: suggestedNextAction,
    checks,
  };
}

export async function assessGatewayContinuation(page, state) {
  const handoffState = state?.handoff?.state ?? 'idle';
  const pageState = state?.pageState ?? {};
  const gatedByPage = pageState.currentRole === 'checkpoint' || pageState.riskGateDetected === true;
  const anchors = {
    expected_url_contains: state?.handoff?.expected_url_contains ?? null,
    expected_page_role: state?.handoff?.expected_page_role ?? null,
    expected_selector: state?.handoff?.expected_selector ?? null,
    continuation_goal: state?.handoff?.continuation_goal ?? null,
    expected_hint_label: state?.handoff?.expected_hint_label ?? null,
  };

  if (handoffState === 'handoff_required' || handoffState === 'handoff_in_progress' || handoffState === 'awaiting_reacquisition') {
    return {
      status: 'handoff_required',
      continuation: {
        can_continue: false,
        suggested_next_action: 'request_handoff',
        handoff_state: handoffState,
      },
    };
  }

  if (gatedByPage) {
    return {
      status: 'gated',
      continuation: {
        can_continue: false,
        suggested_next_action: 'request_handoff',
        handoff_state: handoffState,
      },
    };
  }

  const continuation = await assessResumeContinuation(page, state, anchors);

  if (handoffState === 'resumed_verified' || handoffState === 'resumed_unverified') {
    if (continuation.task_continuation_ok === false) {
      return {
        status: 'failed',
        continuation: {
          ...continuation,
          can_continue: false,
          handoff_state: handoffState,
        },
      };
    }

    if (continuation.continuation_ready) {
      return {
        status: 'resumed',
        continuation: {
          ...continuation,
          can_continue: true,
          handoff_state: handoffState,
        },
      };
    }

    return {
      status: 'failed',
      continuation: {
        ...continuation,
        can_continue: false,
        handoff_state: handoffState,
      },
    };
  }

  if (continuation.task_continuation_ok === false) {
    return {
      status: 'failed',
      continuation: {
        ...continuation,
        can_continue: false,
        handoff_state: handoffState,
      },
    };
  }

  return {
    status: 'direct',
    continuation: {
      ...continuation,
      can_continue: true,
      handoff_state: handoffState,
    },
  };
}
