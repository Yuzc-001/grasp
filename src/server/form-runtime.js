function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return compactText(value).toLowerCase();
}

function buildUnresolved(reason, requestedField, matches = []) {
  return {
    reason,
    requested_field: compactText(requestedField),
    matches: matches.map((field) => ({
      label: field.label,
      hint_id: field.hint_id ?? null,
    })),
  };
}

function getSnapshotFields(snapshot) {
  return Array.isArray(snapshot?.fields) ? snapshot.fields : [];
}

function isTextLikeField(field) {
  const tag = normalizeText(field?.tag);
  const type = normalizeText(field?.type);

  if (tag === 'textarea' || type === 'textarea') return true;
  if (type === '') return tag === 'input';

  return !['checkbox', 'radio', 'select', 'date', 'datetime-local', 'month', 'week', 'time', 'file', 'submit', 'button'].includes(type);
}

function isSelectLikeField(field) {
  const tag = normalizeText(field?.tag);
  const type = normalizeText(field?.type);
  return tag === 'select' || ['select', 'checkbox', 'radio'].includes(type);
}

function isDateLikeField(field) {
  const type = normalizeText(field?.type);
  return ['date', 'datetime-local', 'month', 'week', 'time'].includes(type);
}

function isNeverSupportedField(field) {
  const tag = normalizeText(field?.tag);
  const type = normalizeText(field?.type);
  return tag === 'button' || ['file', 'submit', 'button', 'reset'].includes(type);
}

function buildVerification(fields, blockers) {
  const summary = fields.reduce((acc, field) => {
    if (field.current_state !== 'filled' && field.required) acc.missing_required += 1;
    if (field.current_state !== 'filled' && field.risk_level !== 'safe') acc.risky_pending += 1;
    if (field.current_state === 'unresolved') acc.unresolved += 1;
    return acc;
  }, { missing_required: 0, risky_pending: 0, unresolved: 0 });

  return {
    blockers,
    summary,
  };
}

function toUnresolvedFromError(requestedField, error, matches = []) {
  const reason = error?.message === 'unsupported_widget'
    ? 'unsupported_widget'
    : error?.message === 'no_live_target'
      ? 'no_live_target'
      : null;

  if (!reason) {
    throw error;
  }

  return {
    ok: false,
    field: null,
    unresolved: buildUnresolved(reason, requestedField, matches),
    snapshot: null,
  };
}

function normalizeWriterOutcome(requestedField, outcome, matches = [], field = null) {
  if (outcome && outcome.ok === false) {
    return {
      ok: false,
      field: null,
      unresolved: outcome.unresolved ?? buildUnresolved('no_live_target', requestedField, matches),
      snapshot: outcome.snapshot ?? null,
    };
  }

  return {
    ok: true,
    field,
    evidence: outcome?.evidence,
    snapshot: outcome?.snapshot ?? null,
  };
}

async function runWrite(runtime, requestedField, value, config) {
  const resolution = await resolveFieldTarget(runtime?.snapshot ?? runtime, requestedField);
  if (!resolution.field) {
    return {
      ok: false,
      field: null,
      unresolved: resolution.unresolved,
      snapshot: runtime?.snapshot ?? runtime,
    };
  }

  const field = resolution.field;
  if (!config.supports(field)) {
    return {
      ok: false,
      field,
      unresolved: buildUnresolved('unsupported_widget', requestedField, [field]),
      snapshot: runtime?.snapshot ?? runtime,
    };
  }

  let method = config.fallbackMethod;
  let outcome;
  try {
    if (field.hint_id && typeof config.executeHint === 'function') {
      outcome = await config.executeHint(field, value);
      method = config.hintMethod;
    } else if (typeof config.executeFallback === 'function') {
      outcome = await config.executeFallback(field, value);
    } else {
      return {
        ok: false,
        field,
        unresolved: buildUnresolved('no_live_target', requestedField, [field]),
        snapshot: runtime?.snapshot ?? runtime,
      };
    }
  } catch (error) {
    return toUnresolvedFromError(requestedField, error, [field]);
  }

  const normalizedOutcome = normalizeWriterOutcome(requestedField, outcome, [field], field);
  if (!normalizedOutcome.ok) {
    return {
      ok: false,
      field,
      unresolved: normalizedOutcome.unresolved,
      snapshot: normalizedOutcome.snapshot ?? runtime?.snapshot ?? runtime,
    };
  }

  const snapshot = typeof runtime?.refreshSnapshot === 'function'
    ? await runtime.refreshSnapshot()
    : runtime?.snapshot ?? runtime;

  return {
    ok: true,
    field,
    evidence: normalizedOutcome.evidence ?? createWriteEvidence({ field: field.label, method }),
    snapshot,
  };
}

export async function resolveFieldTarget(snapshot, requestedField) {
  const normalized = normalizeText(requestedField);
  const matches = getSnapshotFields(snapshot).filter((field) => (
    normalizeText(field?.normalized_label ?? field?.label) === normalized
  ));
  const supportedMatches = matches.filter((field) => !isNeverSupportedField(field));
  const hintBacked = supportedMatches.filter((field) => compactText(field?.hint_id));

  if (hintBacked.length === 1) {
    return { field: hintBacked[0], ambiguous: false, matches };
  }

  if (supportedMatches.length === 1) {
    return { field: supportedMatches[0], ambiguous: false, matches };
  }

  if (hintBacked.length > 1 || supportedMatches.length > 1) {
    return {
      field: null,
      ambiguous: true,
      matches,
      unresolved: buildUnresolved('ambiguous_label', requestedField, hintBacked.length > 0 ? hintBacked : supportedMatches),
    };
  }

  if (matches.length > 0) {
    return {
      field: null,
      ambiguous: false,
      matches,
      unresolved: buildUnresolved('unsupported_widget', requestedField, matches),
    };
  }

  return {
    field: null,
    ambiguous: false,
    matches: [],
    unresolved: buildUnresolved('no_live_target', requestedField),
  };
}

export function createWriteEvidence({ field, method }) {
  return {
    field,
    method,
    autosave_possible: true,
    write_side_effect: 'draft_mutation_possible',
  };
}

export async function fillSafeFields(runtime, values) {
  const written = [];
  const skipped = [];
  const unresolved = [];
  const evidence = [];
  let snapshot = runtime?.snapshot ?? runtime;
  const writer = runtime?.writeTextField;

  for (const [requestedField, value] of Object.entries(values ?? {})) {
    const resolution = await resolveFieldTarget(snapshot, requestedField);
    if (!resolution.field) {
      unresolved.push({
        field: requestedField,
        reason: resolution.unresolved.reason,
      });
      continue;
    }

    const field = resolution.field;
    if (field.risk_level !== 'safe') {
      skipped.push({
        field: field.label,
        reason: 'risk_not_safe',
        risk_level: field.risk_level,
      });
      continue;
    }

    if (!isTextLikeField(field)) {
      unresolved.push({
        field: field.label,
        reason: 'unsupported_widget',
      });
      continue;
    }

    if (typeof writer !== 'function') {
      unresolved.push({
        field: field.label,
        reason: 'no_live_target',
      });
      continue;
    }

    const outcome = await writer(field, value);
    if (outcome && outcome.ok === false) {
      unresolved.push({
        field: field.label,
        reason: outcome.unresolved?.reason ?? 'no_live_target',
      });
      continue;
    }
    written.push({ field: field.label, value });
    evidence.push(outcome?.evidence ?? createWriteEvidence({
      field: field.label,
      method: field.hint_id ? 'type_hint' : 'write_field',
    }));
    if (outcome?.snapshot) {
      snapshot = outcome.snapshot;
    }
  }

  return {
    written,
    skipped,
    unresolved,
    evidence,
    snapshot,
  };
}

async function applyReviewedWrite(runtime, requestedField, value, writer, method) {
  const snapshot = runtime?.snapshot ?? runtime;
  const resolution = await resolveFieldTarget(snapshot, requestedField);
  if (!resolution.field) {
    return {
      status: 'unresolved',
      unresolved: resolution.unresolved,
      snapshot,
    };
  }

  const field = resolution.field;
  if (field.risk_level === 'sensitive') {
    return {
      status: 'blocked',
      field: field.label,
      reason: 'risk_sensitive',
      snapshot,
    };
  }

  if (field.risk_level !== 'review') {
    return {
      status: 'blocked',
      field: field.label,
      reason: 'risk_not_review',
      snapshot,
    };
  }

  if (typeof writer !== 'function') {
    return {
      status: 'unresolved',
      field: field.label,
      unresolved: buildUnresolved('no_live_target', requestedField, [field]),
      snapshot,
    };
  }

  let outcome;
  try {
    outcome = await writer(field, value);
  } catch (error) {
    return toUnresolvedFromError(requestedField, error, [field]);
  }

  if (outcome && outcome.ok === false) {
    return {
      status: 'unresolved',
      field: field.label,
      unresolved: outcome.unresolved ?? buildUnresolved('no_live_target', requestedField, [field]),
      snapshot: outcome.snapshot ?? snapshot,
    };
  }

  return {
    status: 'written',
    field: field.label,
    value,
    evidence: outcome?.evidence ?? createWriteEvidence({ field: field.label, method }),
    snapshot: outcome?.snapshot ?? snapshot,
  };
}

export async function applyReviewedControl(runtime, requestedField, value) {
  return applyReviewedWrite(runtime, requestedField, value, runtime?.setControlValue, 'set_control_hint');
}

export async function applyReviewedDate(runtime, requestedField, value) {
  return applyReviewedWrite(runtime, requestedField, value, runtime?.setDateValue, 'set_date_hint');
}

export async function previewSubmit(runtime, snapshot, options = {}) {
  const mode = options.mode ?? 'preview';
  const fields = snapshot?.fields ?? [];
  const blockers = fields
    .filter((field) => field.current_state !== 'filled' && (field.required || field.risk_level !== 'safe' || field.current_state === 'unresolved'))
    .map((field) => ({
      field: field.label,
      reason: field.current_state === 'unresolved'
        ? 'unresolved'
        : field.required
          ? 'required_missing'
          : `risk_${field.risk_level}`,
    }));
  const verification = buildVerification(fields, blockers);
  const base = {
    autosave_possible: true,
    submit_controls: snapshot?.submit_controls ?? [],
    verification,
  };

  if (mode !== 'confirm') {
    return {
      mode: 'preview',
      blocked: blockers.length > 0,
      blockers,
      ...base,
    };
  }

  if (blockers.length > 0) {
    return {
      mode: 'confirm',
      blocked: true,
      blockers,
      ...base,
    };
  }

  if (options.confirmation !== 'SUBMIT') {
    return {
      mode: 'confirm',
      blocked: true,
      reason: 'confirmation_required',
      blockers: [],
      ...base,
    };
  }

  const control = snapshot?.submit_controls?.[0];
  if (!control || typeof runtime?.clickSubmit !== 'function') {
    return {
      mode: 'confirm',
      blocked: true,
      reason: 'no_submit_control',
      blockers: [],
      ...base,
    };
  }

  await runtime.clickSubmit(control);
  return {
    mode: 'confirm',
    blocked: false,
    submitted: true,
    blockers: [],
    ...base,
    evidence: {
      field: control.label,
      method: 'submit_click',
      autosave_possible: false,
      write_side_effect: 'submit_attempted',
    },
  };
}

export async function writeTextField(runtime, requestedField, value) {
  return runWrite(runtime, requestedField, value, {
    supports: isTextLikeField,
    executeHint: runtime?.typeByHintId,
    executeFallback: runtime?.writeByField,
    hintMethod: 'type_hint',
    fallbackMethod: 'write_field',
  });
}

export async function setControlValue(runtime, requestedField, value) {
  return runWrite(runtime, requestedField, value, {
    supports: isSelectLikeField,
    executeHint: runtime?.setControlByHintId,
    executeFallback: runtime?.setControlByField,
    hintMethod: 'set_control_hint',
    fallbackMethod: 'set_control_field',
  });
}

export async function setDateValue(runtime, requestedField, value) {
  return runWrite(runtime, requestedField, value, {
    supports: isDateLikeField,
    executeHint: runtime?.setDateByHintId,
    executeFallback: runtime?.setDateByField,
    hintMethod: 'set_date_hint',
    fallbackMethod: 'set_date_field',
  });
}
