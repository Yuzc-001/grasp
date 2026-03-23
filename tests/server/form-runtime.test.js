import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFieldTarget,
  createWriteEvidence,
  fillSafeFields,
  applyReviewedControl,
  applyReviewedDate,
  writeTextField,
  setControlValue,
  previewSubmit,
} from '../../src/server/form-runtime.js';

test('resolveFieldTarget matches normalized label and prefers hint-backed fields', async () => {
  const result = await resolveFieldTarget({
    fields: [
      { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe' },
      { label: '研究方向', normalized_label: '研究方向', hint_id: 'I12', risk_level: 'safe' },
    ],
  }, '研究方向');

  assert.equal(result.field.label, '研究方向');
  assert.equal(result.field.hint_id, 'I12');
  assert.equal(result.ambiguous, false);
});

test('resolveFieldTarget returns ambiguous_label when multiple live targets remain', async () => {
  const result = await resolveFieldTarget({
    fields: [
      { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe' },
      { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe' },
    ],
  }, '研究方向');

  assert.equal(result.field, null);
  assert.equal(result.unresolved.reason, 'ambiguous_label');
});

test('resolveFieldTarget returns no_live_target when nothing matches', async () => {
  const result = await resolveFieldTarget({ fields: [] }, '研究方向');

  assert.equal(result.field, null);
  assert.equal(result.unresolved.reason, 'no_live_target');
});

test('resolveFieldTarget returns unsupported_widget for matching unsupported controls', async () => {
  const result = await resolveFieldTarget({
    fields: [
      { label: '简历附件', normalized_label: '简历附件', tag: 'input', type: 'file' },
    ],
  }, '简历附件');

  assert.equal(result.field, null);
  assert.equal(result.unresolved.reason, 'unsupported_widget');
});

test('createWriteEvidence reports autosave and mutation evidence for real writes', () => {
  const evidence = createWriteEvidence({ field: '研究方向', method: 'type_hint' });

  assert.equal(evidence.autosave_possible, true);
  assert.equal(evidence.write_side_effect, 'draft_mutation_possible');
  assert.equal(evidence.field, '研究方向');
  assert.equal(evidence.method, 'type_hint');
});

test('fillSafeFields writes only safe text-like fields and returns side-effect evidence', async () => {
  const writes = [];
  const result = await fillSafeFields(
    {
      snapshot: {
        fields: [
          { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', type: 'textarea', hint_id: 'I12' },
          { label: '证件号码', normalized_label: '证件号码', risk_level: 'sensitive', type: 'text', hint_id: 'I13' },
        ],
      },
      writeTextField: async (field, value) => {
        writes.push({ field: field.label, value });
        return { evidence: { autosave_possible: true, write_side_effect: 'draft_mutation_possible' } };
      },
    },
    { 研究方向: '深度学习、推荐系统、多模态学习', 证件号码: '110101...' }
  );

  assert.deepEqual(writes, [{ field: '研究方向', value: '深度学习、推荐系统、多模态学习' }]);
  assert.equal(result.skipped[0].reason, 'risk_not_safe');
  assert.equal(result.evidence[0].autosave_possible, true);
});

test('fillSafeFields treats writer unresolved results as unresolved', async () => {
  const result = await fillSafeFields(
    {
      snapshot: {
        fields: [
          { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', type: 'textarea', hint_id: 'I12' },
        ],
      },
      writeTextField: async () => ({
        ok: false,
        unresolved: { reason: 'no_live_target' },
      }),
    },
    { 研究方向: '深度学习' }
  );

  assert.equal(result.written.length, 0);
  assert.equal(result.unresolved[0].reason, 'no_live_target');
  assert.equal(result.evidence.length, 0);
});

test('applyReviewedControl writes review controls, blocks sensitive controls, and reports ambiguity', async () => {
  const actions = [];
  const runtime = {
    snapshot: {
      fields: [
        { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', type: 'select', hint_id: 'S1' },
        { label: '证件号码', normalized_label: '证件号码', risk_level: 'sensitive', type: 'select', hint_id: 'S2' },
      ],
    },
    setControlValue: async (field, value) => {
      actions.push({ field: field.label, value });
      return { evidence: { autosave_possible: true, write_side_effect: 'draft_mutation_possible' } };
    },
  };

  const written = await applyReviewedControl(runtime, '期望工作城市', '深圳');
  const blocked = await applyReviewedControl(runtime, '证件号码', '110101...');
  const ambiguous = await applyReviewedControl({
    snapshot: {
      fields: [
        { label: '感兴趣的部门', normalized_label: '感兴趣的部门', risk_level: 'review', type: 'select' },
        { label: '感兴趣的部门', normalized_label: '感兴趣的部门', risk_level: 'review', type: 'select' },
      ],
    },
  }, '感兴趣的部门', '机器学习平台');

  assert.deepEqual(actions, [{ field: '期望工作城市', value: '深圳' }]);
  assert.equal(written.status, 'written');
  assert.equal(blocked.reason, 'risk_sensitive');
  assert.equal(ambiguous.status, 'unresolved');
});

test('applyReviewedControl does not mark a failed writer as written', async () => {
  const runtime = {
    snapshot: {
      fields: [
        { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', type: 'select', hint_id: 'S1' },
      ],
    },
    setControlValue: async () => ({
      ok: false,
      unresolved: { reason: 'unsupported_widget' },
    }),
  };

  const result = await applyReviewedControl(runtime, '期望工作城市', '深圳');

  assert.notEqual(result.status, 'written');
  assert.equal(result.unresolved.reason, 'unsupported_widget');
});

test('applyReviewedDate writes review date fields and preserves mutation evidence', async () => {
  const runtime = {
    snapshot: {
      fields: [
        { label: '最早可入职时间', normalized_label: '最早可入职时间', risk_level: 'review', type: 'date', hint_id: 'D1' },
      ],
    },
    setDateValue: async (field, value) => ({
      evidence: {
        autosave_possible: true,
        write_side_effect: 'draft_mutation_possible',
        field: field.label,
        value,
      },
    }),
  };

  const result = await applyReviewedDate(runtime, '最早可入职时间', '2026-06-15');

  assert.equal(result.status, 'written');
  assert.equal(result.evidence.autosave_possible, true);
});

test('writeTextField and setControlValue surface fallback no_live_target and unsupported_widget as unresolved', async () => {
  const textResult = await writeTextField(
    {
      snapshot: {
        fields: [
          { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', type: 'textarea' },
        ],
      },
      writeByField: async () => {
        throw new Error('no_live_target');
      },
    },
    '研究方向',
    '深度学习'
  );

  const optionResult = await setControlValue(
    {
      snapshot: {
        fields: [
          { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', type: 'select' },
        ],
      },
      setControlByField: async () => {
        throw new Error('unsupported_widget');
      },
    },
    '期望工作城市',
    '深圳'
  );

  assert.equal(textResult.ok, false);
  assert.equal(textResult.unresolved.reason, 'no_live_target');
  assert.equal(optionResult.ok, false);
  assert.equal(optionResult.unresolved.reason, 'unsupported_widget');
});

test('previewSubmit never clicks submit and returns verification summary with autosave evidence', async () => {
  const clicks = [];
  const result = await previewSubmit(
    {
      clickSubmit: async (control) => {
        clicks.push(control.label);
      },
    },
    {
      fields: [
        { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
        { label: '期望工作城市', required: true, current_state: 'missing', risk_level: 'review' },
      ],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
    },
    { mode: 'preview' }
  );

  assert.deepEqual(clicks, []);
  assert.equal(result.mode, 'preview');
  assert.equal(result.blocked, true);
  assert.equal(result.autosave_possible, true);
  assert.equal(result.submit_controls.length, 1);
  assert.equal(result.verification.blockers.length, 1);
  assert.equal(result.verification.summary.missing_required, 1);
});

test('previewSubmit only confirms submit when confirmation is SUBMIT', async () => {
  const clicks = [];
  const previewBlocked = await previewSubmit(
    {
      clickSubmit: async (control) => {
        clicks.push(control.label);
      },
    },
    {
      fields: [
        { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
        { label: '期望工作城市', required: true, current_state: 'filled', risk_level: 'review' },
      ],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
    },
    { mode: 'confirm', confirmation: 'CONFIRM_SUBMIT' }
  );

  const confirmed = await previewSubmit(
    {
      clickSubmit: async (control) => {
        clicks.push(control.label);
      },
    },
    {
      fields: [
        { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
        { label: '期望工作城市', required: true, current_state: 'filled', risk_level: 'review' },
      ],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
    },
    { mode: 'confirm', confirmation: 'SUBMIT' }
  );

  assert.equal(previewBlocked.blocked, true);
  assert.equal(previewBlocked.reason, 'confirmation_required');
  assert.deepEqual(clicks, ['提交简历']);
  assert.equal(confirmed.blocked, false);
  assert.equal(confirmed.autosave_possible, true);
  assert.equal(confirmed.verification.blockers.length, 0);
});
