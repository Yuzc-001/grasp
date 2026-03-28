import { z } from 'zod';

import { getActivePage } from '../layer1-bridge/chrome.js';
import { typeByHintId } from '../layer3-action/actions.js';
import { buildGatewayResponse } from './gateway-response.js';
import { syncPageState } from './state.js';
import { collectVisibleFormSnapshot } from './form-tasks.js';
import {
  fillSafeFields,
  writeTextField as writeTextFieldBridge,
  setControlValue as setControlValueBridge,
  setDateValue as setDateValueBridge,
  applyReviewedControl,
  applyReviewedDate,
  previewSubmit,
} from './form-runtime.js';

function toGatewayPage(page, state) {
  return {
    title: page.title,
    url: page.url,
    page_role: state.pageState?.currentRole ?? 'unknown',
    grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
    risk_gate: state.pageState?.riskGateDetected ?? false,
  };
}

function getFormStatus(state) {
  const handoffState = state.handoff?.state ?? 'idle';
  if (handoffState === 'handoff_required' || handoffState === 'handoff_in_progress' || handoffState === 'awaiting_reacquisition') {
    return 'handoff_required';
  }
  return state.pageState?.riskGateDetected ? 'gated' : 'direct';
}

function getFormContinuation(state) {
  const handoffState = state.handoff?.state ?? 'idle';
  const status = getFormStatus(state);
  if (status !== 'direct') {
    return {
      can_continue: false,
      suggested_next_action: 'request_handoff',
      handoff_state: handoffState,
    };
  }

  return {
    can_continue: true,
    suggested_next_action: 'verify_form',
    handoff_state: handoffState,
  };
}

function isTextLikeField(field) {
  const type = String(field?.type ?? '').toLowerCase();
  return type === 'textarea' || !['checkbox', 'radio', 'select', 'date', 'datetime-local', 'month', 'week', 'time', 'file', 'submit', 'button'].includes(type);
}

function isDateLikeField(field) {
  const type = String(field?.type ?? '').toLowerCase();
  return ['date', 'datetime-local', 'month', 'week', 'time'].includes(type);
}

function isEditableField(field) {
  return field?.disabled !== true && field?.readOnly !== true && field?.readonly !== true;
}

function getNextVerifyAction(snapshot) {
  const fields = Array.isArray(snapshot?.fields) ? snapshot.fields : [];
  if (fields.some((field) => field.risk_level === 'safe' && field.current_state !== 'filled' && isTextLikeField(field) && isEditableField(field))) {
    return 'fill_form';
  }
  if (fields.some((field) => field.risk_level === 'review' && field.current_state !== 'filled' && isDateLikeField(field) && isEditableField(field))) {
    return 'set_date';
  }
  if (fields.some((field) => field.risk_level === 'review' && field.current_state !== 'filled' && !isDateLikeField(field) && isEditableField(field))) {
    return 'set_option';
  }
  return 'safe_submit';
}

function createRebuildHints(page, state, syncState) {
  return async () => {
    await syncState(page, state, { force: true });
    return null;
  };
}

async function setControlByField(page, field, value) {
  const result = await page.evaluate(({ hintId, id, name, value: nextValue }) => {
    const target = (
      (hintId && document.querySelector(`[data-grasp-id="${hintId}"]`))
      || (id && document.getElementById(id))
      || (name && document.querySelector(`[name="${name}"]`))
    );
    if (!target) return { ok: false, reason: 'no_live_target' };
    if (target.tagName.toLowerCase() !== 'select') return { ok: false, reason: 'unsupported_widget' };
    if (target.disabled || target.readOnly) return { ok: false, reason: 'field_not_editable' };

    const option = [...target.options].find((item) => item.value === nextValue || item.textContent?.trim() === nextValue);
    if (!option) return { ok: false, reason: 'unsupported_widget' };
    if (target.value === option.value) return { ok: false, reason: 'no_effect' };

    target.value = option.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }, {
    hintId: field.hint_id ?? null,
    id: field.id ?? null,
    name: field.name ?? null,
    value,
  });

  if (!result.ok) {
    throw new Error(result.reason);
  }
}

async function setDateByField(page, field, value) {
  const result = await page.evaluate(({ hintId, id, name, value: nextValue }) => {
    const target = (
      (hintId && document.querySelector(`[data-grasp-id="${hintId}"]`))
      || (id && document.getElementById(id))
      || (name && document.querySelector(`[name="${name}"]`))
    );
    if (!target) return { ok: false, reason: 'no_live_target' };
    const type = target.getAttribute('type') || '';
    if (!['date', 'datetime-local', 'month', 'week', 'time'].includes(type)) {
      return { ok: false, reason: 'unsupported_widget' };
    }
    if (target.disabled || target.readOnly) return { ok: false, reason: 'field_not_editable' };
    if (target.value === nextValue) return { ok: false, reason: 'no_effect' };

    target.value = nextValue;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return target.value === nextValue
      ? { ok: true }
      : { ok: false, reason: 'no_effect' };
  }, {
    hintId: field.hint_id ?? null,
    id: field.id ?? null,
    name: field.name ?? null,
    value,
  });

  if (!result.ok) {
    throw new Error(result.reason);
  }
}

async function clickSubmitControl(page, control) {
  const result = await page.evaluate(({ hintId, label }) => {
    const target = (
      (hintId && document.querySelector(`[data-grasp-id="${hintId}"]`))
      || [...document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"]')]
        .find((item) => {
          const text = (item.getAttribute('aria-label') || item.textContent || item.getAttribute('value') || '').trim();
          return text === label;
        })
    );

    if (!target) return { ok: false };
    target.click();
    return { ok: true };
  }, {
    hintId: control?.hint_id ?? null,
    label: control?.label ?? '',
  });

  if (!result.ok) {
    throw new Error('no_submit_control');
  }
}

export function registerFormTools(server, state, deps = {}) {
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const collectSnapshot = deps.collectVisibleFormSnapshot ?? collectVisibleFormSnapshot;
  const fillFields = deps.fillSafeFields ?? fillSafeFields;
  const typeField = deps.typeByHintId ?? typeByHintId;
  const applyControl = deps.applyReviewedControl ?? applyReviewedControl;
  const applyDate = deps.applyReviewedDate ?? applyReviewedDate;
  const previewSubmission = deps.previewSubmit ?? previewSubmit;

  server.registerTool(
    'form_inspect',
    {
      description: 'Inspect the visible form, its fields, and current completion state.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const snapshot = await collectSnapshot(page);
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          form: {
            completion_status: snapshot.completion_status,
            sections: snapshot.sections,
            fields: snapshot.fields,
            submit_controls: snapshot.submit_controls,
            summary: snapshot.summary,
          },
        },
        continuation: getFormContinuation(state),
        evidence: {
          ambiguous_labels: snapshot.ambiguous_labels,
          autosave_possible: true,
        },
      });
    }
  );

  server.registerTool(
    'fill_form',
    {
      description: 'Fill safe text-like fields on the current form and return refreshed form state.',
      inputSchema: {
        values: z.record(z.string(), z.string()).describe('Map of field labels to desired values'),
      },
    },
    async ({ values }) => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const rebuildHints = createRebuildHints(page, state, syncState);
      const snapshot = await collectSnapshot(page);
      const operation = await fillFields(
        {
          snapshot,
          writeTextField: async (field, value) => writeTextFieldBridge({
            snapshot,
            typeByHintId: async (resolvedField, text) => typeField(page, resolvedField.hint_id, text, false, { rebuildHints }),
            refreshSnapshot: async () => {
              await syncState(page, state, { force: true });
              return collectSnapshot(page);
            },
          }, field.label, value),
        },
        values,
      );
      const refreshed = operation.snapshot ?? snapshot;
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          written: operation.written,
          skipped: operation.skipped,
          unresolved: operation.unresolved,
          write_evidence: operation.evidence,
          operation: {
            written: operation.written,
            skipped: operation.skipped,
            unresolved: operation.unresolved,
          },
          form: {
            completion_status: refreshed.completion_status,
            sections: refreshed.sections,
            fields: refreshed.fields,
            submit_controls: refreshed.submit_controls,
            summary: refreshed.summary,
          },
        },
        continuation: {
          ...getFormContinuation(state),
          suggested_next_action: 'verify_form',
        },
        evidence: {
          ambiguous_labels: refreshed.ambiguous_labels ?? [],
          writes: operation.evidence,
          autosave_possible: operation.evidence.some((item) => item.autosave_possible),
        },
      });
    }
  );

  server.registerTool(
    'set_option',
    {
      description: 'Set a review-tier option field on the current form.',
      inputSchema: {
        field: z.string().describe('Field label to update'),
        value: z.string().describe('Desired option label or value'),
      },
    },
    async ({ field, value }) => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const snapshot = await collectSnapshot(page);
      const operation = await applyControl({
        snapshot,
        setControlValue: async (resolvedField, nextValue) => setControlValueBridge({
          snapshot,
          setControlByField: async (fallbackField, fallbackValue) => setControlByField(page, fallbackField, fallbackValue),
          refreshSnapshot: async () => {
            await syncState(page, state, { force: true });
            return collectSnapshot(page);
          },
        }, resolvedField.label, nextValue),
      }, field, value);
      const refreshed = operation.snapshot ?? snapshot;
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          operation,
          form: {
            completion_status: refreshed.completion_status,
            sections: refreshed.sections,
            fields: refreshed.fields,
            submit_controls: refreshed.submit_controls,
            summary: refreshed.summary,
          },
        },
        continuation: {
          ...getFormContinuation(state),
          suggested_next_action: 'verify_form',
        },
        evidence: {
          ambiguous_labels: refreshed.ambiguous_labels ?? [],
          write: operation.evidence ?? null,
        },
      });
    }
  );

  server.registerTool(
    'set_date',
    {
      description: 'Set a review-tier date field on the current form.',
      inputSchema: {
        field: z.string().describe('Field label to update'),
        value: z.string().describe('Desired ISO-like date value'),
      },
    },
    async ({ field, value }) => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const snapshot = await collectSnapshot(page);
      const operation = await applyDate({
        snapshot,
        setDateValue: async (resolvedField, nextValue) => setDateValueBridge({
          snapshot,
          setDateByField: async (fallbackField, fallbackValue) => setDateByField(page, fallbackField, fallbackValue),
          refreshSnapshot: async () => {
            await syncState(page, state, { force: true });
            return collectSnapshot(page);
          },
        }, resolvedField.label, nextValue),
      }, field, value);
      const refreshed = operation.snapshot ?? snapshot;
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          operation,
          form: {
            completion_status: refreshed.completion_status,
            sections: refreshed.sections,
            fields: refreshed.fields,
            submit_controls: refreshed.submit_controls,
            summary: refreshed.summary,
          },
        },
        continuation: {
          ...getFormContinuation(state),
          suggested_next_action: 'verify_form',
        },
        evidence: {
          ambiguous_labels: refreshed.ambiguous_labels ?? [],
          write: operation.evidence ?? null,
        },
      });
    }
  );

  server.registerTool(
    'verify_form',
    {
      description: 'Re-read the visible form and report missing, risky, and unresolved fields.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const snapshot = await collectSnapshot(page);
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          form: {
            completion_status: snapshot.completion_status,
            verification: snapshot.verification,
            sections: snapshot.sections,
            fields: snapshot.fields,
            submit_controls: snapshot.submit_controls,
            summary: snapshot.summary,
          },
        },
        continuation: {
          ...getFormContinuation(state),
          suggested_next_action: getNextVerifyAction(snapshot),
        },
        evidence: {
          ambiguous_labels: snapshot.ambiguous_labels ?? [],
          autosave_possible: true,
        },
      });
    }
  );

  server.registerTool(
    'safe_submit',
    {
      description: 'Preview or confirm form submission with blocker reporting.',
      inputSchema: {
        mode: z.enum(['preview', 'confirm']).default('preview'),
        confirmation: z.string().optional(),
      },
    },
    async ({ mode = 'preview', confirmation } = {}) => {
      const page = await getPage();
      await syncState(page, state, { force: true });
      const snapshot = await collectSnapshot(page);
      const submit = await previewSubmission({
        clickSubmit: async (control) => clickSubmitControl(page, control),
      }, snapshot, { mode, confirmation });
      const pageInfo = {
        title: await page.title(),
        url: page.url(),
      };

      return buildGatewayResponse({
        status: getFormStatus(state),
        page: toGatewayPage(pageInfo, state),
        result: {
          task_kind: 'form',
          submit,
          form: {
            completion_status: snapshot.completion_status,
            sections: snapshot.sections,
            fields: snapshot.fields,
            submit_controls: snapshot.submit_controls,
            summary: snapshot.summary,
          },
        },
        continuation: {
          ...getFormContinuation(state),
          suggested_next_action: submit.blocked ? getNextVerifyAction(snapshot) : 'form_inspect',
        },
        evidence: {
          ambiguous_labels: snapshot.ambiguous_labels ?? [],
          submit: submit.evidence ?? null,
        },
      });
    }
  );
}
