import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakePage } from '../helpers/fake-page.js';

const confirmedInstance = {
  browser: 'Chrome/136.0.7103.114',
  protocolVersion: '1.3',
  headless: false,
  display: 'windowed',
  warning: null,
};

test('form_inspect returns task_kind form with sections, fields, and ambiguity evidence', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => confirmedInstance,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => ({
      sections: [{ name: '教育经历', field_labels: ['学校名称'] }],
      fields: [{ label: '学校名称', normalized_label: '学校名称', risk_level: 'review', current_state: 'missing', required: true }],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
      ambiguous_labels: [],
    }),
  });

  const formInspect = calls.find((tool) => tool.name === 'form_inspect');
  const result = await formInspect.handler({});

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.page_role, 'form');
  assert.equal(result.meta.result.task_kind, 'form');
  assert.equal(result.meta.result.form.sections.length, 1);
  assert.equal(result.meta.result.form.fields.length, 1);
  assert.equal(result.meta.evidence.ambiguous_labels.length, 0);
  assert.equal(result.meta.continuation.suggested_next_action, 'verify_form');
  assert.equal(result.meta.agent_boundary.key, 'form_runtime');
  assert.equal(result.meta.runtime.instance.display, 'windowed');
  assert.equal(result.meta.runtime_state.evidence_anchor.instance_display, 'windowed');
  assert.match(result.content[0].text, /Boundary: form_runtime/);
});

test('fill_form returns written skipped unresolved refreshed form and write evidence', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => null,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => ({
      sections: [{ name: '教育经历', field_labels: ['学校名称'] }],
      fields: [
        { label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', current_state: 'missing', required: false, type: 'textarea' },
        { label: '证件号码', normalized_label: '证件号码', risk_level: 'sensitive', current_state: 'missing', required: true, type: 'text' },
      ],
      submit_controls: [],
      ambiguous_labels: [],
      completion_status: 'review_required',
      summary: { total: 2, safe: 1, review: 0, sensitive: 1, labels: ['研究方向', '证件号码'] },
    }),
    fillSafeFields: async () => ({
      written: [{ field: '研究方向', value: '深度学习' }],
      skipped: [{ field: '证件号码', reason: 'risk_not_safe', risk_level: 'sensitive' }],
      unresolved: [],
      evidence: [{ field: '研究方向', method: 'type_hint', autosave_possible: true, write_side_effect: 'draft_mutation_possible' }],
      snapshot: {
        completion_status: 'review_required',
        sections: [{ name: '教育经历', field_labels: ['学校名称'] }],
        fields: [{ label: '研究方向', normalized_label: '研究方向', risk_level: 'safe', current_state: 'filled', required: false, type: 'textarea' }],
        submit_controls: [],
        ambiguous_labels: [],
        summary: { total: 1, safe: 1, review: 0, sensitive: 0, labels: ['研究方向'] },
      },
    }),
  });

  const fillForm = calls.find((tool) => tool.name === 'fill_form');
  const result = await fillForm.handler({ values: { 研究方向: '深度学习', 证件号码: '110101...' } });

  assert.deepEqual(result.meta.result.written, [{ field: '研究方向', value: '深度学习' }]);
  assert.deepEqual(result.meta.result.skipped, [{ field: '证件号码', reason: 'risk_not_safe', risk_level: 'sensitive' }]);
  assert.deepEqual(result.meta.result.unresolved, []);
  assert.equal(result.meta.result.form.completion_status, 'review_required');
  assert.equal(result.meta.evidence.autosave_possible, true);
  assert.equal(result.meta.result.write_evidence[0].write_side_effect, 'draft_mutation_possible');
});

test('fill_form is blocked until the runtime instance is explicitly confirmed', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    syncPageState: async () => undefined,
    getBrowserInstance: async () => ({
      browser: 'Chrome/136.0.7103.114',
      display: 'windowed',
      warning: null,
    }),
    collectVisibleFormSnapshot: async () => ({
      sections: [],
      fields: [],
      submit_controls: [],
      ambiguous_labels: [],
      completion_status: 'ready',
      summary: { total: 0, safe: 0, review: 0, sensitive: 0, labels: [] },
    }),
    fillSafeFields: async () => {
      throw new Error('fillSafeFields should not run before confirmation');
    },
  });

  const fillForm = calls.find((tool) => tool.name === 'fill_form');
  const result = await fillForm.handler({ values: { 姓名: '张三' } });

  assert.match(result.content[0].text, /Runtime instance confirmation required/);
  assert.equal(result.meta.error_code, 'INSTANCE_CONFIRMATION_REQUIRED');
});

test('fill_form is blocked when the current surface is not form_runtime', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/article',
      title: () => '公开文章',
    }),
    getBrowserInstance: async () => null,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => {
      throw new Error('collectVisibleFormSnapshot should not run outside form_runtime');
    },
    fillSafeFields: async () => {
      throw new Error('fillSafeFields should not run outside form_runtime');
    },
  });

  const fillForm = calls.find((tool) => tool.name === 'fill_form');
  const result = await fillForm.handler({ values: { 姓名: '张三' } });

  assert.equal(result.meta.status, 'blocked');
  assert.equal(result.meta.error_code, 'BOUNDARY_MISMATCH');
  assert.equal(result.meta.agent_boundary.key, 'public_read');
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
  assert.match(result.content[0].text, /Boundary mismatch/);
  assert.match(result.content[0].text, /form_runtime/);
});

test('set_option blocks sensitive fields and returns unresolved for ambiguous labels', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => null,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => ({
      sections: [{ name: '表单', field_labels: ['期望工作城市', '证件号码', '感兴趣的部门'] }],
      fields: [
        { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
        { label: '证件号码', normalized_label: '证件号码', risk_level: 'sensitive', current_state: 'missing', required: true, type: 'select' },
        { label: '感兴趣的部门', normalized_label: '感兴趣的部门', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
        { label: '感兴趣的部门', normalized_label: '感兴趣的部门', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
      ],
      submit_controls: [],
      ambiguous_labels: ['感兴趣的部门'],
      completion_status: 'review_required',
      summary: { total: 4, safe: 0, review: 3, sensitive: 1, labels: ['期望工作城市', '证件号码', '感兴趣的部门', '感兴趣的部门'] },
    }),
    applyReviewedControl: async (_runtime, requestedField) => {
      if (requestedField === '期望工作城市') {
        return { status: 'written', field: '期望工作城市', value: '深圳', evidence: { autosave_possible: true, write_side_effect: 'draft_mutation_possible' }, snapshot: { completion_status: 'review_required', sections: [], fields: [], submit_controls: [], summary: {} } };
      }
      if (requestedField === '证件号码') {
        return { status: 'blocked', field: '证件号码', reason: 'risk_sensitive', snapshot: { completion_status: 'review_required', sections: [], fields: [], submit_controls: [], summary: {} } };
      }
      return { status: 'unresolved', unresolved: { reason: 'ambiguous_label' }, snapshot: { completion_status: 'review_required', sections: [], fields: [], submit_controls: [], summary: {} } };
    },
  });

  const setOption = calls.find((tool) => tool.name === 'set_option');
  const blocked = await setOption.handler({ field: '证件号码', value: '110101...' });
  const unresolved = await setOption.handler({ field: '感兴趣的部门', value: '平台研发' });

  assert.equal(blocked.meta.result.operation.reason, 'risk_sensitive');
  assert.equal(unresolved.meta.result.operation.unresolved.reason, 'ambiguous_label');
});

test('set_date and verify_form return refreshed form state and next action', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => null,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => currentSnapshot,
    applyReviewedDate: async (_runtime, requestedField) => {
      currentSnapshot = {
        sections: [{ name: '申请信息', field_labels: ['最早入职时间', '期望工作城市'] }],
        fields: [
          { label: '最早入职时间', normalized_label: '最早入职时间', risk_level: 'review', current_state: 'filled', required: true, type: 'date' },
          { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
        ],
        submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
        ambiguous_labels: [],
        completion_status: 'review_required',
        verification: { missing_required: 1, risky_pending: 1, unresolved: 0 },
        summary: { total: 2, safe: 0, review: 2, sensitive: 0, labels: ['最早入职时间', '期望工作城市'] },
      };
      return {
      status: requestedField === '最早入职时间' ? 'written' : 'unresolved',
      field: requestedField,
      value: '2026-06-15',
      evidence: { autosave_possible: true, write_side_effect: 'draft_mutation_possible' },
      snapshot: currentSnapshot,
    };},
    applyReviewedControl: async () => ({ status: 'written' }),
  });

  let currentSnapshot = {
    sections: [{ name: '申请信息', field_labels: ['最早入职时间', '期望工作城市'] }],
    fields: [
      { label: '最早入职时间', normalized_label: '最早入职时间', risk_level: 'review', current_state: 'missing', required: true, type: 'date' },
      { label: '期望工作城市', normalized_label: '期望工作城市', risk_level: 'review', current_state: 'missing', required: true, type: 'select' },
    ],
    submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
    ambiguous_labels: [],
    completion_status: 'review_required',
    verification: { missing_required: 2, risky_pending: 2, unresolved: 0 },
    summary: { total: 2, safe: 0, review: 2, sensitive: 0, labels: ['最早入职时间', '期望工作城市'] },
  };

  const setDate = calls.find((tool) => tool.name === 'set_date');
  const verifyForm = calls.find((tool) => tool.name === 'verify_form');

  const setDateResult = await setDate.handler({ field: '最早入职时间', value: '2026-06-15' });
  const verifyResult = await verifyForm.handler({});

  assert.equal(setDateResult.meta.result.operation.status, 'written');
  assert.equal(verifyResult.meta.result.form.completion_status, 'review_required');
  assert.equal(verifyResult.meta.result.form.verification.missing_required, 1);
  assert.equal(verifyResult.meta.result.form.sections.length, 1);
  assert.equal(verifyResult.meta.result.form.fields.length, 2);
  assert.equal(verifyResult.meta.result.form.submit_controls.length, 1);
  assert.equal(verifyResult.meta.result.form.summary.total, 2);
  assert.equal(verifyResult.meta.continuation.suggested_next_action, 'set_option');
});

test('verify_form suggests safe_submit when completion is ready and blockers are clear', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => confirmedInstance,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => ({
      sections: [{ name: '申请信息', field_labels: ['姓名'] }],
      fields: [
        { label: '姓名', normalized_label: '姓名', risk_level: 'safe', current_state: 'filled', required: true, type: 'text' },
      ],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
      ambiguous_labels: [],
      completion_status: 'ready',
      verification: { missing_required: 0, risky_pending: 0, unresolved: 0 },
      summary: { total: 1, safe: 1, review: 0, sensitive: 0, labels: ['姓名'] },
    }),
  });

  const verifyForm = calls.find((tool) => tool.name === 'verify_form');
  const result = await verifyForm.handler({});

  assert.equal(result.meta.result.form.completion_status, 'ready');
  assert.equal(result.meta.continuation.suggested_next_action, 'safe_submit');
  assert.equal(result.meta.runtime.instance.display, 'windowed');
  assert.equal(result.meta.runtime_state.evidence_anchor.instance_display, 'windowed');
});

test('safe_submit returns preview verification and only confirms with SUBMIT', async () => {
  const { registerFormTools } = await import('../../src/server/tools.form.js');
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerFormTools(server, state, {
    getActivePage: async () => createFakePage({
      url: () => 'https://example.com/form',
      title: () => '简历编辑',
    }),
    getBrowserInstance: async () => null,
    syncPageState: async () => undefined,
    collectVisibleFormSnapshot: async () => ({
      sections: [{ name: '申请信息', field_labels: ['最早入职时间'] }],
      fields: [
        { label: '最早入职时间', normalized_label: '最早入职时间', risk_level: 'review', current_state: 'missing', required: true, type: 'date' },
      ],
      submit_controls: [{ label: '提交简历', risk_level: 'sensitive' }],
      ambiguous_labels: [],
      completion_status: 'review_required',
      verification: { blockers: [{ field: '最早入职时间', reason: 'required_missing' }], summary: { missing_required: 1, risky_pending: 1, unresolved: 0 } },
      summary: { total: 1, safe: 0, review: 1, sensitive: 0, labels: ['最早入职时间'] },
    }),
    previewSubmit: async (_runtime, snapshot, options) => {
      const blocked = options.mode !== 'confirm' || options.confirmation !== 'SUBMIT';
      return {
        mode: options.mode ?? 'preview',
        blocked,
        autosave_possible: true,
        verification: snapshot.verification,
        blockers: blocked ? snapshot.verification.blockers : [],
        submit_controls: snapshot.submit_controls,
        ...(blocked ? {} : {
          submitted: true,
          evidence: { autosave_possible: false, write_side_effect: 'submit_attempted' },
        }),
      };
    },
  });

  const safeSubmit = calls.find((tool) => tool.name === 'safe_submit');
  const preview = await safeSubmit.handler({ mode: 'preview' });
  const confirmBlocked = await safeSubmit.handler({ mode: 'confirm', confirmation: 'CONFIRM_SUBMIT' });
  const confirm = await safeSubmit.handler({ mode: 'confirm', confirmation: 'SUBMIT' });

  assert.equal(preview.meta.result.submit.mode, 'preview');
  assert.equal(preview.meta.result.submit.autosave_possible, true);
  assert.equal(preview.meta.result.submit.verification.summary.missing_required, 1);
  assert.equal(preview.meta.continuation.suggested_next_action, 'set_date');
  assert.equal(confirmBlocked.meta.result.submit.blocked, true);
  assert.equal(confirmBlocked.meta.result.submit.mode, 'confirm');
  assert.equal(confirmBlocked.meta.result.submit.verification.summary.missing_required, 1);
  assert.equal(confirm.meta.result.submit.submitted, true);
  assert.equal(confirm.meta.result.submit.autosave_possible, true);
  assert.equal(confirm.meta.continuation.suggested_next_action, 'form_inspect');
});
