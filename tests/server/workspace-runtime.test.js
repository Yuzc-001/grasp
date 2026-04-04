import test from 'node:test';
import assert from 'node:assert/strict';
import {

  resolveLiveItem,

  resolveComposer,

  createWorkspaceWriteEvidence,

  executeGuardedAction,

  selectWorkspaceItem,

  selectItemByHint,

  draftWorkspaceAction,

  draftIntoComposer,

  executeWorkspaceAction,

  verifyActionOutcome,

} from '../../src/server/workspace-runtime.js';

import {

  getWorkspaceExecuteSignals,

  canExecuteWorkspaceSend,

  normalizeWorkspaceSnapshot,

} from '../../src/server/workspace-runtime.seams.js';

import { createFakePage } from '../helpers/fake-page.js';

test('workspace runtime seam helpers expose execution readiness and snapshot normalization', async () => {
  const snapshot = {
    live_items: [],
    composer: { kind: 'chat_composer', draft_present: true },
    action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
    blocking_modals: [],
    loading_shell: false,
    workspace_surface: 'thread',
    summary: {
      draft_present: true,
      outcome_signals: { active_item_stable: true },
    },
  };

  const signals = getWorkspaceExecuteSignals(snapshot);
  const normalized = normalizeWorkspaceSnapshot(snapshot);

  assert.equal(signals.loadingShell, false);
  assert.equal(signals.blockingModalCount, 0);
  assert.equal(Boolean(signals.sendControl), true);
  assert.equal(canExecuteWorkspaceSend(snapshot), true);
  assert.equal(normalized.workspace_surface, 'thread');
  assert.equal(typeof normalized.summary_text, 'string');
});

test('resolveLiveItem matches by normalized label and returns ambiguity when needed', async () => {
  const exact = await resolveLiveItem({
    live_items: [
      { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
      { label: '胡女士', normalized_label: '胡女士', hint_id: 'L2' },
    ],
  }, '李女士');

  assert.equal(exact.item.label, '李女士');
  assert.equal(exact.ambiguous, false);
});

test('resolveLiveItem prefers the hint-backed item when duplicates exist', async () => {
  const result = await resolveLiveItem({
    live_items: [
      { label: '李女士', normalized_label: '李女士' },
      { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
    ],
  }, '李女士');

  assert.equal(result.item.hint_id, 'L1');
  assert.equal(result.ambiguous, false);
});

test('resolveComposer reports loading_shell when the workspace is still loading', async () => {
  const result = await resolveComposer({
    loading_shell: true,
  });

  assert.equal(result.composer, null);
  assert.equal(result.unresolved.reason, 'loading_shell');
});

test('createWorkspaceWriteEvidence reports draft-side effects for composer writes', () => {
  const evidence = createWorkspaceWriteEvidence({ kind: 'draft_action', target: 'chat_composer' });
  assert.equal(evidence.autosave_possible, true);
  assert.equal(evidence.write_side_effect, 'draft_mutation_possible');
});

test('executeGuardedAction refreshes and persists a snapshot with outcome signals', async () => {
  const persisted = [];
  const runtime = {
    snapshot: {
      body_text: '旧快照',
      live_items: [],
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      loading_shell: false,
      summary: {
        workspace_surface: 'composer',
        active_item_label: null,
        draft_present: false,
        loading_shell: false,
        blocking_modals: [],
        blocking_modal_count: 0,
        blocking_modal_labels: [],
        detail_alignment: 'unknown',
        selection_window: 'not_found',
        recovery_hint: 'reinspect_workspace',
        outcome_signals: {
          delivered: false,
          composer_cleared: false,
          active_item_stable: false,
        },
        summary: 'surface=composer active=none draft=empty blockers=0 loading=no detail=unknown selection=not_found',
      },
    },
    refreshSnapshot: async () => ({
      body_text: '已发送',
      live_items: [],
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      loading_shell: false,
      summary: {
        workspace_surface: 'composer',
        active_item_label: null,
        draft_present: false,
        loading_shell: false,
        blocking_modals: [],
        blocking_modal_count: 0,
        blocking_modal_labels: [],
        detail_alignment: 'unknown',
        selection_window: 'not_found',
        recovery_hint: 'reinspect_workspace',
        outcome_signals: {
          delivered: false,
          composer_cleared: false,
          active_item_stable: false,
        },
        summary: 'surface=composer active=none draft=empty blockers=0 loading=no detail=unknown selection=not_found',
      },
    }),
    persistSnapshot: async (snapshot) => {
      persisted.push(snapshot);
    },
  };

  const result = await executeGuardedAction({
    runtime,
    execute: async () => ({ ok: true }),
    verify: async ({ snapshot }) => {
      assert.equal(snapshot.outcome_signals.delivered, true);
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(persisted[0].outcome_signals.delivered, true);
  assert.equal(runtime.snapshot.outcome_signals.delivered, true);
  assert.equal(runtime.snapshot.body_text, '已发送');
  assert.equal(typeof runtime.snapshot.summary, 'object');
  assert.equal(runtime.snapshot.summary.summary, 'surface=composer active=none draft=empty blockers=0 loading=no detail=unknown selection=not_found');
  assert.equal(runtime.snapshot.summary_text, 'surface=composer active=none draft=empty blockers=0 loading=no detail=unknown selection=not_found');
});

test('verifyActionOutcome returns LOADING_PENDING when the fresh snapshot is loading', async () => {
  const result = await verifyActionOutcome({
    snapshot: {
      loading_shell: true,
      workspace_surface: 'loading_shell',
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
        loading_shell: false,
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'LOADING_PENDING');
});

test('verifyActionOutcome returns LOADING_PENDING when the fresh snapshot surface is loading_shell', async () => {
  const result = await verifyActionOutcome({
    snapshot: {
      loading_shell: false,
      workspace_surface: 'loading_shell',
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'LOADING_PENDING');
});

test('selectItemByHint succeeds from fresh selection evidence after refresh', async () => {
  const persisted = [];
  const page = createFakePage({
    url: () => 'https://example.test/workspace',
    evaluate: async () => null,
  });
  const runtime = {
    page,
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: false },
        { label: '胡女士', normalized_label: '胡女士', hint_id: 'L2', selected: false },
      ],
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    },
    clickByHintId: async () => ({ label: '李女士' }),
    refreshSnapshot: async () => ({
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true },
        { label: '胡女士', normalized_label: '胡女士', hint_id: 'L2', selected: false },
      ],
      active_item: { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true },
      detail_alignment: 'aligned',
      selection_window: 'visible',
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: true,
      },
    }),
    persistSnapshot: async (snapshot) => {
      persisted.push(snapshot);
    },
  };

  const result = await selectItemByHint(runtime, '李女士');

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.summary.active_item_label, '李女士');
  assert.equal(result.snapshot.summary.selection_window, 'visible');
  assert.equal(persisted[0].summary.active_item_label, '李女士');
});

test('selectItemByHint returns ambiguous_item when multiple live targets match', async () => {
  const result = await selectItemByHint({
    snapshot: {
      workspace_surface: 'thread',
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
        { label: '李女士', normalized_label: '李女士', hint_id: 'L2' },
      ],
    },
  }, '李女士');

  assert.equal(result.ok, false);
  assert.equal(result.unresolved.reason, 'ambiguous_item');
});

test('selectItemByHint returns no_live_target when nothing matches', async () => {
  const result = await selectItemByHint({
    snapshot: {
      workspace_surface: 'thread',
      live_items: [],
    },
  }, '李女士');

  assert.equal(result.ok, false);
  assert.equal(result.unresolved.reason, 'no_live_target');
});

test('select_live_item writes selection intent and verifies the active item changed', async () => {
  const actions = [];
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
          { label: '胡女士', normalized_label: '胡女士', hint_id: 'L2' },
        ],
      },
      selectItemByHint: async (item) => {
        actions.push(item.label);
        return { ok: true };
      },
      refreshSnapshot: async () => ({
        live_items: [{ label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true }],
        active_item: { label: '李女士' },
      }),
    },
    '李女士'
  );

  assert.deepEqual(actions, ['李女士']);
  assert.equal(result.status, 'selected');
  assert.equal(result.active_item.label, '李女士');
});

test('select_live_item rejects the same label when the hinted identity changes', async () => {
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
        ],
      },
      selectItemByHint: async () => ({ ok: true }),
      refreshSnapshot: async () => ({
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L2', selected: true },
        ],
        active_item: { label: '李女士', normalized_label: '李女士', hint_id: 'L2', selected: true },
        detail_alignment: 'aligned',
        selection_window: 'visible',
      }),
    },
    '李女士'
  );

  assert.notEqual(result.status, 'selected');
  assert.equal(result.unresolved.reason, 'virtualized_window_changed');
});

test('select_live_item accepts navigation list transitions when the url changes after selection', async () => {
  let currentUrl = 'https://example.test/cgi-bin/home';
  const state = {
    pageState: {
      currentRole: 'navigation-heavy',
      workspaceSurface: 'list',
      domRevision: 0,
      graspConfidence: 'high',
      riskGateDetected: false,
    },
    handoff: { state: 'idle' },
  };

  const result = await selectWorkspaceItem(
    {
      state,
      page: {
        url: () => currentUrl,
      },
      snapshot: {
        workspace_surface: 'list',
        live_items: [
          { label: '发表记录', normalized_label: '发表记录', hint_id: 'N1', selected: false },
        ],
      },
      selectItemByHint: async () => {
        currentUrl = 'https://example.test/cgi-bin/appmsg';
        state.pageState.domRevision = 1;
        return { ok: true };
      },
      refreshSnapshot: async () => ({
        workspace_surface: 'list',
        live_items: [
          { label: '发表记录', normalized_label: '发表记录', hint_id: 'N2', selected: false },
        ],
        active_item: null,
        detail_alignment: 'unknown',
        selection_window: 'visible',
      }),
    },
    '发表记录'
  );

  assert.equal(result.status, 'selected');
  assert.equal(result.selected_item.label, '发表记录');
  assert.equal(result.selection_evidence.selection_window, 'visible');
});

test('select_live_item treats an already-selected navigation item as a successful no-op', async () => {
  let clicked = false;
  const state = {
    pageState: {
      currentRole: 'navigation-heavy',
      workspaceSurface: 'list',
      domRevision: 0,
      graspConfidence: 'high',
      riskGateDetected: false,
    },
    handoff: { state: 'idle' },
  };

  const result = await selectWorkspaceItem(
    {
      state,
      snapshot: {
        workspace_surface: 'list',
        live_items: [
          { label: '首页', normalized_label: '首页', hint_id: 'L2', selected: true },
          { label: '新的功能', normalized_label: '新的功能', hint_id: 'L3', selected: false },
        ],
      },
      selectItemByHint: async () => {
        clicked = true;
        return { ok: true };
      },
    },
    '首页'
  );

  assert.equal(clicked, false);
  assert.equal(result.status, 'selected');
  assert.equal(result.selected_item.label, '首页');
  assert.equal(result.active_item.label, '首页');
});

test('select_live_item returns virtualized_window_changed when the target is no longer confirmed after refresh', async () => {
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
        ],
      },
      selectItemByHint: async () => ({ ok: true }),
      refreshSnapshot: async () => ({
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: false },
        ],
        active_item: null,
        detail_alignment: 'unknown',
        selection_window: 'not_found',
      }),
    },
    '李女士'
  );

  assert.notEqual(result.status, 'selected');
  assert.equal(result.unresolved.reason, 'virtualized_window_changed');
});

test('select_live_item returns ambiguous_item when multiple visible items match', async () => {
  let clicked = false;
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
          { label: '李女士', normalized_label: '李女士', hint_id: 'L2' },
        ],
      },
      selectItemByHint: async () => {
        clicked = true;
        return { ok: true };
      },
    },
    '李女士'
  );

  assert.equal(clicked, false);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.unresolved.reason, 'ambiguous_item');
  assert.equal(result.unresolved.recovery_hint, 'scroll_list');
});

test('select_live_item returns not_in_visible_window when the target is not visible', async () => {
  let clicked = false;
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [{ label: '胡女士', normalized_label: '胡女士', hint_id: 'L2' }],
      },
      selectItemByHint: async () => {
        clicked = true;
        return { ok: true };
      },
    },
    '李女士'
  );

  assert.equal(clicked, false);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.unresolved.reason, 'not_in_visible_window');
  assert.equal(result.unresolved.recovery_hint, 'scroll_list');
});

test('select_live_item returns detail_panel_mismatch when the refreshed detail panel disagrees', async () => {
  const result = await selectWorkspaceItem(
    {
      snapshot: {
        live_items: [
          { label: '李女士', normalized_label: '李女士', hint_id: 'L1' },
        ],
      },
      selectItemByHint: async () => ({ ok: true }),
      refreshSnapshot: async () => ({
        live_items: [{ label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true }],
        active_item: { label: '李女士' },
        detail_alignment: 'mismatch',
        selection_window: 'visible',
      }),
    },
    '李女士'
  );

  assert.equal(result.status, 'unresolved');
  assert.equal(result.unresolved.reason, 'detail_panel_mismatch');
  assert.equal(result.unresolved.recovery_hint, 'reinspect_workspace');
});

test('selectItemByHint rejects the wrong same-label item when hint identity changes', async () => {
  const result = await selectItemByHint({
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: false },
        { label: '李女士', normalized_label: '李女士', selected: false },
      ],
    },
    clickByHintId: async () => ({ label: '李女士' }),
    refreshSnapshot: async () => ({
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: false },
        { label: '李女士', normalized_label: '李女士', selected: true },
      ],
      active_item: { label: '李女士', normalized_label: '李女士', selected: true },
      detail_alignment: 'aligned',
      selection_window: 'visible',
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    }),
  }, '李女士');

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'ACTION_NOT_VERIFIED');
});

test('selectItemByHint rejects label-only success when the hinted target scrolls out of view', async () => {
  const result = await selectItemByHint({
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: false },
        { label: '李女士', normalized_label: '李女士', selected: false },
      ],
    },
    clickByHintId: async () => ({ label: '李女士' }),
    refreshSnapshot: async () => ({
      workspace_surface: 'thread',
      loading_shell: false,
      live_items: [
        { label: '李女士', normalized_label: '李女士', selected: true },
      ],
      active_item: { label: '李女士', normalized_label: '李女士', selected: true },
      detail_alignment: 'aligned',
      selection_window: 'visible',
      composer: { kind: 'chat_composer', draft_present: false },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    }),
  }, '李女士');

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'ACTION_NOT_VERIFIED');
});

test('draftIntoComposer does not send when pressEnter is requested', async () => {
  const calls = [];
  let draftValue = '';
  const page = createFakePage({
    url: () => 'https://example.test/workspace',
    evaluate: async (fn, ...args) => {
      const previousDocument = globalThis.document;
      globalThis.document = {
        activeElement: {
          tagName: 'TEXTAREA',
          value: draftValue,
          innerText: draftValue,
          textContent: draftValue,
          isContentEditable: false,
        },
      };
      try {
        return fn(...args);
      } finally {
        globalThis.document = previousDocument;
      }
    },
  });
  const result = await draftIntoComposer({
    page,
    snapshot: {
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false },
      blocking_modals: [],
    },
    typeByHintId: async (page, hintId, text, pressEnter) => {
      calls.push({ hintId, text, pressEnter });
      draftValue = text;
    },
    refreshSnapshot: async () => ({
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: '你好' },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    }),
  }, '你好', { pressEnter: true });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ hintId: 'C1', text: '你好', pressEnter: false }]);
});

test('draftIntoComposer succeeds when fresh composer evidence confirms the draft write', async () => {
  const calls = [];
  const result = await draftIntoComposer({
    page: createFakePage({
      url: () => 'https://example.test/workspace',
      evaluate: async (fn, ...args) => {
        const previousDocument = globalThis.document;
        globalThis.document = {
          activeElement: {
            tagName: 'DIV',
            innerText: '',
            textContent: '',
            value: '',
            isContentEditable: false,
          },
        };
        try {
          return fn(...args);
        } finally {
          globalThis.document = previousDocument;
        }
      },
    }),
    snapshot: {
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false },
      blocking_modals: [],
    },
    typeByHintId: async (page, hintId, text, pressEnter) => {
      calls.push({ hintId, text, pressEnter });
    },
    refreshSnapshot: async () => ({
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: '你好' },
      blocking_modals: [],
      outcome_signals: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    }),
  }, '你好');

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ hintId: 'C1', text: '你好', pressEnter: false }]);
});

test('draftIntoComposer returns loading_shell when the workspace is loading', async () => {
  const result = await draftIntoComposer({
    snapshot: {
      loading_shell: true,
      workspace_surface: 'loading_shell',
    },
  }, '你好');

  assert.equal(result.ok, false);
  assert.equal(result.unresolved.reason, 'loading_shell');
});

test('draftIntoComposer returns no_live_target when no composer is visible', async () => {
  const result = await draftIntoComposer({
    snapshot: {
      workspace_surface: 'composer',
      loading_shell: false,
      composer: null,
    },
  }, '你好');

  assert.equal(result.ok, false);
  assert.equal(result.unresolved.reason, 'no_live_target');
});

test('draftIntoComposer returns no_live_target when composer has no hint', async () => {
  const result = await draftIntoComposer({
    snapshot: {
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', draft_present: false },
    },
  }, '你好');

  assert.equal(result.ok, false);
  assert.equal(result.unresolved.reason, 'no_live_target');
});

test('draftWorkspaceAction reuses the fresh snapshot returned by draftIntoComposer without a second refresh', async () => {
  const writes = [];
  let refreshCalls = 0;
  const result = await draftWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'composer',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false },
    },
    draftIntoComposer: async (_runtime, text) => {
      writes.push(text);
      return {
        ok: true,
        snapshot: {
          workspace_surface: 'composer',
          loading_shell: false,
          composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: true, draft_text: '您好，我想咨询一下岗位情况。' },
        },
      };
    },
    refreshSnapshot: async () => {
      refreshCalls += 1;
      return {
        workspace_surface: 'composer',
        loading_shell: false,
        composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false, draft_text: '' },
      };
    },
  }, '您好，我想咨询一下岗位情况。');

  assert.deepEqual(writes, ['您好，我想咨询一下岗位情况。']);
  assert.equal(refreshCalls, 0);
  assert.equal(result.status, 'drafted');
  assert.equal(result.snapshot.composer.draft_present, true);
  assert.equal(result.draft_evidence.autosave_possible, true);
  assert.equal(result.draft_evidence.draft_present, true);
});

test('draftWorkspaceAction returns blocked with a gateway reason when the workspace is not direct', async () => {
  let drafted = false;
  const result = await draftWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: true },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      composer: { kind: 'chat_composer', hint_id: 'C1', draft_present: false },
    },
    draftIntoComposer: async () => {
      drafted = true;
      return { ok: true };
    },
  }, '你好');

  assert.equal(drafted, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'gated');
  assert.equal(result.action.status, 'blocked');
  assert.equal(result.snapshot.composer.draft_present, false);
});

test('executeWorkspaceAction preview blocks without clicking', async () => {
  let executed = false;

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
    },
    executeGuardedAction: async () => {
      executed = true;
      return { ok: true };
    },
    verifyActionOutcome: async () => {
      throw new Error('preview should not verify');
    },
  }, { action: 'send', mode: 'preview' });

  assert.equal(executed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'preview_safe');
  assert.equal(result.action.status, 'blocked');
});

test('executeWorkspaceAction confirm requires EXECUTE before clicking', async () => {
  let executed = false;

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
    },
    executeGuardedAction: async () => {
      executed = true;
      return { ok: true };
    },
    verifyActionOutcome: async () => {
      throw new Error('confirmation should block');
    },
  }, { action: 'send', mode: 'confirm', confirmation: 'NOPE' });

  assert.equal(executed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'confirmation_required');
  assert.equal(result.action.status, 'blocked');
});

test('executeWorkspaceAction confirm blocks when workspace is not ready to execute', async () => {
  const cases = [
    {
      name: 'loading_shell',
      snapshot: {
        workspace_surface: 'thread',
        loading_shell: true,
        blocking_modals: [],
        composer: { kind: 'chat_composer', draft_present: true },
        active_item: { label: '李女士' },
        live_items: [{ label: '李女士', selected: true }],
        action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
        summary: { active_item_label: '李女士', draft_present: true, loading_shell: true },
      },
    },
    {
      name: 'blocking_modal',
      snapshot: {
        workspace_surface: 'thread',
        loading_shell: false,
        blocking_modals: [{ label: '权限提示' }],
        composer: { kind: 'chat_composer', draft_present: true },
        active_item: { label: '李女士' },
        live_items: [{ label: '李女士', selected: true }],
        action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
        summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
      },
    },
    {
      name: 'missing_draft',
      snapshot: {
        workspace_surface: 'thread',
        loading_shell: false,
        blocking_modals: [],
        composer: { kind: 'chat_composer', draft_present: false },
        active_item: { label: '李女士' },
        live_items: [{ label: '李女士', selected: true }],
        action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
        summary: { active_item_label: '李女士', draft_present: false, loading_shell: false },
      },
    },
    {
      name: 'unstable_active_item',
      snapshot: {
        workspace_surface: 'thread',
        loading_shell: false,
        blocking_modals: [],
        composer: { kind: 'chat_composer', draft_present: true },
        active_item: { label: '李女士' },
        live_items: [{ label: '李女士', selected: true }],
        action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
        summary: {
          active_item_label: '李女士',
          draft_present: true,
          loading_shell: false,
          outcome_signals: { active_item_stable: false },
        },
      },
    },
  ];

  for (const testCase of cases) {
    let clicked = false;

    const result = await executeWorkspaceAction({
      state: {
        pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
        handoff: { state: 'idle' },
      },
      snapshot: testCase.snapshot,
      clickByHintId: async () => {
        clicked = true;
        return { ok: true };
      },
      executeGuardedAction: async () => ({ ok: true }),
      verifyActionOutcome: async () => ({ ok: true, evidence: { generic: true } }),
    }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

    assert.equal(clicked, false, testCase.name);
    assert.notEqual(result.action.status, 'executed', testCase.name);
    assert.equal(result.blocked === true || result.status === 'unresolved', true, testCase.name);
  }
});

test('executeWorkspaceAction confirm with EXECUTE returns success when outcome is verified', async () => {
  let executed = false;

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
    },
    clickByHintId: async () => ({ ok: true }),
    executeGuardedAction: async ({ execute, verify }) => {
      executed = true;
      const executionResult = await execute();
      return verify({
        executionResult,
        snapshot: {
          workspace_surface: 'thread',
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          composer: { kind: 'chat_composer', draft_present: false },
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          outcome_signals: {
            delivered: true,
            composer_cleared: true,
            active_item_stable: true,
          },
          summary: { active_item_label: '李女士', draft_present: false, loading_shell: false, active_item_stable: true },
        },
      });
    },
    verifyActionOutcome: async () => ({
      ok: true,
      evidence: {
        delivered: true,
        composer_cleared: true,
        active_item_stable: true,
      },
    }),
  }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

  assert.equal(executed, true);
  assert.equal(result.status, 'success');
  assert.equal(result.executed, true);
  assert.equal(result.action.status, 'executed');
  assert.equal(result.verification.delivered, true);
});

test('executeWorkspaceAction returns failed when the outcome cannot be verified', async () => {
  let executed = false;

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
    },
    clickByHintId: async () => ({ ok: true }),
    executeGuardedAction: async ({ execute, verify }) => {
      executed = true;
      const executionResult = await execute();
      return verify({
        executionResult,
        snapshot: {
          workspace_surface: 'thread',
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          composer: { kind: 'chat_composer', draft_present: true },
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          outcome_signals: {
            delivered: false,
            composer_cleared: false,
            active_item_stable: false,
          },
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
        },
      });
    },
    verifyActionOutcome: async () => ({
      ok: false,
      error_code: 'ACTION_NOT_VERIFIED',
      retryable: true,
      suggested_next_step: 'reverify',
      evidence: {
        delivered: false,
        composer_cleared: false,
        active_item_stable: false,
      },
    }),
  }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

  assert.equal(executed, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.action.status, 'failed');
  assert.equal(result.failure.error_code, 'ACTION_NOT_VERIFIED');
});

test('executeWorkspaceAction fails when only active_item_stable is present without send-specific outcome', async () => {
  let executed = false;

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
    },
    clickByHintId: async () => ({ ok: true }),
    executeGuardedAction: async ({ execute, verify }) => {
      executed = true;
      const executionResult = await execute();
      return verify({
        executionResult,
        snapshot: {
          workspace_surface: 'thread',
          action_controls: [{ label: '发送', action_kind: 'send', hint_id: 'B1' }],
          composer: { kind: 'chat_composer', draft_present: true },
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          outcome_signals: {
            delivered: false,
            composer_cleared: false,
            active_item_stable: true,
          },
          summary: { active_item_label: '李女士', draft_present: true, loading_shell: false, active_item_stable: true },
        },
      });
    },
    verifyActionOutcome: async () => ({
      ok: true,
      evidence: { generic: true },
    }),
  }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

  assert.equal(executed, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.action.status, 'failed');
  assert.equal(result.failure.error_code, 'ACTION_NOT_VERIFIED');
});

test('executeWorkspaceAction clicks only the reliable send control and skips label-only controls', async () => {
  const clicked = [];

  const result = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      action_controls: [
        { label: '发送', action_kind: 'button', hint_id: 'B0' },
        { label: '提交', action_kind: 'button', hint_id: 'B2' },
        { label: '发送', action_kind: 'send', hint_id: 'B1' },
      ],
      summary: {
        active_item_label: '李女士',
        draft_present: true,
        loading_shell: false,
        outcome_signals: { active_item_stable: true },
      },
    },
    clickByHintId: async (_page, hintId) => {
      clicked.push(hintId);
      return { ok: true };
    },
    executeGuardedAction: async ({ execute, verify }) => {
      const executionResult = await execute();
      return verify({
        executionResult,
        snapshot: {
          workspace_surface: 'thread',
          loading_shell: false,
          blocking_modals: [],
          composer: { kind: 'chat_composer', draft_present: false },
          live_items: [{ label: '李女士', selected: true }],
          active_item: { label: '李女士' },
          outcome_signals: {
            delivered: true,
            composer_cleared: true,
            active_item_stable: true,
          },
          summary: {
            active_item_label: '李女士',
            draft_present: false,
            loading_shell: false,
            outcome_signals: { active_item_stable: true },
          },
        },
      });
    },
    verifyActionOutcome: async () => ({ ok: true, evidence: { delivered: true } }),
  }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

  assert.deepEqual(clicked, ['B1']);
  assert.equal(result.status, 'success');

  const unresolved = await executeWorkspaceAction({
    state: {
      pageState: { currentRole: 'workspace', workspaceSurface: 'thread', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
    },
    snapshot: {
      workspace_surface: 'thread',
      loading_shell: false,
      blocking_modals: [],
      composer: { kind: 'chat_composer', draft_present: true },
      live_items: [{ label: '李女士', selected: true }],
      active_item: { label: '李女士' },
      action_controls: [
        { label: '发送', action_kind: 'button', hint_id: 'B0' },
        { label: '提交', action_kind: 'button', hint_id: 'B2' },
      ],
      summary: {
        active_item_label: '李女士',
        draft_present: true,
        loading_shell: false,
        outcome_signals: { active_item_stable: true },
      },
    },
    clickByHintId: async () => {
      throw new Error('should not click');
    },
  }, { action: 'send', mode: 'confirm', confirmation: 'EXECUTE' });

  assert.equal(unresolved.status, 'unresolved');
  assert.equal(unresolved.unresolved.reason, 'no_live_target');
});
