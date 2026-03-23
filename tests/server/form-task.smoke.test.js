import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakePage } from '../helpers/fake-page.js';
import { assessGatewayContinuation } from '../../src/server/continuity.js';

function registerFormToolsWithSnapshot(snapshot, overrides = {}) {
  return async () => {
    const { registerFormTools } = await import('../../src/server/tools.form.js');
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
    const state = overrides.state ?? { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

    registerFormTools(server, state, {
      getActivePage: async () => createFakePage({
        url: () => overrides.url ?? 'https://example.com/form',
        title: () => overrides.title ?? '简历编辑',
      }),
      syncPageState: async () => undefined,
      collectVisibleFormSnapshot: async () => snapshot,
      ...(overrides.deps ?? {}),
    });

    return { calls, state };
  };
}

test('public form summary plus fill and preview', async () => {
  const snapshot = {
    sections: [{ name: '公开表单', field_labels: ['研究方向', '联系电话'] }],
    fields: [
      { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', current_state: 'missing', required: false, type: 'textarea' },
      { label: '联系电话', normalized_label: '联系电话', risk_level: 'sensitive', current_state: 'missing', required: true, type: 'text' },
    ],
    submit_controls: [{ label: '提交表单', risk_level: 'sensitive' }],
    ambiguous_labels: [],
    completion_status: 'review_required',
    verification: { blockers: [{ field: '联系电话', reason: 'required_missing' }], summary: { missing_required: 1, risky_pending: 1, unresolved: 0 } },
    summary: { total: 2, safe: 1, review: 0, sensitive: 1, labels: ['研究方向', '联系电话'] },
  };
  const { calls } = await registerFormToolsWithSnapshot(snapshot, {
    deps: {
      fillSafeFields: async () => ({
        written: [{ field: '研究方向', value: '深度学习' }],
        skipped: [{ field: '联系电话', reason: 'risk_not_safe', risk_level: 'sensitive' }],
        unresolved: [],
        evidence: [{ field: '研究方向', method: 'type_hint', autosave_possible: true, write_side_effect: 'draft_mutation_possible' }],
        snapshot: {
          ...snapshot,
          fields: [
            { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', current_state: 'filled', required: false, type: 'textarea' },
            snapshot.fields[1],
          ],
        },
      }),
      previewSubmit: async (_runtime, nextSnapshot, options) => ({
        mode: options.mode ?? 'preview',
        blocked: true,
        autosave_possible: true,
        verification: nextSnapshot.verification,
        blockers: nextSnapshot.verification.blockers,
        submit_controls: nextSnapshot.submit_controls,
      }),
    },
  })();

  const formInspect = calls.find((tool) => tool.name === 'form_inspect');
  const fillForm = calls.find((tool) => tool.name === 'fill_form');
  const safeSubmit = calls.find((tool) => tool.name === 'safe_submit');

  const inspect = await formInspect.handler({});
  const filled = await fillForm.handler({ values: { 研究方向: '深度学习', 联系电话: '110101...' } });
  const preview = await safeSubmit.handler({ mode: 'preview' });

  assert.equal(inspect.meta.result.task_kind, 'form');
  assert.equal(filled.meta.result.written.length, 1);
  assert.equal(filled.meta.result.skipped[0].reason, 'risk_not_safe');
  assert.equal(preview.meta.result.submit.mode, 'preview');
  assert.equal(preview.meta.result.submit.blocked, true);
});

test('authenticated recruitment form summary plus risky fields blocked', async () => {
  const snapshot = {
    sections: [{ name: '招聘表单', field_labels: ['期望工作城市', '证件号码'] }],
    fields: [
      { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
      { label: '证件号码', normalized_label: '证件号码', risk_level: 'sensitive', current_state: 'missing', required: true, type: 'text' },
    ],
    submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
    ambiguous_labels: [],
    completion_status: 'review_required',
    verification: { blockers: [{ field: '期望工作城市', reason: 'required_missing' }, { field: '证件号码', reason: 'required_missing' }], summary: { missing_required: 2, risky_pending: 2, unresolved: 0 } },
    summary: { total: 2, safe: 0, review: 1, sensitive: 1, labels: ['期望工作城市', '证件号码'] },
  };
  const { calls } = await registerFormToolsWithSnapshot(snapshot, {
    deps: {
      fillSafeFields: async () => ({
        written: [],
        skipped: [],
        unresolved: [],
        evidence: [],
        snapshot,
      }),
      applyReviewedControl: async (_runtime, requestedField) => {
        if (requestedField === '证件号码') {
          return { status: 'blocked', field: '证件号码', reason: 'risk_sensitive', snapshot };
        }
        return {
          status: 'written',
          field: requestedField,
          value: '深圳',
          evidence: { autosave_possible: true, write_side_effect: 'draft_mutation_possible' },
          snapshot,
        };
      },
    },
  })();

  const formInspect = calls.find((tool) => tool.name === 'form_inspect');
  const setOption = calls.find((tool) => tool.name === 'set_option');

  const inspect = await formInspect.handler({});
  const blocked = await setOption.handler({ field: '证件号码', value: '110101...' });

  assert.equal(inspect.meta.result.form.summary.total, 2);
  assert.equal(inspect.meta.result.form.fields[1].risk_level, 'sensitive');
  assert.equal(blocked.meta.result.operation.reason, 'risk_sensitive');
});

test('handoff-resume form path lands on form_inspect', async () => {
  const page = createFakePage({
    url: () => 'https://example.com/form',
    title: () => '恢复后的表单',
  });
  const state = {
    pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false },
    handoff: {
      state: 'resumed_verified',
      expected_url_contains: 'example.com',
      continuation_goal: 'resume form task',
    },
    hintMap: [],
  };

  const outcome = await assessGatewayContinuation(page, state);

  assert.equal(outcome.status, 'resumed');
  assert.equal(outcome.continuation.can_continue, true);
  assert.equal(outcome.continuation.suggested_next_action, 'form_inspect');
});
