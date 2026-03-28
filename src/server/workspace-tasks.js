function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return compactText(value).toLowerCase();
}

export function deriveWorkspaceHintItems(hintMap = []) {
  const hints = Array.isArray(hintMap) ? hintMap : [];
  const candidates = hints
    .map((hint) => {
      const label = compactText(hint?.label);
      const type = compactText(hint?.type ?? hint?.meta?.tag).toLowerCase();
      const ariaCurrent = compactText(hint?.meta?.ariaCurrent).toLowerCase();
      return {
        label,
        normalized_label: normalizeLabel(label),
        hint_id: compactText(hint?.id) || null,
        type,
        x: Number(hint?.x),
        y: Number(hint?.y),
        selected: hint?.meta?.selected === true
          || ['page', 'step', 'location', 'date', 'time', 'true'].includes(ariaCurrent),
      };
    })
    .filter((hint) => hint.label
      && hint.label.length <= 24
      && !/^\d+$/.test(hint.label)
      && (hint.type === 'a' || hint.type === 'button')
      && Number.isFinite(hint.x)
      && Number.isFinite(hint.y)
      && hint.x <= 240)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  if (candidates.length < 2) {
    return [];
  }

  const xValues = candidates.map((hint) => hint.x);
  const yValues = candidates.map((hint) => hint.y);
  const xSpread = Math.max(...xValues) - Math.min(...xValues);
  const ySpread = Math.max(...yValues) - Math.min(...yValues);

  if (xSpread > 120 || ySpread < 40) {
    return [];
  }

  return candidates
    .filter((hint, index, items) => items.findIndex((candidate) => candidate.normalized_label === hint.normalized_label) === index)
    .map(({ label, normalized_label, hint_id, selected }) => ({
      label,
      normalized_label,
      hint_id,
      selected: selected === true,
    }));
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
  return item?.selected === true;
}

function hasExactLoadingShellText(text) {
  return text.includes('加载中，请稍候')
    || (text.includes('加载中') && text.includes('请稍候'))
    || text.includes('正在加载');
}

function hasThreadPromptText(text) {
  return text.includes('按enter键发送')
    || text.includes('发送消息')
    || text.includes('发消息')
    || text.includes('输入消息');
}

function hasThreadContextText(text) {
  return text.includes('消息')
    || text.includes('聊天')
    || text.includes('对话');
}

function isComposerSurface(workspaceSurface) {
  return workspaceSurface === 'thread' || workspaceSurface === 'composer';
}

function hasSendActionControl(actionControls) {
  return actionControls.some((control) => {
    const label = normalizeLabel(control?.label);
    return label.includes('发送')
      || label.includes('send')
      || label.includes('回复')
      || label.includes('提交');
  });
}

function hasEnglishSuccessSignal(text) {
  return /\b(delivered|sent)\b/i.test(text);
}

function hasThreadEvidence(snapshot) {
  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  const actionControls = getActionControls(snapshot);
  const liveItems = getLiveItems(snapshot);

  if (hasThreadPromptText(bodyText)) {
    return true;
  }

  if (hasThreadContextText(bodyText) && liveItems.some(isSelectedItem) && hasSendActionControl(actionControls)) {
    return true;
  }

  return false;
}

function hasComposerEvidence(snapshot) {
  const composer = getComposer(snapshot);
  if (!composer) return false;
  return composer.kind === 'chat_composer';
}

export function classifyWorkspaceSurface(snapshot = {}) {
  if (getLoadingShell(snapshot)) {
    return 'loading_shell';
  }

  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  if (hasExactLoadingShellText(bodyText)) {
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

  return 'not_found';
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

function getOutcomeSignals(snapshot, composer, activeItem, detailAlignment, selectionWindow) {
  const bodyText = pickText(snapshot, 'bodyText', 'body_text').toLowerCase();
  const delivered = bodyText.includes('已发送') || bodyText.includes('发送成功') || hasEnglishSuccessSignal(bodyText);
  const composerCleared = delivered;
  const activeItemStable = detailAlignment !== undefined
    ? detailAlignment === 'aligned' && selectionWindow === 'visible'
    : !!activeItem && getDetailAlignment(activeItem, getDetailPanel(snapshot)) === 'aligned';

  return {
    delivered,
    composer_cleared: composerCleared,
    active_item_stable: activeItemStable,
  };
}

function isBlockedHandoffState(handoffState) {
  return handoffState === 'handoff_required'
    || handoffState === 'handoff_in_progress'
    || handoffState === 'awaiting_reacquisition';
}

export function getWorkspaceStatus(state) {
  const handoffState = state.handoff?.state ?? 'idle';
  if (isBlockedHandoffState(handoffState)) {
    return 'handoff_required';
  }

  return state.pageState?.riskGateDetected ? 'gated' : 'direct';
}

export function getWorkspaceContinuation(state, suggestedNextAction) {
  const handoffState = state.handoff?.state ?? 'idle';
  if (getWorkspaceStatus(state) !== 'direct') {
    return {
      can_continue: false,
      suggested_next_action: 'request_handoff',
      handoff_state: handoffState,
    };
  }

  return {
    can_continue: true,
    suggested_next_action: suggestedNextAction,
    handoff_state: handoffState,
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
  const loadingShell = snapshot.loading_shell !== undefined ? snapshot.loading_shell : snapshot.loadingShell;
  const rawActiveItem = snapshot.active_item !== undefined ? snapshot.active_item : snapshot.activeItem;
  const rawDetailAlignment = snapshot.detail_alignment !== undefined ? snapshot.detail_alignment : snapshot.detailAlignment;
  const rawSelectionWindow = snapshot.selection_window !== undefined ? snapshot.selection_window : snapshot.selectionWindow;
  const rawRecoveryHint = snapshot.recovery_hint !== undefined ? snapshot.recovery_hint : snapshot.recoveryHint;
  const rawOutcomeSignals = snapshot.outcome_signals !== undefined ? snapshot.outcome_signals : snapshot.outcomeSignals;
  const derivedActiveItem = getActiveItem(snapshot, liveItems, detailPanel);
  const activeItem = rawActiveItem ?? derivedActiveItem;
  const shouldPreferDerivedSelection = rawActiveItem == null && derivedActiveItem != null;
  const workspaceSurface = pick(snapshot, 'workspaceSurface', 'workspace_surface', null) ?? classifyWorkspaceSurface(snapshot);
  const detailAlignment = shouldPreferDerivedSelection
    ? getDetailAlignment(activeItem, detailPanel)
    : rawDetailAlignment !== undefined ? rawDetailAlignment : getDetailAlignment(activeItem, detailPanel);
  const selectionWindow = shouldPreferDerivedSelection
    ? getSelectionWindow(activeItem, detailPanel, liveItems)
    : rawSelectionWindow !== undefined ? rawSelectionWindow : getSelectionWindow(activeItem, detailPanel, liveItems);
  const recoveryHint = shouldPreferDerivedSelection
    ? getRecoveryHint(selectionWindow, liveItems, detailPanel)
    : rawRecoveryHint !== undefined ? rawRecoveryHint : getRecoveryHint(selectionWindow, liveItems, detailPanel);
  const outcomeSignals = shouldPreferDerivedSelection
    ? getOutcomeSignals(snapshot, composer, activeItem, detailAlignment, selectionWindow)
    : rawOutcomeSignals !== undefined ? rawOutcomeSignals : getOutcomeSignals(snapshot, composer, activeItem, detailAlignment, selectionWindow);
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
    loading_shell: loadingShell !== undefined ? loadingShell : getLoadingShell(snapshot),
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

export function buildWorkspaceVerification(snapshot = {}) {
  const summary = summarizeWorkspaceSnapshot(snapshot);
  const activeItemLabel = summary.active_item_label ?? null;
  const draftPresent = summary.draft_present === true;
  const delivered = summary.outcome_signals?.delivered === true;
  const loadingShell = summary.loading_shell === true;
  const blockingModalPresent = summary.blocking_modal_count > 0;
  const detailAlignment = summary.detail_alignment ?? 'unknown';
  const outcomeSignals = summary.outcome_signals ?? {
    delivered: false,
    composer_cleared: false,
    active_item_stable: false,
  };
  const workspaceSurface = summary.workspace_surface ?? pick(snapshot, 'workspaceSurface', 'workspace_surface', null);
  const composer = getComposer(snapshot);
  const actionControls = getActionControls(snapshot);
  const activeItemStable = outcomeSignals?.active_item_stable === true;
  const hasReliableSendControl = actionControls.some((control) => control?.action_kind === 'send' && compactText(control?.label));
  const readyForNextAction = loadingShell || blockingModalPresent
    ? 'workspace_inspect'
    : !activeItemLabel
      ? 'select_live_item'
      : detailAlignment === 'mismatch'
        ? 'select_live_item'
        : !activeItemStable
          ? 'workspace_inspect'
          : !composer
            ? 'workspace_inspect'
            : draftPresent
              ? (hasReliableSendControl ? 'execute_action' : 'workspace_inspect')
              : isComposerSurface(workspaceSurface)
                ? 'draft_action'
                : 'workspace_inspect';

  return {
    active_item_label: activeItemLabel,
    draft_present: draftPresent,
    delivered,
    loading_shell: loadingShell,
    blocking_modal_present: blockingModalPresent,
    detail_alignment: detailAlignment,
    outcome_signals: outcomeSignals,
    ready_for_next_action: readyForNextAction,
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

    function hasEnglishSuccessSignal(text) {
      return /\b(delivered|sent)\b/i.test(text);
    }

    function hasEnglishComposerPromptText(text) {
      return /\b(type|write|send)?\s*(a\s*)?(message|reply)\b/i.test(text)
        || /\bchat\b/i.test(text);
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

    const bodyText = compactText(document.body?.innerText);
    const hasThreadPromptBodyText = bodyText.includes('按enter键发送')
      || bodyText.includes('发送消息')
      || bodyText.includes('发消息')
      || bodyText.includes('输入消息');
    const hasExactLoadingShellBodyText = bodyText.includes('加载中，请稍候')
      || (bodyText.includes('加载中') && bodyText.includes('请稍候'))
      || bodyText.includes('正在加载');

    function isSelected(el) {
      const ariaCurrent = el.getAttribute('aria-current');
      const classAttr = String(el.getAttribute('class') || '');
      const hasStateClass = classAttr
        .split(/\s+/)
        .some((token) => /(^|[-_])(selected|current)($|[-_])/i.test(token));
      return el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('data-selected') === 'true'
        || ariaCurrent === 'true'
        || ariaCurrent === 'page'
        || ariaCurrent === 'step'
        || ariaCurrent === 'location'
        || hasStateClass
        || el.classList.contains('selected')
        || el.classList.contains('is-selected')
        || el.classList.contains('workspace-item--selected');
    }

    function isButtonLike(el) {
      return el.matches('button, [role="button"], input[type="submit"], input[type="button"]');
    }

    function isActionLikeLabel(label) {
      const text = normalizeLabel(label);
      return text.includes('发送')
        || text.includes('send')
        || text.includes('回复')
        || text.includes('reply')
        || text.includes('提交')
        || text.includes('submit')
        || text.includes('取消')
        || text.includes('cancel')
        || text.includes('关闭')
        || text.includes('close');
    }

    const structuredItemSelector = 'li, [role="option"], [role="row"], [role="treeitem"], [data-list-item], [data-thread-item], [data-conversation-item]';
    const navLeafSelector = 'a, [role="link"], [role="menuitem"], [role="tab"], button, [role="button"]';

    function hasNestedNavLeaf(el) {
      return Boolean(el.querySelector(navLeafSelector));
    }

    function isNavLeafCandidate(el) {
      if (!isVisible(el)) return false;
      if (!el.matches(navLeafSelector)) return false;
      const label = getText(el);
      if (!label || label.length > 60) return false;
      const selectedState = el.getAttribute('aria-current') || el.getAttribute('aria-selected') === 'true';
      const structuredNav = Boolean(el.closest('nav, [role="navigation"], [role="menu"], [role="tablist"]'));
      const looseNav = structuredNav || Boolean(el.closest('aside, header'));

      if (isButtonLike(el)) {
        if (isActionLikeLabel(label)) return false;
        return Boolean(structuredNav || selectedState);
      }

      return Boolean(
        looseNav
        || selectedState
      );
    }

    function isWorkspaceItemCandidate(el) {
      if (!isVisible(el)) return false;
      if (isNavLeafCandidate(el)) return true;
      if (el.closest('button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, textarea, select')) return false;
      if (hasNestedNavLeaf(el)) return false;
      return el.matches(structuredItemSelector);
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
      const hintText = compactText([
        visible.getAttribute('placeholder'),
        visible.getAttribute('aria-label'),
        visible.getAttribute('title'),
      ].filter(Boolean).join(' ')).toLowerCase();
      const messageHints = ['输入消息', '发消息', '发送消息', '回复', '说点什么', '写点什么', '输入内容', '按enter键发送', '聊天', 'type a message', 'write a message', 'send a message', 'write a reply', 'type your reply'];
      const hasVisibleSendActionControl = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
        .filter(isVisible)
        .some((el) => {
          const label = normalizeLabel(getText(el));
          return label.includes('发送') || label.includes('send') || label.includes('回复') || label.includes('reply') || label.includes('提交') || label.includes('submit');
        });
      const hasHintText = messageHints.some((hint) => hintText.includes(hint))
        || (hasVisibleSendActionControl && hasEnglishComposerPromptText(hintText));
      const hasPromptAndSend = (
        (hasThreadPromptBodyText || hasEnglishComposerPromptText(bodyText))
        && hasVisibleSendActionControl
      );
      if (!hasHintText && !hasPromptAndSend) {
        return null;
      }
      return {
        kind: 'chat_composer',
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

    const live_items = [...document.querySelectorAll(structuredItemSelector), ...document.querySelectorAll(navLeafSelector)]
      .filter(isWorkspaceItemCandidate)
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
      ? (live_items.some((item) => item.selected && item.normalized_label === active_item.normalized_label) ? 'visible' : detail_panel ? 'virtualized' : 'not_found')
      : (detail_panel && live_items.length > 0 ? 'virtualized' : 'not_found');
    const recovery_hint = selection_window === 'virtualized'
      ? 'scroll_list'
      : (selection_window === 'not_found' ? (live_items.length > 0 ? 'scroll_list' : 'reinspect_workspace') : null);
    const composer = readComposer();
    const action_controls = readActionControls();
    const blocking_modals = readBlockingModals();
    const loadingIndicator = [...document.querySelectorAll('[aria-busy="true"], .loading, .skeleton, .spinner')]
      .find(isVisible);
    const loading_shell = !!(hasExactLoadingShellBodyText
      || (loadingIndicator && /加载中|请稍候|正在加载/.test(bodyText)));
    const outcome_signals = {
      delivered: /已发送|发送成功/i.test(bodyText) || hasEnglishSuccessSignal(bodyText),
      composer_cleared: /已发送|发送成功/i.test(bodyText) || hasEnglishSuccessSignal(bodyText),
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

  const hintLiveItems = deriveWorkspaceHintItems(state?.hintMap ?? []);
  const mergedLiveItems = [...hintLiveItems, ...getLiveItems(rawSnapshot)]
    .filter((item, index, items) => {
      const key = `${compactText(item?.hint_id)}|${normalizeLabel(item?.normalized_label ?? item?.label)}`;
      return items.findIndex((candidate) => `${compactText(candidate?.hint_id)}|${normalizeLabel(candidate?.normalized_label ?? candidate?.label)}` === key) === index;
    });
  const detailPanel = getDetailPanel(rawSnapshot);
  const rawActiveItem = rawSnapshot?.active_item !== undefined ? rawSnapshot.active_item : rawSnapshot?.activeItem;
  const mergedActiveItem = rawActiveItem ?? getActiveItem({}, mergedLiveItems, detailPanel);
  const shouldReconcileSelection = rawActiveItem == null && mergedActiveItem != null;
  const detailAlignment = shouldReconcileSelection
    ? getDetailAlignment(mergedActiveItem, detailPanel)
    : pick(rawSnapshot, 'detailAlignment', 'detail_alignment', undefined);
  const selectionWindow = shouldReconcileSelection
    ? getSelectionWindow(mergedActiveItem, detailPanel, mergedLiveItems)
    : pick(rawSnapshot, 'selectionWindow', 'selection_window', undefined);
  const recoveryHint = shouldReconcileSelection
    ? getRecoveryHint(selectionWindow, mergedLiveItems, detailPanel)
    : pick(rawSnapshot, 'recoveryHint', 'recovery_hint', undefined);
  const outcomeSignals = shouldReconcileSelection
    ? getOutcomeSignals(rawSnapshot, getComposer(rawSnapshot), mergedActiveItem, detailAlignment, selectionWindow)
    : pick(rawSnapshot, 'outcomeSignals', 'outcome_signals', undefined);
  const snapshot = {
    ...rawSnapshot,
    live_items: mergedLiveItems,
    ...(shouldReconcileSelection
      ? {
          active_item: mergedActiveItem,
          detail_alignment: detailAlignment,
          selection_window: selectionWindow,
          recovery_hint: recoveryHint,
          outcome_signals: outcomeSignals,
        }
      : {}),
    workspace_surface: classifyWorkspaceSurface({
      ...rawSnapshot,
      live_items: mergedLiveItems,
    }),
  };

  return {
    ...snapshot,
    summary: summarizeWorkspaceSnapshot(snapshot),
  };
}
