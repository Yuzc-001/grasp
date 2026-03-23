import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWorkspaceSurface,
  summarizeWorkspaceSnapshot,
} from '../../src/server/workspace-tasks.js';

test('classifyWorkspaceSurface prefers loading shell, thread, composer, then list/detail', () => {
  assert.equal(classifyWorkspaceSurface({
    bodyText: '加载中，请稍候',
    liveItems: [],
    composer: null,
    actionControls: [],
  }), 'loading_shell');

  assert.equal(classifyWorkspaceSurface({
    bodyText: '李女士 人工智能训练师 按Enter键发送',
    liveItems: [{ label: '李女士' }],
    composer: { kind: 'chat_composer', empty: true },
    actionControls: [{ label: '发送' }],
  }), 'thread');
});

test('summarizeWorkspaceSnapshot reports active item, draft state, and blockers', () => {
  const summary = summarizeWorkspaceSnapshot({
    workspace_surface: 'thread',
    live_items: [{ label: '李女士', selected: true }],
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.active_item_label, '李女士');
  assert.equal(summary.draft_present, false);
  assert.equal(summary.loading_shell, false);
});
