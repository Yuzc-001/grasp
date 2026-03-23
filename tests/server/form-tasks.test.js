import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFieldLabel,
  normalizeFormField,
  summarizeFormFields,
  buildFormVerification,
  finalizeFormSnapshot,
} from '../../src/server/form-tasks.js';

test('getFieldLabel prefers aria-labelledby, then aria-label, label[for], placeholder, name, and tag', () => {
  assert.equal(getFieldLabel({
    ariaLabelledByText: '学校名称',
    ariaLabel: '学校名',
    labelForText: '院校',
    placeholder: '请输入学校名称',
    name: 'schoolName',
    tag: 'input',
  }), '学校名称');

  assert.equal(getFieldLabel({
    ariaLabel: '',
    labelForText: '',
    placeholder: '请输入学校名称',
    name: 'schoolName',
    tag: 'input',
  }), '请输入学校名称');

  assert.equal(getFieldLabel({
    ariaLabel: '',
    labelForText: '',
    placeholder: '',
    name: 'schoolName',
    tag: 'input',
  }), 'schoolName');

  assert.equal(getFieldLabel({
    ariaLabel: '',
    labelForText: '院校',
    placeholder: '',
    name: '',
    tag: 'input',
  }), '院校');

  assert.equal(getFieldLabel({
    ariaLabel: '',
    labelForText: '',
    placeholder: '',
    name: '',
    tag: 'textarea',
  }), 'textarea');
});

test('normalizeFormField classifies safe, review, and sensitive fields', () => {
  const safe = normalizeFormField({ label: '研究方向', tag: 'textarea', type: 'textarea', required: false, value: '' });
  const review = normalizeFormField({ label: '期望工作城市', tag: 'input', type: 'select', required: true, value: '' });
  const sensitive = normalizeFormField({ label: '证件号码', tag: 'input', type: 'text', required: true, value: '' });

  assert.equal(safe.risk_level, 'safe');
  assert.equal(review.risk_level, 'review');
  assert.equal(sensitive.risk_level, 'sensitive');
});

test('summarizeFormFields returns a basic count summary', () => {
  const summary = summarizeFormFields([
    { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
    { label: '期望工作城市', required: true, current_state: 'missing', risk_level: 'review' },
    { label: '证件号码', required: true, current_state: 'missing', risk_level: 'sensitive' },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.safe, 1);
  assert.equal(summary.review, 1);
  assert.equal(summary.sensitive, 1);
  assert.deepEqual(summary.labels, ['研究方向', '期望工作城市', '证件号码']);
});

test('buildFormVerification reports missing required, risky pending, and unresolved fields', () => {
  const result = buildFormVerification([
    { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
    { label: '期望工作城市', required: true, current_state: 'missing', risk_level: 'review' },
    { label: '证件号码', required: true, current_state: 'missing', risk_level: 'sensitive' },
    { label: '感兴趣的部门', required: true, current_state: 'unresolved', risk_level: 'review' },
  ]);

  assert.equal(result.completion_status, 'review_required');
  assert.equal(result.summary.missing_required, 3);
  assert.equal(result.summary.risky_pending, 3);
  assert.equal(result.summary.unresolved, 1);
});

test('normalizeFormField keeps unchecked checkbox and radio fields missing', () => {
  const checkbox = normalizeFormField({
    label: '是否接受调配',
    tag: 'input',
    type: 'checkbox',
    required: true,
    checked: false,
  });
  const verification = buildFormVerification([
    { label: '研究方向', required: false, current_state: 'filled', risk_level: 'safe' },
    checkbox,
  ]);

  assert.equal(checkbox.current_state, 'missing');
  assert.equal(verification.completion_status, 'review_required');
  assert.equal(verification.summary.missing_required, 1);
  assert.equal(verification.summary.risky_pending, 1);
});

test('finalizeFormSnapshot groups sections and reports ambiguous labels', () => {
  const snapshot = finalizeFormSnapshot({
    sections: [
      { name: '教育经历', field_labels: ['学校名称', '专业名称'] },
      { name: '项目经历', field_labels: ['项目描述'] },
    ],
    fields: [
      { label: '学校名称', section_name: '教育经历', required: true, value: '' },
      { label: '学校名称', section_name: '教育经历', required: false, value: '' },
      { label: '项目描述', section_name: '项目经历', tag: 'textarea', type: 'textarea', value: 'done' },
    ],
    submit_controls: [{ label: '提交简历' }],
  });

  assert.equal(snapshot.sections.length, 2);
  assert.deepEqual(snapshot.ambiguous_labels, ['学校名称']);
  assert.equal(snapshot.submit_controls[0].risk_level, 'sensitive');
  assert.equal(snapshot.completion_status, 'review_required');
});
