import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../../src/server/tools.js';
import { registerWorkspaceTools } from '../../src/server/tools.workspace.js';

test('workspace_inspect returns task_kind workspace with live items and composer state', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: false },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
    }),
  });

  const tool = calls.find((entry) => entry.name === 'workspace_inspect');
  const result = await tool.handler({});

  assert.equal(result.meta.result.task_kind, 'workspace');
  assert.equal(result.meta.result.workspace.workspace_surface, 'thread');
  assert.equal(result.meta.result.workspace.live_items.length, 1);
});

test('workspace_inspect redacts runtime fields from the public workspace view', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
      active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
      composer: { kind: 'chat_composer', draft_present: true, draft_text: '你好' },
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      blocking_modals: [{ label: '权限提示', hint_id: 'M1', normalized_label: '权限提示' }],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
    }),
  });

  const tool = calls.find((entry) => entry.name === 'workspace_inspect');
  const result = await tool.handler({});
  const workspace = result.meta.result.workspace;

  assert.deepEqual(workspace.live_items, [{ label: '李女士', selected: true }]);
  assert.deepEqual(workspace.active_item, { label: '李女士' });
  assert.deepEqual(workspace.composer, { kind: 'chat_composer', draft_present: true });
  assert.deepEqual(workspace.action_controls, [{ label: '发送', action_kind: 'send' }]);
  assert.deepEqual(workspace.blocking_modals, [{ label: '权限提示' }]);
  assert.equal(workspace.live_items[0].hint_id, undefined);
  assert.equal(workspace.live_items[0].normalized_label, undefined);
  assert.equal(workspace.composer.draft_text, undefined);
});

test('workspace_inspect short-circuits blocked handoff and gated pages', async () => {
  const cases = [
    { handoffState: 'handoff_required', expectedStatus: 'handoff_required' },
    { handoffState: 'handoff_in_progress', expectedStatus: 'handoff_required' },
    { handoffState: 'awaiting_reacquisition', expectedStatus: 'handoff_required' },
    { handoffState: 'idle', riskGateDetected: true, expectedStatus: 'gated' },
  ];

  for (const testCase of cases) {
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
    const state = {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: testCase.riskGateDetected === true },
      handoff: { state: testCase.handoffState },
    };

    registerWorkspaceTools(server, state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: true }],
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: true },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        blocking_modals: [],
        loading_shell: false,
        summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
      }),
    });

    const tool = calls.find((entry) => entry.name === 'workspace_inspect');
    const before = JSON.parse(JSON.stringify(state));
    const result = await tool.handler({});

    assert.equal(result.meta.status, testCase.expectedStatus);
    assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
    assert.deepEqual(state, before);
  }
});

test('workspace_inspect prefers select_live_item when there is no active item even with a draft', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: false }],
      active_item: null,
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: null, draft_present: true, loading_shell: false },
    }),
  });

  const tool = calls.find((entry) => entry.name === 'workspace_inspect');
  const result = await tool.handler({});

  assert.equal(result.meta.continuation.suggested_next_action, 'select_live_item');
});

test('workspace_inspect summary prefers the selected live item label on list surfaces', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'list', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => '公众号', url: () => 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'list',
      live_items: [{ label: '首页', selected: true }, { label: '新的功能', selected: false }],
      active_item: null,
      composer: null,
      action_controls: [],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: null, draft_present: false, loading_shell: false },
    }),
  });

  const tool = calls.find((entry) => entry.name === 'workspace_inspect');
  const result = await tool.handler({});

  assert.equal(result.meta.result.summary, 'Workspace list • 首页');
});

test('workspace_inspect does not suggest execute_action when blockers are visible or send controls are missing', async () => {
  const blockerCalls = [];
  const blockerServer = { registerTool(name, spec, handler) { blockerCalls.push({ name, handler }); } };
  const blockerState = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(blockerServer, blockerState, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [{ label: '权限提示' }],
      loading_shell: false,
      summary: {
        active_item_label: '李女士',
        draft_present: true,
        loading_shell: false,
        outcome_signals: { active_item_stable: true },
      },
    }),
  });

  const blockerResult = await blockerCalls.find((entry) => entry.name === 'workspace_inspect').handler({});
  assert.equal(blockerResult.meta.continuation.suggested_next_action, 'workspace_inspect');

  const missingSendCalls = [];
  const missingSendServer = { registerTool(name, spec, handler) { missingSendCalls.push({ name, handler }); } };
  const missingSendState = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(missingSendServer, missingSendState, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: false },
      action_controls: [{ label: '取消', action_kind: 'dismiss' }],
      blocking_modals: [],
      loading_shell: false,
      summary: {
        active_item_label: '李女士',
        draft_present: false,
        loading_shell: false,
        outcome_signals: { active_item_stable: true },
      },
    }),
  });

  const missingSendResult = await missingSendCalls.find((entry) => entry.name === 'workspace_inspect').handler({});
  assert.equal(missingSendResult.meta.continuation.suggested_next_action, 'draft_action');
});

test('workspace_inspect does not suggest execute_action for label-only send-like controls', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [
        { label: '发送', action_kind: 'button' },
        { label: '提交', action_kind: 'button' },
        { label: '回复', action_kind: 'button' },
      ],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, outcome_signals: { active_item_stable: true } },
    }),
  });

  const result = await calls.find((entry) => entry.name === 'workspace_inspect').handler({});
  assert.equal(result.meta.continuation.suggested_next_action, 'draft_action');
});

test('workspace action tools select live items directly while draft_action drafts directly and execute_action confirms explicitly', async () => {
  const directCalls = [];
  const directServer = { registerTool(name, spec, handler) { directCalls.push({ name, handler }); } };
  const directState = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  const directInvocations = [];
  registerWorkspaceTools(directServer, directState, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
    }),
    selectLiveItem: async () => directInvocations.push('select_live_item'),
    draftWorkspaceAction: async (_runtime, text) => {
      directInvocations.push(`draft_action:${text}`);
      return {
        status: 'drafted',
        draft_evidence: {
          kind: 'draft_action',
          target: 'chat_composer',
          autosave_possible: true,
          write_side_effect: 'draft_mutation_possible',
          draft_present: true,
        },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: '你好' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
        },
      };
    },
    executeWorkspaceAction: async (_runtime, params) => {
      directInvocations.push(`execute_action:${params.mode}:${params.confirmation ?? ''}`);
      return {
        status: 'success',
        blocked: false,
        reason: null,
        executed: true,
        unresolved: null,
        failure: null,
        verification: {
          delivered: true,
          composer_cleared: true,
          active_item_stable: true,
        },
        action: {
          kind: 'execute_action',
          status: 'executed',
        },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [
            { label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' },
          ],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
        },
        workspace: {
          workspace_surface: 'thread',
          live_items: [
            { label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' },
          ],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
        },
        summary: 'Workspace thread • 李女士',
      };
    },
  });

  const directResults = [];
  for (const toolName of ['select_live_item', 'draft_action', 'execute_action']) {
    const tool = directCalls.find((entry) => entry.name === toolName);
    directResults.push(await tool.handler(toolName === 'select_live_item'
      ? { item: '李女士' }
      : toolName === 'draft_action'
        ? { text: '你好' }
        : { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' }));
  }

  assert.equal(directResults[0].meta.continuation.suggested_next_action, 'workspace_inspect');
  assert.equal(directResults[1].meta.continuation.suggested_next_action, 'workspace_inspect');
  assert.equal(directResults[2].meta.continuation.suggested_next_action, 'verify_outcome');
  assert.equal(directResults[0].meta.result.status, 'selected');
  assert.equal(directResults[1].meta.result.status, 'drafted');
  assert.deepEqual(directResults.map((result) => result.meta.result.action.status), ['selected', 'drafted', 'executed']);
  assert.equal(directResults[0].meta.result.selected_item.label, '李女士');
  assert.equal(directResults[0].meta.result.active_item.label, '李女士');
  assert.equal(directResults[0].meta.result.selected_item.hint_id, undefined);
  assert.equal(directResults[0].meta.result.selected_item.normalized_label, undefined);
  assert.equal(directResults[0].meta.result.active_item.hint_id, undefined);
  assert.equal(directResults[0].meta.result.selection_evidence.selected_item.hint_id, undefined);
  assert.equal(directResults[0].meta.result.snapshot.live_items[0].hint_id, undefined);
  assert.equal(directResults[0].meta.result.snapshot.live_items[0].normalized_label, undefined);
  assert.equal(directResults[0].meta.result.snapshot.composer?.draft_text, undefined);
  assert.equal(directResults[1].meta.result.snapshot.composer?.draft_text, undefined);
  assert.equal(directResults[1].meta.result.draft_evidence?.draft_text, undefined);
  assert.equal(directResults[1].meta.result.snapshot.live_items[0].hint_id, undefined);
  assert.equal(directResults[1].meta.result.snapshot.live_items[0].normalized_label, undefined);
  assert.equal(directResults[1].meta.result.snapshot.composer?.hint_id, undefined);
  assert.equal(directResults[2].meta.result.status, 'success');
  assert.equal(directResults[2].meta.result.snapshot.live_items[0].hint_id, undefined);
  assert.equal(directResults[2].meta.result.snapshot.live_items[0].normalized_label, undefined);
  assert.equal(directResults[2].meta.result.snapshot.composer?.hint_id, undefined);
  assert.equal(directResults[2].meta.result.snapshot.composer?.draft_text, undefined);
  assert.deepEqual(directInvocations, ['select_live_item', 'draft_action:你好', 'execute_action:confirm:EXECUTE']);

  const blockedCalls = [];
  const blockedServer = { registerTool(name, spec, handler) { blockedCalls.push({ name, handler }); } };
  const blockedState = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: true },
    handoff: { state: 'handoff_required' },
  };
  const blockedMutations = [];

  registerWorkspaceTools(blockedServer, blockedState, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
    }),
    selectLiveItem: async () => blockedMutations.push('select_live_item_mutated'),
    draftWorkspaceAction: async () => blockedMutations.push('draft_action_mutated'),
    clickByHintId: async () => blockedMutations.push('execute_action_mutated'),
  });

  for (const toolName of ['select_live_item', 'draft_action', 'execute_action']) {
    const tool = blockedCalls.find((entry) => entry.name === toolName);
    const result = await tool.handler(toolName === 'select_live_item' ? { item: '李女士' } : toolName === 'draft_action' ? { text: '你好' } : {});

    assert.equal(result.meta.status, 'handoff_required');
    assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
    if (toolName === 'select_live_item') {
      assert.equal(result.meta.result.status, 'blocked');
      assert.equal(result.meta.result.active_item.label, '李女士');
      assert.notEqual(result.meta.result.detail_alignment, undefined);
      assert.ok(result.meta.result.snapshot);
      assert.ok(result.meta.result.selection_evidence);
      assert.equal(result.meta.result.selected_item, null);
      assert.equal(result.meta.result.active_item.hint_id, undefined);
      assert.equal(result.meta.result.selection_evidence.selected_item?.hint_id, undefined);
      assert.equal(result.meta.result.snapshot.live_items[0].hint_id, undefined);
      assert.equal(result.meta.result.snapshot.live_items[0].normalized_label, undefined);
    } else if (toolName === 'draft_action') {
      assert.equal(result.meta.result.status, 'blocked');
      assert.equal(result.meta.result.action.status, 'blocked');
      assert.equal(result.meta.result.snapshot.composer?.draft_text, undefined);
      assert.equal(result.meta.result.snapshot.composer?.hint_id, undefined);
      assert.equal(result.meta.result.draft_evidence?.draft_text, undefined);
    } else {
      assert.equal(result.meta.result.status, 'blocked');
      assert.equal(result.meta.result.action.status, 'blocked');
    }
  }

  assert.deepEqual(blockedMutations, []);

  const gatedCalls = [];
  const gatedServer = { registerTool(name, spec, handler) { gatedCalls.push({ name, handler }); } };
  const gatedState = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: true },
    handoff: { state: 'idle' },
  };
  const gatedMutations = [];

  registerWorkspaceTools(gatedServer, gatedState, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
    }),
    selectLiveItem: async () => gatedMutations.push('select_live_item_mutated'),
    draftWorkspaceAction: async () => gatedMutations.push('draft_action_mutated'),
    clickByHintId: async () => gatedMutations.push('execute_action_mutated'),
  });

  const gatedResult = await gatedCalls.find((entry) => entry.name === 'draft_action').handler({ text: '你好' });
  assert.equal(gatedResult.meta.status, 'gated');
  assert.equal(gatedResult.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(gatedResult.meta.result.status, 'blocked');
  assert.ok(gatedResult.meta.result.snapshot);
  assert.equal(gatedResult.meta.result.snapshot.composer?.hint_id, undefined);
  assert.equal(gatedResult.meta.result.snapshot.composer?.draft_text, undefined);
  assert.equal(gatedResult.meta.result.draft_evidence?.draft_text, undefined);
  assert.deepEqual(gatedMutations, []);
});

test('execute_action exposes unresolved and failed responses without leaking internal fields', async () => {
  const cases = [
    {
      name: 'unresolved',
      executeResult: {
        status: 'unresolved',
        unresolved: {
          reason: 'no_live_target',
          requested_label: '发送',
          recovery_hint: 'reinspect_workspace',
          matches: [{ label: '发送', hint_id: 'B1' }],
        },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [], loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
        },
        workspace: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [], loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
        },
      },
      expectedStatus: 'unresolved',
    },
    {
      name: 'failed',
      executeResult: {
        status: 'failed',
        failure: {
          error_code: 'ACTION_NOT_VERIFIED',
          retryable: true,
          suggested_next_step: 'reverify',
        },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [], loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
        },
        workspace: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [], loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
        },
      },
      expectedStatus: 'failed',
    },
  ];

  for (const testCase of cases) {
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
    const state = {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    };

    registerWorkspaceTools(server, state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: async () => testCase.executeResult.snapshot,
      executeWorkspaceAction: async () => testCase.executeResult,
    });

    const result = await calls.find((entry) => entry.name === 'execute_action').handler({
      action: 'send',
      mode: 'confirm',
      confirmation: 'EXECUTE',
    });

    assert.equal(result.meta.result.status, testCase.expectedStatus, testCase.name);
    assert.equal(result.meta.result.snapshot.live_items[0].hint_id, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.live_items[0].normalized_label, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.composer?.hint_id, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.composer?.draft_text, undefined, testCase.name);

    if (testCase.name === 'unresolved') {
      assert.equal(result.meta.result.unresolved.reason, 'no_live_target');
      assert.equal(result.meta.result.unresolved.matches, undefined);
      assert.equal(result.meta.result.failure, null);
    } else {
      assert.deepEqual(result.meta.result.failure, {
        error_code: 'ACTION_NOT_VERIFIED',
        retryable: true,
        suggested_next_step: 'reverify',
      });
      assert.equal(result.meta.result.unresolved, null);
    }
  }
});

test('execute_action uses refreshed state when the action changes gateway status', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => ({
      workspace_surface: 'thread',
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      composer: { kind: 'chat_composer', draft_present: true },
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      blocking_modals: [],
      loading_shell: false,
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
    }),
    executeWorkspaceAction: async () => {
      state.pageState.riskGateDetected = true;
      return {
        status: 'success',
        blocked: false,
        executed: true,
        reason: null,
        unresolved: null,
        failure: null,
        verification: { delivered: true, composer_cleared: true, active_item_stable: true },
        action: { kind: 'execute_action', status: 'executed' },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          composer: { kind: 'chat_composer', draft_present: false },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
        },
        workspace: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          composer: { kind: 'chat_composer', draft_present: false },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
        },
        summary: 'Workspace thread • 李女士',
      };
    },
  });

  const result = await calls.find((entry) => entry.name === 'execute_action').handler({
    action: 'send',
    mode: 'confirm',
    confirmation: 'EXECUTE',
  });

  assert.equal(result.meta.status, 'gated');
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(result.meta.result.status, 'success');
});

test('select_live_item exposes unresolved reasons in the public response', async () => {
  const cases = [
    {
      name: 'ambiguous_item',
      state: {
        pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
        handoff: { state: 'idle' },
      },
      snapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [
          { label: '李女士', selected: false, hint_id: 'L1', normalized_label: '李女士' },
          { label: '李女士', selected: false, hint_id: 'L2', normalized_label: '李女士' },
        ],
        active_item: null,
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [],
        blocking_modals: [],
        loading_shell: false,
        summary: { active_item_label: null, draft_present: false, loading_shell: false },
      }),
      expectedReason: 'ambiguous_item',
    },
    {
      name: 'not_in_visible_window',
      state: {
        pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
        handoff: { state: 'idle' },
      },
      snapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [
          { label: '胡女士', selected: false, hint_id: 'L2', normalized_label: '胡女士' },
        ],
        active_item: null,
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [],
        blocking_modals: [],
        loading_shell: false,
        summary: { active_item_label: null, draft_present: false, loading_shell: false },
      }),
      expectedReason: 'not_in_visible_window',
    },
    {
      name: 'virtualized_window_changed',
      state: {
        pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
        handoff: { state: 'idle' },
      },
      snapshot: (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) {
            return {
              workspace_surface: 'thread',
              live_items: [
                { label: '李女士', selected: false, hint_id: 'L1', normalized_label: '李女士' },
              ],
              active_item: null,
              composer: { kind: 'chat_composer', draft_present: false },
              action_controls: [],
              blocking_modals: [],
              loading_shell: false,
              summary: { active_item_label: null, draft_present: false, loading_shell: false },
            };
          }

          return {
            workspace_surface: 'thread',
            live_items: [
              { label: '李女士', selected: true, hint_id: 'L2', normalized_label: '李女士' },
            ],
            active_item: { label: '李女士', selected: true, hint_id: 'L2', normalized_label: '李女士' },
            detail_alignment: 'aligned',
            selection_window: 'visible',
            composer: { kind: 'chat_composer', draft_present: false },
            action_controls: [],
            blocking_modals: [],
            loading_shell: false,
            summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
          };
        };
      })(),
      expectedReason: 'virtualized_window_changed',
    },
    {
      name: 'detail_panel_mismatch',
      state: {
        pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
        handoff: { state: 'idle' },
      },
      snapshot: (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) {
            return {
              workspace_surface: 'thread',
              live_items: [
                { label: '李女士', selected: false, hint_id: 'L1', normalized_label: '李女士' },
              ],
              active_item: null,
              composer: { kind: 'chat_composer', draft_present: false },
              action_controls: [],
              blocking_modals: [],
              loading_shell: false,
              summary: { active_item_label: null, draft_present: false, loading_shell: false },
            };
          }

          return {
            workspace_surface: 'thread',
            live_items: [
              { label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' },
            ],
            active_item: { label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' },
            detail_alignment: 'mismatch',
            selection_window: 'visible',
            composer: { kind: 'chat_composer', draft_present: false },
            action_controls: [],
            blocking_modals: [],
            loading_shell: false,
            summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
          };
        };
      })(),
      expectedReason: 'detail_panel_mismatch',
    },
  ];

  for (const testCase of cases) {
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };

    registerWorkspaceTools(server, testCase.state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: testCase.snapshot,
      selectLiveItem: async () => ({ ok: true }),
    });

    const result = await calls.find((entry) => entry.name === 'select_live_item').handler({ item: '李女士' });

    assert.equal(result.meta.result.status, 'unresolved', testCase.name);
    assert.equal(result.meta.result.unresolved.reason, testCase.expectedReason, testCase.name);
    assert.equal(result.meta.result.selection_evidence.recovery_hint, result.meta.result.unresolved.recovery_hint, testCase.name);
  }
});

test('select_live_item falls back to clicking a visible workspace row when the live item has no hint id', async () => {
  const calls = [];
  const clicks = [];
  let snapshotCall = 0;
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'workspace', workspaceSurface: 'list', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };
  const page = {
    title: async () => 'BOSS直聘',
    url: () => 'https://www.zhipin.com/web/geek/chat?id=1',
    evaluate: async () => ({ x: 120, y: 260 }),
    mouse: {
      click: async (x, y) => {
        clicks.push({ x, y });
      },
    },
  };
  const initialSnapshot = {
    workspace_surface: 'list',
    live_items: [{ label: '李女士', selected: false }],
    active_item: { label: '全部', selected: true },
    composer: null,
    action_controls: [],
    blocking_modals: [],
    loading_shell: false,
    summary: {
      active_item_label: '全部',
      draft_present: false,
      loading_shell: false,
      detail_alignment: 'unknown',
      selection_window: 'visible',
    },
  };
  const refreshedSnapshot = {
    workspace_surface: 'thread',
    live_items: [{ label: '李女士', selected: true }],
    active_item: { label: '李女士', selected: true },
    composer: { kind: 'chat_composer', draft_present: false },
    action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
    blocking_modals: [],
    loading_shell: false,
    summary: {
      active_item_label: '李女士',
      draft_present: false,
      loading_shell: false,
      detail_alignment: 'aligned',
      selection_window: 'visible',
    },
  };

  registerWorkspaceTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async () => undefined,
    collectVisibleWorkspaceSnapshot: async () => {
      snapshotCall += 1;
      return snapshotCall === 1 ? initialSnapshot : refreshedSnapshot;
    },
  });

  const result = await calls.find((entry) => entry.name === 'select_live_item').handler({ item: '李女士' });

  assert.equal(clicks.length, 1);
  assert.equal(result.meta.result.status, 'selected');
  assert.deepEqual(result.meta.result.selected_item, { label: '李女士', selected: true });
  assert.deepEqual(result.meta.result.active_item, { label: '李女士' });
  assert.equal(result.meta.continuation.suggested_next_action, 'workspace_inspect');
});

test('draft_action exposes public-safe unresolved and failed responses', async () => {
  const cases = [
    {
      name: 'unresolved',
      draftResult: {
        status: 'unresolved',
        unresolved: {
          reason: 'loading_shell',
          requested_label: 'composer',
          matches: [{ label: '消息输入框', hint_id: 'C1' }],
        },
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: true,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: true },
        },
      },
    },
    {
      name: 'failed',
      draftResult: {
        status: 'failed',
        error_code: 'ACTION_NOT_VERIFIED',
        retryable: true,
        suggested_next_step: 'reverify',
        snapshot: {
          workspace_surface: 'thread',
          live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
          active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: 'internal' },
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          blocking_modals: [],
          loading_shell: false,
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
        },
      },
    },
  ];

  for (const testCase of cases) {
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, spec, handler }); } };
    const state = {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    };

    registerWorkspaceTools(server, state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
        active_item: { label: '李女士', hint_id: 'L1', normalized_label: '李女士', selected: true },
        composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: 'internal' },
        action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
        blocking_modals: [],
        loading_shell: false,
        summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
      }),
      draftWorkspaceAction: async () => testCase.draftResult,
    });

    const tool = calls.find((entry) => entry.name === 'draft_action');
    assert.equal(tool.spec.inputSchema.text._def.description, 'Draft text to write into the current workspace composer');

    const result = await tool.handler({ text: '你好' });

    assert.equal(result.meta.result.status, testCase.draftResult.status, testCase.name);
    assert.equal(result.meta.result.snapshot.composer?.hint_id, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.composer?.draft_text, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.live_items[0].hint_id, undefined, testCase.name);
    assert.equal(result.meta.result.snapshot.live_items[0].normalized_label, undefined, testCase.name);

    if (testCase.name === 'unresolved') {
      assert.equal(result.meta.result.unresolved.reason, 'loading_shell');
      assert.equal(result.meta.result.unresolved.matches, undefined);
      assert.equal(result.meta.result.failure, null);
    } else {
      assert.deepEqual(result.meta.result.failure, {
        error_code: 'ACTION_NOT_VERIFIED',
        retryable: true,
        suggested_next_step: 'reverify',
      });
      assert.equal(result.meta.result.unresolved, null);
    }
  }
});

test('verify_outcome returns verification fields and suggested next action branches', async () => {
  const cases = [
    {
      name: 'loading_shell',
      expectedActiveItemLabel: null,
      snapshot: async () => ({
        workspace_surface: 'loading_shell',
        live_items: [],
        active_item: null,
        composer: null,
        action_controls: [],
        blocking_modals: [],
        loading_shell: true,
        detail_alignment: 'unknown',
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
        summary: {
          active_item_label: null,
          draft_present: false,
          loading_shell: true,
          blocking_modal_present: false,
          detail_alignment: 'unknown',
          outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
          ready_for_next_action: 'workspace_inspect',
        },
      }),
      expectedNextAction: 'workspace_inspect',
    },
    {
      name: 'detail_mismatch',
      expectedActiveItemLabel: '李女士',
      snapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: true }],
        active_item: { label: '李女士' },
        detail_panel: { label: '王先生' },
        detail_alignment: 'mismatch',
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        blocking_modals: [],
        loading_shell: false,
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
        summary: {
          active_item_label: '李女士',
          draft_present: false,
          loading_shell: false,
          blocking_modal_present: false,
          detail_alignment: 'mismatch',
          outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
          ready_for_next_action: 'select_live_item',
        },
      }),
      expectedNextAction: 'select_live_item',
    },
    {
      name: 'no_active_item',
      expectedActiveItemLabel: null,
      snapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: false }],
        active_item: null,
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'unknown',
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
        summary: {
          active_item_label: null,
          draft_present: false,
          loading_shell: false,
          blocking_modal_present: false,
          detail_alignment: 'unknown',
          outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
          ready_for_next_action: 'select_live_item',
        },
      }),
      expectedNextAction: 'select_live_item',
    },
    {
      name: 'draft_without_send_control',
      expectedActiveItemLabel: '李女士',
      snapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: true }],
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '取消', action_kind: 'dismiss' }],
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
        summary: {
          active_item_label: '李女士',
          draft_present: false,
          loading_shell: false,
          blocking_modal_present: false,
          detail_alignment: 'aligned',
          outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
          ready_for_next_action: 'draft_action',
        },
      }),
      expectedNextAction: 'draft_action',
    },
  ];

  for (const testCase of cases) {
    const calls = [];
    const state = {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    };

    const server = { registerTool(name, spec, handler) { calls.push({ name, spec, handler }); } };
    registerWorkspaceTools(server, state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: testCase.snapshot,
    });

    const tool = calls.find((entry) => entry.name === 'verify_outcome');
    const result = await tool.handler({});

    assert.equal(result.meta.result.verification.ready_for_next_action, testCase.expectedNextAction, testCase.name);
    assert.equal(result.meta.continuation.suggested_next_action, testCase.expectedNextAction, testCase.name);
    assert.equal(result.meta.result.verification.active_item_label, testCase.expectedActiveItemLabel, testCase.name);
    assert.equal(result.meta.result.verification.blocking_modal_present, false, testCase.name);
  }
});

test('verify_outcome preserves blocked and gated safety behavior without mutating state', async () => {
  const cases = [
    { handoffState: 'handoff_required', expectedStatus: 'handoff_required' },
    { handoffState: 'handoff_in_progress', expectedStatus: 'handoff_required' },
    { handoffState: 'awaiting_reacquisition', expectedStatus: 'handoff_required' },
    { handoffState: 'idle', riskGateDetected: true, expectedStatus: 'gated' },
  ];

  for (const testCase of cases) {
    const calls = [];
    const state = {
      pageState: {
        currentRole: 'workspace',
        workspaceSurface: 'thread',
        graspConfidence: 'high',
        riskGateDetected: testCase.riskGateDetected === true,
      },
      handoff: { state: testCase.handoffState },
    };
    const mutations = [];

    const server = { registerTool(name, spec, handler) { calls.push({ name, spec, handler }); } };
    registerWorkspaceTools(server, state, {
      getActivePage: async () => ({ title: async () => 'BOSS直聘', url: () => 'https://www.zhipin.com/web/geek/chat?id=1' }),
      syncPageState: async () => undefined,
      collectVisibleWorkspaceSnapshot: async () => ({
        workspace_surface: 'thread',
        live_items: [{ label: '李女士', selected: true }],
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: true },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
        summary: {
          active_item_label: '李女士',
          draft_present: true,
          loading_shell: false,
          blocking_modal_present: false,
          detail_alignment: 'aligned',
          outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
          ready_for_next_action: 'execute_action',
        },
      }),
      selectLiveItem: async () => mutations.push('select'),
      draftWorkspaceAction: async () => mutations.push('draft'),
      executeWorkspaceAction: async () => mutations.push('execute'),
    });

    const before = JSON.parse(JSON.stringify(state));
    const result = await calls.find((entry) => entry.name === 'verify_outcome').handler({});

    assert.equal(result.meta.status, testCase.expectedStatus);
    assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
    assert.equal(result.meta.result.suggested_next_action, 'request_handoff');
    assert.equal(result.meta.result.verification.ready_for_next_action, 'request_handoff');
    assert.deepEqual(state, before);
    assert.deepEqual(mutations, []);
  }
});

test('registerTools registers workspace tools after form tools and before strategy tools', () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push(name); } };

  registerTools(server, {
    pageState: { currentRole: 'workspace', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  });

  const formIndex = calls.indexOf('form_inspect');
  const workspaceIndex = calls.indexOf('workspace_inspect');
  const strategyIndex = calls.indexOf('preheat_session');

  assert.ok(formIndex >= 0);
  assert.ok(workspaceIndex >= 0);
  assert.ok(strategyIndex >= 0);
  assert.ok(formIndex < workspaceIndex);
  assert.ok(workspaceIndex < strategyIndex);
});
