import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkspaceSnapshotView,
  toPublicSelectionEvidence,
  toPublicDraftEvidence,
  toPublicExecuteFailure,
  toPublicSelectionUnresolved,
  toPublicDraftUnresolved,
  toPublicExecuteUnresolved,
} from '../../src/server/tools.workspace.view.js';

test('workspace view adapters build public workspace snapshot and redact runtime-only fields', () => {
  const view = buildWorkspaceSnapshotView({
    workspace_surface: 'thread',
    live_items: [{ label: ' 李女士 ', selected: true, hint_id: 'L1', normalized_label: '李女士' }],
    active_item: { label: ' 李女士 ', hint_id: 'L1' },
    composer: { kind: 'chat_composer', draft_present: true, draft_text: '你好' },
    action_controls: [{ label: ' 发送 ', action_kind: 'send', hint_id: 'B1' }],
    blocking_modals: [{ label: ' 权限提示 ', hint_id: 'M1' }],
    loading_shell: false,
    summary: { active_item_label: '李女士', draft_present: true, loading_shell: false },
  });

  assert.equal(view.workspaceSurface, 'thread');
  assert.deepEqual(view.workspace.live_items, [{ label: '李女士', selected: true }]);
  assert.deepEqual(view.workspace.active_item, { label: '李女士' });
  assert.deepEqual(view.workspace.composer, { kind: 'chat_composer', draft_present: true });
  assert.deepEqual(view.workspace.action_controls, [{ label: '发送', action_kind: 'send' }]);
  assert.deepEqual(view.workspace.blocking_modals, [{ label: '权限提示' }]);
  assert.equal(view.workspace.live_items[0].hint_id, undefined);
  assert.equal(view.workspace.composer.draft_text, undefined);
});

test('workspace view adapters map runtime evidence and unresolved payloads to public shapes', () => {
  assert.deepEqual(
    toPublicSelectionEvidence({
      requested_label: ' 李女士 ',
      selected_item: { label: ' 李女士 ', selected: false, hint_id: 'L1' },
      active_item: { label: ' 李女士 ', hint_id: 'L1' },
      detail_alignment: 'aligned',
      selection_window: 'visible',
      recovery_hint: 'retry_selection',
      match_count: 1,
      summary: 'selected',
    }, true),
    {
      requested_label: '李女士',
      selected_item: { label: '李女士', selected: true },
      active_item: { label: '李女士' },
      detail_alignment: 'aligned',
      selection_window: 'visible',
      recovery_hint: 'retry_selection',
      match_count: 1,
      summary: 'selected',
    }
  );

  assert.deepEqual(toPublicDraftEvidence({ draft_present: true }), {
    kind: 'draft_action',
    target: 'chat_composer',
    autosave_possible: false,
    write_side_effect: 'draft_mutation_possible',
    draft_present: true,
    summary: null,
  });

  assert.deepEqual(toPublicExecuteFailure({ error_code: 'SEND_FAILED', retryable: true }), {
    error_code: 'SEND_FAILED',
    retryable: true,
    suggested_next_step: null,
  });

  assert.deepEqual(toPublicSelectionUnresolved({ requested_label: ' 李女士 ' }), {
    reason: 'unknown',
    requested_label: '李女士',
    recovery_hint: null,
  });

  assert.deepEqual(toPublicDraftUnresolved({ requested_label: ' 李女士 ' }), {
    reason: 'unknown',
    requested_label: '李女士',
    recovery_hint: null,
  });

  assert.deepEqual(toPublicExecuteUnresolved({ requested_label: ' 李女士 ' }), {
    reason: 'unknown',
    requested_label: '李女士',
    recovery_hint: null,
  });
});
