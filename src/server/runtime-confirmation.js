import { errorResponse, textResponse } from './responses.js';

const INSTANCE_CONFIRMATION_ERROR = 'INSTANCE_CONFIRMATION_REQUIRED';

function buildInstanceKey(instance = {}) {
  return [
    instance?.display ?? 'unknown',
    instance?.browser ?? 'unknown',
    instance?.protocolVersion ?? 'unknown',
  ].join('|');
}

export function getRuntimeConfirmation(state) {
  return state?.runtimeConfirmation ?? null;
}

export function isRuntimeInstanceConfirmed(state, instance) {
  const confirmation = getRuntimeConfirmation(state);
  if (!confirmation || !instance) return false;
  return confirmation.instance_key === buildInstanceKey(instance);
}

export function storeRuntimeConfirmation(state, instance) {
  if (!state || !instance) {
    return null;
  }

  const confirmation = {
    instance_key: buildInstanceKey(instance),
    display: instance?.display ?? 'unknown',
    browser: instance?.browser ?? null,
    protocolVersion: instance?.protocolVersion ?? null,
    confirmed_at: Date.now(),
  };
  state.runtimeConfirmation = confirmation;
  return confirmation;
}

export function getRuntimeConfirmationSummary(state, instance) {
  const confirmation = getRuntimeConfirmation(state);
  if (!confirmation) {
    return { confirmed: false, reason: 'unconfirmed' };
  }
  if (!instance) {
    return { confirmed: false, reason: 'instance_unavailable', confirmation };
  }
  if (confirmation.instance_key !== buildInstanceKey(instance)) {
    return { confirmed: false, reason: 'instance_changed', confirmation };
  }
  return { confirmed: true, reason: 'confirmed', confirmation };
}

export function requireConfirmedRuntimeInstance(state, instance, tool) {
  if (!instance) {
    return null;
  }

  if (isRuntimeInstanceConfirmed(state, instance)) {
    return null;
  }

  const summary = getRuntimeConfirmationSummary(state, instance);
  const reasonText = summary.reason === 'instance_changed'
    ? 'The runtime instance changed after the last confirmation.'
    : 'The runtime instance has not been confirmed yet.';

  return errorResponse([
    'Runtime instance confirmation required.',
    `Tool: ${tool}`,
    ...(instance?.browser ? [`Current browser: ${instance.browser}`] : []),
    ...(instance?.display ? [`Current instance mode: ${instance.display}`] : []),
    reasonText,
    'Call confirm_runtime_instance first, then retry the action.',
  ], {
    error_code: INSTANCE_CONFIRMATION_ERROR,
    retryable: true,
    suggested_next_step: 'confirm_runtime_instance',
    instance,
    confirmation: summary,
  });
}

export function buildRuntimeConfirmationSuccessResponse(confirmation, instance) {
  return textResponse([
    `Runtime instance confirmed: ${confirmation.display}`,
    ...(instance?.browser ? [`Browser: ${instance.browser}`] : []),
  ], {
    confirmation,
    instance,
  });
}
