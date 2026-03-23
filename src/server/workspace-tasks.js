function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return compactText(value).toLowerCase();
}

function pick(snapshot, camelKey, snakeKey, fallback = null) {
  if (snapshot?.[camelKey] !== undefined) return snapshot[camelKey];
  if (snapshot?.[snakeKey] !== undefined) return snapshot[snakeKey];
  return fallback;
}

function pickText(snapshot, camelKey, snakeKey, fallback = '') {
  return compactText(pick(snapshot, camelKey, snakeKey, fallback));
}

function getLiveItems(snapshot) {
  const items = pick(snapshot, 'liveItems', 'live_items', []);
  return Array.isArray(items) ? items : [];
}

function getComposer(snapshot) {
  const composer = pick(snapshot, 'composer', 'composer', null);
  return composer && typeof composer === 'object' ? composer : null;
}

function getActionControls(snapshot) {
  const controls = pick(snapshot, 'actionControls', 'action_controls', []);
  return Array.isArray(controls) ? controls : [];
}

function getBlockingModals(snapshot) {
  const modals = pick(snapshot, 'blockingModals', 'blocking_modals', []);
  return Array.isArray(modals) ? modals : [];
}

function getDetailPanel(snapshot) {
  const detailPanel = pick(snapshot, 'detailPanel', 'detail_panel', null);
  return detailPanel && typeof detailPanel === 'object' ? detailPanel : null;
}

function getLoadingShell(snapshot) {
  const loadingShell = pick(snapshot, 'loadingShell', 'loading_shell', false);
  return loadingShell === true;
}

function isSelectedItem(item) {
  return item?.selected === true
    || item?.active === true
    || item?.current === true
    || item?.aria_selected === true
    || item?.['aria-selected'] === true;
}

function hasThreadEvidence(snapshot) {
  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  const composer = getComposer(snapshot);
  const actionControls = getActionControls(snapshot);
  const liveItems = getLiveItems(snapshot);

  if (bodyText.includes('加载中，请稍候') || bodyText.includes('loading')) {
    return false;
  }

  if (bodyText.includes('按enter键发送') || bodyText.includes('发送消息') || bodyText.includes('发消息') || bodyText.includes('输入消息')) {
    return true;
  }

  if (bodyText.includes('聊天') || bodyText.includes('对话') || bodyText.includes('消息')) {
    return true;
  }

  if (liveItems.some(isSelectedItem) && actionControls.some((control) => normalizeLabel(control?.label).includes('发送'))) {
    return true;
  }

  return false;
}

function hasComposerEvidence(snapshot) {
  const composer = getComposer(snapshot);
  if (!composer) return false;
  return composer.draft_present === true
    || compactText(composer.draft_text)
    || composer.kind === 'chat_composer'
    || composer.kind === 'composer';
}

export function classifyWorkspaceSurface(snapshot = {}) {
  if (getLoadingShell(snapshot)) {
    return 'loading_shell';
  }

  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  if (bodyText.includes('加载中') || bodyText.includes('请稍候') || bodyText.includes('loading') || bodyText.includes('please wait')) {
    return 'loading_shell';
  }

  if (hasThreadEvidence(snapshot)) {
    return 'thread';
  }

  if (hasComposerEvidence(snapshot)) {
    return 'composer';
  }

  const detailPanel = getDetailPanel(snapshot);
  if (detailPanel) {
    return 'detail';
  }

  if (getLiveItems(snapshot).length > 0) {
    return 'list';
  }

  return pick(snapshot, 'workspaceSurface', 'workspace_surface', null);
}

function getVisibleItemLabel(item) {
  return compactText(item?.label || item?.normalized_label || item?.text || '');
}

function getSelectedLiveItem(liveItems) {
  const selected = liveItems.filter(isSelectedItem);
  if (selected.length !== 1) return null;
  return selected[0];
}

function getActiveItem(snapshot, liveItems, detailPanel) {
  const selectedLiveItem = getSelectedLiveItem(liveItems);
  if (selectedLiveItem) {
    return {
      label: getVisibleItemLabel(selectedLiveItem),
      normalized_label: normalizeLabel(getVisibleItemLabel(selectedLiveItem)),
      hint_id: selectedLiveItem.hint_id ?? selectedLiveItem.hintId ?? null,
      selected: true,
    };
  }

  return null;
}

function getDetailAlignment(activeItem, detailPanel) {
  const detailLabel = getVisibleItemLabel(detailPanel);
  if (!activeItem || !detailLabel) {
    return 'unknown';
  }

  return normalizeLabel(activeItem.label) === normalizeLabel(detailLabel) ? 'aligned' : 'mismatch';
}

function getSelectionWindow(activeItem, detailPanel, liveItems) {
  if (!activeItem) {
    if (detailPanel && liveItems.length > 0) {
      return 'virtualized';
    }
    return 'not_found';
  }

  const hasVisibleMatch = liveItems.some((item) => normalizeLabel(getVisibleItemLabel(item)) === normalizeLabel(activeItem.label));
  if (hasVisibleMatch && isSelectedItem(liveItems.find((item) => normalizeLabel(getVisibleItemLabel(item)) === normalizeLabel(activeItem.label)))) {
    return 'visible';
  }

  if (detailPanel) {
    return 'virtualized';
  }

  return 'visible';
}

function getRecoveryHint(selectionWindow, liveItems, detailPanel) {
  if (selectionWindow === 'virtualized') {
    return 'scroll_list';
  }

  if (selectionWindow === 'not_found') {
    if (liveItems.length > 0) return 'scroll_list';
    if (detailPanel) return 'reinspect_workspace';
    return 'reinspect_workspace';
  }

  return null;
}

function getOutcomeSignals(snapshot, composer, activeItem) {
  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  const delivered = bodyText.includes('已发送') || bodyText.includes('发送成功') || bodyText.includes('delivered') || bodyText.includes('sent');
  const composerCleared = !!composer && composer.draft_present === false && !compactText(composer.draft_text);
  const activeItemStable = !!activeItem && getDetailAlignment(activeItem, getDetailPanel(snapshot)) === 'aligned';

  return {
    delivered,
    composer_cleared: composerCleared,
    active_item_stable: activeItemStable,
  };
}

function getSummaryString({ workspaceSurface, activeItem, composer, blockingModals, loadingShell, detailAlignment, selectionWindow }) {
  const activeLabel = activeItem?.label ?? 'none';
  const draftState = composer?.draft_present ? 'draft' : 'empty';
  const blockerCount = blockingModals.length;
  return `surface=${workspaceSurface ?? 'unknown'} active=${activeLabel} draft=${draftState} blockers=${blockerCount} loading=${loadingShell ? 'yes' : 'no'} detail=${detailAlignment} selection=${selectionWindow}`;
}

export function summarizeWorkspaceSnapshot(snapshot = {}) {
  const liveItems = getLiveItems(snapshot);
  const composer = getComposer(snapshot);
  const detailPanel = getDetailPanel(snapshot);
  const blockingModals = getBlockingModals(snapshot);
  const loadingShell = getLoadingShell(snapshot);
  const activeItem = getActiveItem(snapshot, liveItems, detailPanel);
  const workspaceSurface = pick(snapshot, 'workspaceSurface', 'workspace_surface', null) ?? classifyWorkspaceSurface(snapshot);
  const detailAlignment = getDetailAlignment(activeItem, detailPanel);
  const selectionWindow = getSelectionWindow(activeItem, detailPanel, liveItems);
  const recoveryHint = getRecoveryHint(selectionWindow, liveItems, detailPanel);
  const outcomeSignals = pick(snapshot, 'outcomeSignals', 'outcome_signals', null) ?? getOutcomeSignals(snapshot, composer, activeItem);
  const summary = getSummaryString({
    workspaceSurface,
    activeItem,
    composer,
    blockingModals,
    loadingShell,
    detailAlignment,
    selectionWindow,
  });

  return {
    workspace_surface: workspaceSurface,
    active_item_label: activeItem?.label ?? null,
    draft_present: composer?.draft_present === true,
    loading_shell: loadingShell,
    blocking_modals: blockingModals,
    blocking_modal_count: blockingModals.length,
    blocking_modal_labels: blockingModals.map((modal) => compactText(modal?.label)).filter(Boolean),
    detail_alignment: detailAlignment,
    selection_window: selectionWindow,
    recovery_hint: recoveryHint,
    outcome_signals: outcomeSignals,
    summary,
  };
}

export async function collectVisibleWorkspaceSnapshot(page, state) {
  const rawSnapshot = await page.evaluate(() => {
    if (typeof document === 'undefined') {
      return {
        bodyText: '',
        live_items: [],
        active_item: null,
        detail_panel: null,
        detail_alignment: 'unknown',
        composer: null,
        action_controls: [],
        outcome_signals: {
          delivered: false,
          composer_cleared: false,
          active_item_stable: false,
        },
        blocking_modals: [],
        loading_shell: false,
      };
    }

    function compactText(value) {
      return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function normalizeLabel(value) {
      return compactText(value).toLowerCase();
    }

    function getHintId(el) {
      return el.getAttribute('data-grasp-id') || null;
    }

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function getText(el) {
      return compactText(el.getAttribute('aria-label') || el.textContent || el.value || '');
    }

    function isSelected(el) {
      return el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('aria-current') !== null
        || el.classList.contains('selected')
        || el.classList.contains('active')
        || el.classList.contains('current');
    }

    function readLiveItem(el) {
      const label = getText(el);
      if (!label || label.length > 120) return null;
      return {
        label,
        normalized_label: normalizeLabel(label),
        hint_id: getHintId(el),
        selected: isSelected(el),
      };
    }

    function readDetailPanel() {
      const candidates = [...document.querySelectorAll('[data-detail-panel], [role="complementary"], .detail-panel, aside')];
      const visible = candidates.find(isVisible);
      if (!visible) return null;
      const label = getText(visible.querySelector('h1, h2, h3, h4, h5, h6') || visible);
      return label ? {
        label,
        normalized_label: normalizeLabel(label),
        hint_id: getHintId(visible),
        selected: false,
      } : null;
    }

    function readComposer() {
      const candidates = [...document.querySelectorAll('textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]')];
      const visible = candidates.find(isVisible);
      if (!visible) return null;
      const draftText = compactText('value' in visible ? visible.value : visible.textContent);
      const kind = visible.matches('[contenteditable="true"], [role="textbox"]') ? 'chat_composer' : 'chat_composer';
      return {
        kind,
        hint_id: getHintId(visible),
        draft_present: draftText.length > 0,
        draft_text: draftText,
      };
    }

    function readActionControls() {
      return [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
        .filter(isVisible)
        .map((el) => {
          const label = getText(el);
          return label ? {
            label,
            action_kind: (() => {
              const text = normalizeLabel(label);
              if (text.includes('发送') || text.includes('send') || text.includes('提交') || text.includes('回复')) {
                return 'send';
              }
              if (text.includes('取消') || text.includes('关闭') || text.includes('close')) {
                return 'dismiss';
              }
              return 'action';
            })(),
            hint_id: getHintId(el),
          } : null;
        })
        .filter(Boolean);
    }

    function readBlockingModals() {
      return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')]
        .filter(isVisible)
        .map((el) => {
          const label = getText(el.querySelector('h1, h2, h3, h4, h5, h6') || el);
          return label ? {
            label,
            normalized_label: normalizeLabel(label),
            hint_id: getHintId(el),
          } : null;
        })
        .filter(Boolean);
    }

    const bodyText = compactText(document.body?.innerText);
    const live_items = [...document.querySelectorAll('[data-grasp-id], [role="option"], [role="row"], li, a, button')]
      .filter(isVisible)
      .map(readLiveItem)
      .filter(Boolean)
      .filter((item, index, items) => {
        const key = `${item.hint_id ?? ''}|${item.normalized_label}`;
        return items.findIndex((candidate) => `${candidate.hint_id ?? ''}|${candidate.normalized_label}` === key) === index;
      });
    const detail_panel = readDetailPanel();
    const active_item = (() => {
      const selectedLiveItems = live_items.filter((item) => item.selected);
      if (selectedLiveItems.length === 1) return selectedLiveItems[0];
      return null;
    })();
    const detail_alignment = active_item && detail_panel
      ? (active_item.normalized_label === detail_panel.normalized_label ? 'aligned' : 'mismatch')
      : 'unknown';
    const selection_window = active_item
      ? (live_items.some((item) => item.selected && item.normalized_label === active_item.normalized_label) ? 'visible' : detail_panel ? 'virtualized' : 'visible')
      : (detail_panel && live_items.length > 0 ? 'virtualized' : 'not_found');
    const recovery_hint = selection_window === 'virtualized'
      ? 'scroll_list'
      : (selection_window === 'not_found' ? (live_items.length > 0 ? 'scroll_list' : 'reinspect_workspace') : null);
    const composer = readComposer();
    const action_controls = readActionControls();
    const blocking_modals = readBlockingModals();
    const loading_shell = /加载中|请稍候|loading|please wait/i.test(bodyText)
      || document.querySelector('[aria-busy="true"], .loading, .skeleton, .spinner') !== null;
    const outcome_signals = {
      delivered: /已发送|发送成功|delivered|sent/i.test(bodyText),
      composer_cleared: !!composer && composer.draft_present === false,
      active_item_stable: !!active_item && detail_alignment === 'aligned' && selection_window === 'visible',
    };

    return {
      bodyText,
      live_items,
      active_item,
      detail_panel,
      detail_alignment,
      composer,
      action_controls,
      outcome_signals,
      blocking_modals,
      loading_shell,
      selection_window,
      recovery_hint,
    };
  });

  const snapshot = {
    ...rawSnapshot,
    workspace_surface: classifyWorkspaceSurface(rawSnapshot),
  };

  return {
    ...snapshot,
    summary: summarizeWorkspaceSnapshot(snapshot),
  };
}
