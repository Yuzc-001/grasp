import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLiveItem,
  resolveComposer,
  createWorkspaceWriteEvidence,
  executeGuardedAction,
  selectItemByHint,
  draftIntoComposer,
  verifyActionOutcome,
} from '../../src/server/workspace-runtime.js';
import { createFakePage } from '../helpers/fake-page.js';

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
