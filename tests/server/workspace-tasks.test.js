import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';
import {
  classifyWorkspaceSurface,
  collectVisibleWorkspaceSnapshot,
  buildWorkspaceVerification,
  summarizeWorkspaceSnapshot,
  deriveWorkspaceHintItems,
} from '../../src/server/workspace-tasks.js';

function createMockElement({
  tagName = 'div',
  attrs = {},
  textContent = '',
  value = '',
  rect = { width: 100, height: 20 },
  classNames = [],
  queryMap = {},
} = {}) {
  return {
    tagName: tagName.toUpperCase(),
    textContent,
    value,
    getBoundingClientRect: () => rect,
    getAttribute: (name) => attrs[name] ?? null,
    classList: {
      contains: (className) => classNames.includes(className),
    },
    matches: (selector) => selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => {
        if (part === 'li') return tagName === 'li';
        if (part === 'a') return tagName === 'a';
        if (part === 'textarea') return tagName === 'textarea';
        if (part === 'input:not([type="hidden"])') return tagName === 'input' && attrs.type !== 'hidden';
        if (part === '[contenteditable="true"]') return attrs.contenteditable === 'true';
        if (part === '[role="textbox"]') return attrs.role === 'textbox';
        if (part === 'button') return tagName === 'button';
        if (part === '[role="button"]') return attrs.role === 'button';
        if (part === '[role="link"]') return attrs.role === 'link';
        if (part === '[role="menuitem"]') return attrs.role === 'menuitem';
        if (part === '[role="tab"]') return attrs.role === 'tab';
        if (part === 'input[type="submit"]') return tagName === 'input' && attrs.type === 'submit';
        if (part === 'input[type="button"]') return tagName === 'input' && attrs.type === 'button';
        if (part === '[role="option"]') return attrs.role === 'option';
        if (part === '[role="row"]') return attrs.role === 'row';
        if (part === '[role="treeitem"]') return attrs.role === 'treeitem';
        if (part === '[data-list-item]') return attrs['data-list-item'] !== undefined;
        if (part === '[data-thread-item]') return attrs['data-thread-item'] !== undefined;
        if (part === '[data-conversation-item]') return attrs['data-conversation-item'] !== undefined;
        if (part === '[role="dialog"]') return attrs.role === 'dialog';
        if (part === '[aria-modal="true"]') return attrs['aria-modal'] === 'true';
        if (part === 'dialog[open]') return tagName === 'dialog' && attrs.open === true;
        if (part === '[data-detail-panel]') return attrs['data-detail-panel'] !== undefined;
        if (part === '[role="complementary"]') return attrs.role === 'complementary';
        if (part === '[role="navigation"]') return attrs.role === 'navigation';
        if (part === '[role="menu"]') return attrs.role === 'menu';
        if (part === '[role="tablist"]') return attrs.role === 'tablist';
        if (part === 'nav') return tagName === 'nav';
        if (part === 'header') return tagName === 'header';
        if (part === '.detail-panel') return classNames.includes('detail-panel');
        if (part === 'aside') return tagName === 'aside';
        return false;
      }),
    closest: (selector) => (attrs.closestMatches?.includes(selector) ? {} : null),
    querySelector: (selector) => queryMap[selector] ?? null,
  };
}

function createDomPage({ bodyText = '', queryAllMap = {}, queryMap = {} } = {}) {
  const document = {
    body: { innerText: bodyText },
    querySelectorAll: (selector) => queryAllMap[selector] ?? [],
    querySelector: (selector) => queryMap[selector] ?? null,
    getElementById: () => null,
  };
  const window = {
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  };

  return createFakePage({
    evaluate: async (fn, ...args) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = document;
      globalThis.window = window;
      try {
        return fn(...args);
      } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
      }
    },
  });
}

function createIsolatedDomPage({ bodyText = '', queryAllMap = {}, queryMap = {} } = {}) {
  const document = {
    body: { innerText: bodyText },
    querySelectorAll: (selector) => queryAllMap[selector] ?? [],
    querySelector: (selector) => queryMap[selector] ?? null,
    getElementById: () => null,
  };
  const window = {
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  };

  return createFakePage({
    evaluate: async (fn, ...args) => {
      const isolatedFn = new Function(
        'args',
        'document',
        'window',
        `return (${fn.toString()})(...args);`
      );
      return isolatedFn(args, document, window);
    },
  });
}

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
    blocking_modals: [{ label: '权限提示' }],
    loading_shell: false,
  });

  assert.equal(summary.active_item_label, '李女士');
  assert.equal(summary.draft_present, false);
  assert.equal(summary.loading_shell, false);
  assert.equal(summary.blocking_modal_count, 1);
  assert.deepEqual(summary.blocking_modal_labels, ['权限提示']);
});

test('summarizeWorkspaceSnapshot prefers raw snapshot fields when they already exist', () => {
  const summary = summarizeWorkspaceSnapshot({
    workspace_surface: 'thread',
    active_item: { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true },
    detail_alignment: 'aligned',
    selection_window: 'visible',
    recovery_hint: 'scroll_list',
    outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.active_item_label, '李女士');
  assert.equal(summary.detail_alignment, 'aligned');
  assert.equal(summary.selection_window, 'visible');
  assert.equal(summary.recovery_hint, 'scroll_list');
  assert.deepEqual(summary.outcome_signals, {
    delivered: false,
    composer_cleared: false,
    active_item_stable: true,
  });
});

test('summarizeWorkspaceSnapshot does not guess an active item from multiple candidates', () => {
  const summary = summarizeWorkspaceSnapshot({
    workspace_surface: 'thread',
    live_items: [
      { label: '李女士', selected: true },
      { label: '王先生', selected: true },
    ],
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.active_item_label, null);
});

test('deriveWorkspaceHintItems preserves selected/current navigation hints', () => {
  const items = deriveWorkspaceHintItems([
    { id: 'L1', type: 'a', label: '公众号', x: 128, y: 48, meta: { selected: false } },
    { id: 'L2', type: 'a', label: '首页', x: 108, y: 111, meta: { selected: true, ariaCurrent: 'page' } },
    { id: 'L3', type: 'a', label: '新的功能', x: 108, y: 598, meta: { selected: false } },
  ]);

  assert.deepEqual(items.map((item) => ({ label: item.label, selected: item.selected })), [
    { label: '公众号', selected: false },
    { label: '首页', selected: true },
    { label: '新的功能', selected: false },
  ]);
});

test('collectVisibleWorkspaceSnapshot ignores a generic textbox', async () => {
  const page = createDomPage({
    bodyText: '搜索',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [
        createMockElement({
          tagName: 'input',
          attrs: {
            type: 'search',
            placeholder: '搜索',
          },
        }),
      ],
      'button, [role="button"], input[type="submit"], input[type="button"]': [],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': null,
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page);

  assert.equal(snapshot.composer, null);
  assert.notEqual(snapshot.workspace_surface, 'composer');
});

test('collectVisibleWorkspaceSnapshot ignores generic loading copy without a visible shell', async () => {
  const page = createDomPage({
    bodyText: 'please wait',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [],
      'button, [role="button"], input[type="submit"], input[type="button"]': [],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': createMockElement({
        tagName: 'div',
        rect: { width: 0, height: 0 },
        classNames: ['spinner'],
      }),
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page);

  assert.equal(snapshot.loading_shell, false);
});

test('collectVisibleWorkspaceSnapshot captures a stable thread surface shape', async () => {
  const detailHeading = createMockElement({
    tagName: 'h2',
    textContent: '李女士',
  });
  const detailPanel = createMockElement({
    tagName: 'aside',
    classNames: ['detail-panel'],
    queryMap: {
      'h1, h2, h3, h4, h5, h6': detailHeading,
    },
  });

  const page = createDomPage({
    bodyText: '李女士 人工智能训练师 按Enter键发送',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [
        createMockElement({
          tagName: 'li',
          attrs: {
            'data-list-item': 'true',
          },
          textContent: '李女士',
          classNames: ['selected'],
        }),
      ],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [
        createMockElement({
          tagName: 'textarea',
          attrs: {
            placeholder: '按Enter键发送',
          },
          textContent: '',
        }),
      ],
      'button, [role="button"], input[type="submit"], input[type="button"]': [
        createMockElement({
          tagName: 'button',
          textContent: '发送',
        }),
      ],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
      '[aria-busy="true"], .loading, .skeleton, .spinner': [],
      '[data-detail-panel], [role="complementary"], .detail-panel, aside': [detailPanel],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': null,
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page);

  assert.equal(snapshot.workspace_surface, 'thread');
  assert.equal(snapshot.live_items.length, 1);
  assert.equal(snapshot.active_item.label, '李女士');
  assert.equal(snapshot.action_controls.length, 1);
  assert.equal(snapshot.composer.kind, 'chat_composer');
  assert.equal(snapshot.detail_alignment, 'aligned');
});

test('collectVisibleWorkspaceSnapshot prefers leaf nav items over grouped containers', async () => {
  const navLeaf = createMockElement({
    tagName: 'a',
    attrs: {
      class: 'weui-desktop-menu__link weui-desktop-menu__link_current',
      closestMatches: ['nav, [role="navigation"], [role="menu"], [role="tablist"]'],
    },
    textContent: '首页',
  });
  const groupedContainer = createMockElement({
    tagName: 'li',
    attrs: {
      'data-list-item': 'true',
    },
    textContent: '内容管理 草稿箱 素材库 发表记录',
    queryMap: {
      'a, [role="link"], [role="menuitem"], [role="tab"], button, [role="button"]': navLeaf,
    },
  });

  const page = createDomPage({
    bodyText: '首页 内容管理 草稿箱 素材库 发表记录',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [
        groupedContainer,
      ],
      'a, [role="link"], [role="menuitem"], [role="tab"], button, [role="button"]': [
        navLeaf,
      ],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [],
      'button, [role="button"], input[type="submit"], input[type="button"]': [],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
      '[data-detail-panel], [role="complementary"], .detail-panel, aside': [],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': null,
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page);

  assert.equal(snapshot.workspace_surface, 'list');
  assert.deepEqual(snapshot.live_items.map((item) => item.label), ['首页']);
  assert.equal(snapshot.live_items[0]?.selected, true);
  assert.equal(snapshot.active_item?.label, '首页');
});

test('collectVisibleWorkspaceSnapshot merges left-rail hint items when the DOM list misses them', async () => {
  const page = createDomPage({
    bodyText: '首页 创作周报 全部发表记录',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [
        createMockElement({
          tagName: 'li',
          attrs: {
            'data-list-item': 'true',
          },
          textContent: '你的创作周报已生成',
        }),
      ],
      'a, [role="link"], [role="menuitem"], [role="tab"], button, [role="button"]': [],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [],
      'button, [role="button"], input[type="submit"], input[type="button"]': [],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
      '[data-detail-panel], [role="complementary"], .detail-panel, aside': [],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': null,
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page, {
    hintMap: [
      { id: 'L1', type: 'a', label: '公众号', x: 128, y: 48, meta: { selected: false } },
      { id: 'L2', type: 'a', label: '首页', x: 108, y: 111, meta: { selected: true, ariaCurrent: 'page' } },
      { id: 'L3', type: 'a', label: '新的功能', x: 108, y: 598, meta: { selected: false } },
    ],
  });

  assert.equal(snapshot.workspace_surface, 'list');
  assert.deepEqual(snapshot.live_items.slice(0, 2).map((item) => item.label), ['公众号', '首页']);
  assert.equal(snapshot.active_item?.label, '首页');
  assert.equal(snapshot.live_items.find((item) => item.label === '首页')?.selected, true);
  assert.equal(snapshot.summary.active_item_label, '首页');
  assert.equal(snapshot.summary.selection_window, 'visible');
  assert.ok(snapshot.live_items.some((item) => item.label === '你的创作周报已生成'));
});

test('collectVisibleWorkspaceSnapshot keeps success signal helpers self-contained in browser context', async () => {
  const page = createIsolatedDomPage({
    bodyText: 'Message sent',
    queryAllMap: {
      'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]': [],
      'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]': [],
      'button, [role="button"], input[type="submit"], input[type="button"]': [],
      '[role="dialog"], [aria-modal="true"], dialog[open]': [],
      '[aria-busy="true"], .loading, .skeleton, .spinner': [],
      '[data-detail-panel], [role="complementary"], .detail-panel, aside': [],
    },
    queryMap: {
      '[aria-busy="true"], .loading, .skeleton, .spinner': null,
    },
  });

  const snapshot = await collectVisibleWorkspaceSnapshot(page);

  assert.equal(snapshot.outcome_signals.delivered, true);
  assert.equal(snapshot.outcome_signals.composer_cleared, true);
});

test('summarizeWorkspaceSnapshot does not treat consent or present as delivered', () => {
  const consentSummary = summarizeWorkspaceSnapshot({
    bodyText: 'consent required',
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  const presentSummary = summarizeWorkspaceSnapshot({
    bodyText: 'present in workspace',
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(consentSummary.outcome_signals.delivered, false);
  assert.equal(consentSummary.outcome_signals.composer_cleared, false);
  assert.equal(presentSummary.outcome_signals.delivered, false);
  assert.equal(presentSummary.outcome_signals.composer_cleared, false);
});

test('summarizeWorkspaceSnapshot keeps empty composer cleared state conservative', () => {
  const summary = summarizeWorkspaceSnapshot({
    composer: { kind: 'chat_composer', draft_present: false, draft_text: '' },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.outcome_signals.composer_cleared, false);
});

test('summarizeWorkspaceSnapshot keeps selection window not_found with only raw active item', () => {
  const summary = summarizeWorkspaceSnapshot({
    workspace_surface: 'thread',
    active_item: { label: '李女士', normalized_label: '李女士', hint_id: 'L1', selected: true },
    composer: { kind: 'chat_composer', draft_present: false },
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.selection_window, 'not_found');
});

test('summarizeWorkspaceSnapshot keeps active item unstable when selection window is not_found', () => {
  const summary = summarizeWorkspaceSnapshot({
    active_item: { label: 'Thread A', normalized_label: 'thread a', hint_id: 'L1', selected: true },
    detail_alignment: 'aligned',
    blocking_modals: [],
    loading_shell: false,
  });

  assert.equal(summary.selection_window, 'not_found');
  assert.equal(summary.outcome_signals.active_item_stable, false);
});

test('buildWorkspaceVerification returns active item, draft, delivery, blocking, and readiness fields', () => {
  const cases = [
    {
      name: 'blocking_modal',
      snapshot: {
        workspace_surface: 'thread',
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        outcome_signals: { delivered: true, composer_cleared: true, active_item_stable: true },
        blocking_modals: [{ label: '权限提示' }],
        loading_shell: false,
        detail_alignment: 'aligned',
      },
      expected: 'workspace_inspect',
    },
    {
      name: 'missing_send',
      snapshot: {
        workspace_surface: 'thread',
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '取消', action_kind: 'dismiss' }],
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
      },
      expected: 'draft_action',
    },
    {
      name: 'unstable_active_item',
      snapshot: {
        workspace_surface: 'thread',
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '发送', action_kind: 'send' }],
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: false },
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
      },
      expected: 'workspace_inspect',
    },
    {
      name: 'no_composer',
      snapshot: {
        workspace_surface: 'thread',
        active_item: { label: '李女士' },
        composer: null,
        action_controls: [{ label: '发送', action_kind: 'send' }],
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
      },
      expected: 'workspace_inspect',
    },
    {
      name: 'draft_ready',
      snapshot: {
        workspace_surface: 'thread',
        active_item: { label: '李女士' },
        composer: { kind: 'chat_composer', draft_present: false },
        action_controls: [{ label: '取消', action_kind: 'dismiss' }],
        outcome_signals: { delivered: false, composer_cleared: false, active_item_stable: true },
        blocking_modals: [],
        loading_shell: false,
        detail_alignment: 'aligned',
      },
      expected: 'draft_action',
    },
  ];

  for (const testCase of cases) {
    const result = buildWorkspaceVerification(testCase.snapshot);

    assert.equal(result.active_item_label, '李女士', testCase.name);
    assert.equal(result.draft_present, false, testCase.name);
    assert.equal(result.loading_shell, false, testCase.name);
    assert.equal(result.blocking_modal_present, testCase.name === 'blocking_modal', testCase.name);
    assert.equal(result.detail_alignment, 'aligned', testCase.name);
    assert.equal(result.ready_for_next_action, testCase.expected, testCase.name);
  }
});
