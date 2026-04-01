import { z } from 'zod';

import { getActivePage, getTabs, navigateTo, switchTab, newTab, closeTab } from '../layer1-bridge/chrome.js';
import { clickByHintId, typeByHintId, hoverByHintId, pressKey, watchElement, scroll, findScrollableAncestor } from '../layer3-action/actions.js';
import { errorResponse, imageResponse, textResponse } from './responses.js';
import { describeMode, syncPageState } from './state.js';
import { audit } from './audit.js';
import { verifyTypeResult, verifyGenericAction } from './postconditions.js';
import { TYPE_FAILED } from './error-codes.js';
import { runVerifiedAction } from '../grasp/verify/pipeline.js';
import { readHandoffState } from '../grasp/handoff/persist.js';
import { extractMainContent } from './content.js';
import { readFastPath } from './fast-path-router.js';
import { buildPageProjection } from './page-projection.js';
import { selectEngine } from './engine-selection.js';
import { readLatestRouteDecision } from './audit.js';
import { readBrowserInstance } from '../runtime/browser-instance.js';
import { buildRuntimeConfirmationSuccessResponse, getRuntimeConfirmationSummary, requireConfirmedRuntimeInstance, storeRuntimeConfirmation } from './runtime-confirmation.js';

function buildStructuredError(message, normalizedHintId, verdict) {
  const meta = {
    error_code: verdict?.error_code ?? TYPE_FAILED,
    retryable: verdict?.retryable ?? true,
    suggested_next_step: verdict?.suggested_next_step ?? 'retry',
    evidence: verdict?.evidence ?? { hint_id: normalizedHintId },
  };
  return errorResponse(message, meta);
}

function createRebuildHints(page, state) {
  return async () => {
    await syncPageState(page, state, { force: true });
    return null;
  };
}

function normalizeQuery(value) {
  return String(value ?? '').trim().toLowerCase();
}

function listUserTabs(tabs = [], activeUrl) {
  return tabs
    .filter((tab) => tab.isUser)
    .map((tab) => ({
      ...tab,
      active: tab.url === activeUrl,
    }));
}

function matchVisibleTabs(tabs = [], { query = '', title_contains = '', url_contains = '' } = {}) {
  const normalizedQuery = normalizeQuery(query);
  const normalizedTitle = normalizeQuery(title_contains);
  const normalizedUrl = normalizeQuery(url_contains);

  return tabs.filter((tab) => {
    const title = normalizeQuery(tab.title);
    const url = normalizeQuery(tab.url);
    if (normalizedTitle && !title.includes(normalizedTitle)) return false;
    if (normalizedUrl && !url.includes(normalizedUrl)) return false;
    if (!normalizedQuery) return true;
    return title.includes(normalizedQuery) || url.includes(normalizedQuery);
  });
}

export function registerActionTools(server, state, deps = {}) {
  const getPage = deps.getActivePage ?? getActivePage;
  const listTabs = deps.getTabs ?? getTabs;
  const activateTab = deps.switchTab ?? switchTab;
  const openTab = deps.newTab ?? newTab;
  const closeBrowserTab = deps.closeTab ?? closeTab;
  const syncState = deps.syncPageState ?? syncPageState;
  const extractContent = deps.extractMainContent ?? extractMainContent;
  const navigate = deps.navigateTo ?? navigateTo;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));
  const readFastPathContent = deps.readFastPath ?? readFastPath;

  state.pendingDialog = state.pendingDialog ?? null;
  state._dialogListenerPages = state._dialogListenerPages ?? new WeakSet();
  async function ensureDialogListener(page) {
    if (!page || typeof page.on !== 'function') return;
    if (state._dialogListenerPages.has(page)) return;
    state._dialogListenerPages.add(page);
    page.on('dialog', (dialog) => {
      state.pendingDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        ref: dialog,
      };
    });
  }

  if (!state.consoleLogs) state.consoleLogs = [];
  state._consoleListenerPages = state._consoleListenerPages ?? new WeakSet();
  function ensureConsoleListener(page) {
    if (!page || typeof page.on !== 'function') return;
    if (state._consoleListenerPages.has(page)) return;
    state._consoleListenerPages.add(page);
    page.on('console', (msg) => {
      state.consoleLogs.push({
        level: msg.type(),
        text: msg.text(),
        url: msg.location?.()?.url ?? '',
        lineNumber: msg.location?.()?.lineNumber ?? 0,
        timestamp: Date.now(),
      });
      if (state.consoleLogs.length > 200) state.consoleLogs.shift();
    });
  }

  async function getPageWithListeners(opts) {
    const page = await getPage(opts);
    await ensureDialogListener(page);
    ensureConsoleListener(page);
    return page;
  }

  async function requireActionConfirmation(toolName) {
    const instance = await getBrowserInstance();
    return requireConfirmedRuntimeInstance(state, instance, toolName);
  }

  server.registerTool(
    'list_visible_tabs',
    {
      description: 'List user-visible tabs in the current runtime and mark which one is active.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage({ state });
      const tabs = listUserTabs(await listTabs(), page.url());

      return textResponse([
        `Visible tabs: ${tabs.length}`,
        '',
        ...tabs.map((tab) => `[${tab.index}] ${tab.title}${tab.active ? ' (active)' : ''}\n${tab.url}`),
      ], { tabs });
    }
  );

  server.registerTool(
    'select_visible_tab',
    {
      description: 'Bring a visible runtime tab to the front by matching its title or URL fragment.',
      inputSchema: {
        query: z.string().optional().describe('Text fragment that may match either the tab title or the tab URL'),
        title_contains: z.string().optional().describe('Optional title fragment to narrow tab selection'),
        url_contains: z.string().optional().describe('Optional URL fragment to narrow tab selection'),
      },
    },
    async ({ query = '', title_contains = '', url_contains = '' } = {}) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'select_visible_tab');
      if (confirmationError) return confirmationError;

      const tabs = listUserTabs(await listTabs());
      const matches = matchVisibleTabs(tabs, { query, title_contains, url_contains });

      if (matches.length === 0) {
        return errorResponse('No visible tab matched the provided query.', {
          error_code: 'TAB_NOT_FOUND',
          retryable: true,
          suggested_next_step: 'list_visible_tabs',
          tabs,
        });
      }

      if (matches.length > 1) {
        return errorResponse('Multiple visible tabs matched the provided query.', {
          error_code: 'TAB_AMBIGUOUS',
          retryable: true,
          suggested_next_step: 'list_visible_tabs',
          candidates: matches,
        });
      }

      const selectedTab = matches[0];
      const page = await activateTab(selectedTab.index);
      await syncState(page, state, { force: true });

      return textResponse([
        `Selected tab [${selectedTab.index}]: ${selectedTab.title}`,
        `URL: ${selectedTab.url}`,
        `Page role: ${state.pageState?.currentRole ?? 'unknown'}`,
      ], { tab: selectedTab });
    }
  );

  server.registerTool(
    'confirm_runtime_instance',
    {
      description: 'Confirm the current runtime browser instance before performing page-changing actions.',
      inputSchema: {
        display: z.enum(['windowed', 'headless', 'unknown']).describe('The runtime instance mode you expect to act against'),
      },
    },
    async ({ display }) => {
      const instance = await getBrowserInstance();
      if (!instance) {
        return errorResponse('Runtime instance unavailable. Call get_status and try again.');
      }
      if ((instance.display ?? 'unknown') !== display) {
        return errorResponse([
          'Runtime instance mismatch.',
          `Expected: ${display}`,
          `Actual: ${instance.display ?? 'unknown'}`,
          ...(instance.browser ? [`Browser: ${instance.browser}`] : []),
        ], {
          error_code: 'INSTANCE_CONFIRMATION_MISMATCH',
          retryable: true,
          suggested_next_step: 'get_status',
          instance,
        });
      }
      const confirmation = storeRuntimeConfirmation(state, instance);
      return buildRuntimeConfirmationSuccessResponse(confirmation, instance);
    }
  );

  server.registerTool(
    'navigate',
    {
      description: 'Navigate the browser to a URL and refresh Grasp page state.',
      inputSchema: { url: z.string().url().describe('Full URL to navigate to') },
    },
    async ({ url }) => {
      try {
        const instance = await getBrowserInstance();
        const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'navigate');
        if (confirmationError) return confirmationError;
        const page = await navigate(url, { state });
        await syncState(page, state, { force: true });
        await audit('navigate', url, null, state);
        return textResponse([
          `Navigated to: ${url}`,
          `Page title: ${await page.title()}`,
          `CDP mode - ${state.hintMap.length} interactive elements found.`,
          'Use get_hint_map to inspect the current interaction map.',
        ]);
      } catch (err) {
        return errorResponse(`Navigation failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'get_status',
    {
      description: 'Get current Grasp status, including page grasp and handoff state.',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await getPage({ state });
        await syncState(page, state);
        state.handoff = await readHandoffState();
        const handoff = state.handoff ?? { state: 'idle' };
        const pageState = state.pageState ?? {};
        const route = state.lastRouteTrace ?? await readLatestRouteDecision();
        const { mode, detail } = describeMode(state);
        const instance = await getBrowserInstance();
        const confirmation = getRuntimeConfirmationSummary(state, instance);

        return textResponse([
          'Grasp is connected',
          '',
          `Page: ${await page.title()}`,
          `URL: ${page.url()}`,
          `Mode: ${mode}`,
          `  ${detail}`,
          ...(instance?.browser ? [`Browser instance: ${instance.browser}`] : []),
          ...(instance?.display ? [`Instance mode: ${instance.display}`] : []),
          ...(instance?.warning ? [`Instance warning: ${instance.warning}`] : []),
          `Instance confirmed: ${confirmation.confirmed ? 'yes' : 'no'}`,
          `Hint Map: ${state.hintMap?.length ?? 0} elements cached`,
          `Page role: ${pageState.currentRole ?? 'unknown'}`,
          `Grasp confidence: ${pageState.graspConfidence ?? 'unknown'}`,
          `Reacquired: ${pageState.reacquired ? 'yes' : 'no'}`,
          `Risk gate detected: ${pageState.riskGateDetected ? 'yes' : 'no'}`,
          ...(pageState.checkpointKind ? [`Checkpoint kind: ${pageState.checkpointKind}`] : []),
          ...(pageState.checkpointSignals?.length ? [`Checkpoint signals: ${pageState.checkpointSignals.join(', ')}`] : []),
          ...(pageState.suggestedNextAction ? [`Suggested next action: ${pageState.suggestedNextAction}`] : []),
          ...(route?.selected_mode ? [`Last route: ${route.selected_mode}`] : []),
          ...(route?.next_step ? [`Route next step: ${route.next_step}`] : []),
          `Handoff: ${handoff.state}`,
          ...(handoff.reason ? [`  reason: ${handoff.reason}`] : []),
        ], { handoff, pageState, ...(instance ? { instance } : {}), ...(route ? { route } : {}) });
      } catch (err) {
        return errorResponse(`Grasp is NOT connected.\n${err.message}`);
      }
    }
  );

  server.registerTool(
    'get_page_summary',
    {
      description: 'Extract a concise summary of the current page.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage({ state });
      const selection = selectEngine({ tool: 'get_page_summary', url: page.url() });
      let fastPath = null;

      if (selection.engine === 'runtime') {
        await syncState(page, state, { force: true });
        fastPath = await readFastPathContent(page);
      } else {
        await syncState(page, state);
      }

      const main = fastPath ?? await extractContent(page);
      const result = buildPageProjection({
        ...selection,
        surface: fastPath?.surface ?? 'content',
        title: main.title,
        url: fastPath?.url ?? page.url(),
        mainText: fastPath?.mainText ?? main.text,
      });
      const { summary } = describeMode(state);
      return textResponse([
        `Title: ${result.title}`,
        `URL: ${result.url}`,
        `Mode: ${summary}`,
        '',
        'Visible content (truncated):',
        result.main_text.slice(0, 2000),
      ], { result });
    }
  );

  server.registerTool(
    'get_hint_map',
    {
      description: 'Return the current Hint Map for interactive elements on the page.',
      inputSchema: {
        filter: z.string().optional().describe('Optional text filter for hint labels'),
      },
    },
    async ({ filter } = {}) => {
      const page = await getPage({ state });
      await syncPageState(page, state, { force: true });
      const query = (filter ?? '').trim().toLowerCase();
      const hints = query
        ? state.hintMap.filter((hint) => hint.label.toLowerCase().includes(query))
        : state.hintMap;

      if (hints.length === 0) {
        return textResponse(query ? `No hints matched filter: ${filter}` : 'No interactive elements found.');
      }

      return textResponse([
        `Hint Map (${hints.length} elements):`,
        '',
        ...hints.map((hint) => `[${hint.id}] ${hint.label} (${hint.type}, pos:${hint.x},${hint.y})`),
      ], { hints });
    }
  );

  server.registerTool(
    'click',
    {
      description: 'Click an element by hint ID and verify the result.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID from get_hint_map'),
      },
    },
    async ({ hint_id }) => {
      const normalizedHintId = String(hint_id).trim();
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'click');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncPageState(page, state);
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = page.url();
      const prevActiveId = await page.evaluate(() => document.activeElement?.getAttribute('data-grasp-id') ?? null);
      const rebuildHints = createRebuildHints(page, state);

      return runVerifiedAction({
        action: 'click',
        page,
        state,
        baseEvidence: { hint_id: normalizedHintId },
        execute: async () => {
          const result = await clickByHintId(page, normalizedHintId, { rebuildHints });
          await syncPageState(page, state, { force: true });
          return result;
        },
        verify: async () => verifyGenericAction({
          page,
          hintId: normalizedHintId,
          prevDomRevision,
          prevUrl,
          prevActiveId,
          newDomRevision: state.pageState?.domRevision ?? 0,
        }),
        onFailure: async (failure) => {
          await audit('click_failed', `[${normalizedHintId}] ${failure.error_code}`, null, state);
          return buildStructuredError(`Click verification failed for [${normalizedHintId}]`, normalizedHintId, failure);
        },
        onSuccess: async ({ executionResult, evidence }) => {
          await audit('click', `[${normalizedHintId}] "${executionResult.label}"`, null, state);
          const urlAfter = page.url();
          const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
          return textResponse(
            `Clicked [${normalizedHintId}]: "${executionResult.label}"${nav}\nPage now has ${state.hintMap.length} elements. Call get_hint_map to inspect the new state.`,
            { evidence }
          );
        },
      });
    }
  );

  server.registerTool(
    'type',
    {
      description: 'Type text into an element by hint ID and verify the result.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID from get_hint_map'),
        text: z.string().describe('Text to type'),
        press_enter: z.boolean().optional().describe('Press Enter after typing'),
      },
    },
    async ({ hint_id, text, press_enter = false }) => {
      const normalizedHintId = String(hint_id).trim();
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'type');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncPageState(page, state);
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = page.url();
      const rebuildHints = createRebuildHints(page, state);

      return runVerifiedAction({
        action: 'type',
        page,
        state,
        baseEvidence: { hint_id: normalizedHintId },
        execute: async () => {
          await typeByHintId(page, normalizedHintId, text, press_enter, { rebuildHints });
          await syncPageState(page, state, { force: true });
          return { text, press_enter };
        },
        verify: async () => {
          const newDomRevision = state.pageState?.domRevision ?? prevDomRevision;
          return verifyTypeResult({
            page,
            expectedText: text,
            allowPageChange: press_enter,
            prevUrl,
            prevDomRevision,
            newDomRevision,
          });
        },
        onFailure: async (failure) => {
          await audit('type_failed', `[${normalizedHintId}] ${failure.error_code}`, null, state);
          return buildStructuredError(`Type verification failed for [${normalizedHintId}]`, normalizedHintId, failure);
        },
        onSuccess: async ({ executionResult, evidence }) => {
          await audit('type', `[${normalizedHintId}] "${executionResult.text.slice(0, 20)}${executionResult.text.length > 20 ? '...' : ''}"`, null, state);
          return textResponse(
            `Typed "${executionResult.text}" into [${normalizedHintId}]${executionResult.press_enter ? ' and pressed Enter' : ''}.`,
            { evidence }
          );
        },
      });
    }
  );

  server.registerTool(
    'hover',
    {
      description: 'Hover an element by hint ID and refresh page state.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID from get_hint_map'),
      },
    },
    async ({ hint_id }) => {
      const normalizedHintId = String(hint_id).trim();
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'hover');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncPageState(page, state);
      const prevUrl = page.url();
      const rebuildHints = createRebuildHints(page, state);

      try {
        const result = await hoverByHintId(page, normalizedHintId, { rebuildHints });
        await syncPageState(page, state, { force: true });
        await audit('hover', `[${normalizedHintId}] "${result.label}"`, null, state);
        const urlAfter = page.url();
        const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Hovered over [${normalizedHintId}]: "${result.label}".${nav}\n${state.hintMap.length} elements now visible.`,
          { hint_id: normalizedHintId }
        );
      } catch (err) {
        await audit('hover_failed', `[${normalizedHintId}] ${err.message}`, null, state);
        await syncPageState(page, state, { force: true });
        return buildStructuredError(`hover failed: ${err.message}`, normalizedHintId, {
          error_code: TYPE_FAILED,
          retryable: true,
          suggested_next_step: 'retry',
          evidence: {
            hint_id: normalizedHintId,
            reason: err.message,
          },
        });
      }
    }
  );

  server.registerTool(
    'press_key',
    {
      description: 'Press a keyboard key or shortcut and refresh page state.',
      inputSchema: {
        key: z.string().describe('Keyboard key or shortcut, e.g. Enter, Escape, Control+Enter'),
      },
    },
    async ({ key }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'press_key');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncPageState(page, state);
      await pressKey(page, key);
      await syncPageState(page, state, { force: true });
      await audit('press_key', key, null, state);
      return textResponse(`Pressed key: ${key}`, {
        key,
        page_role: state.pageState?.currentRole ?? 'unknown',
        grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
      });
    }
  );

  server.registerTool(
    'watch_element',
    {
      description: 'Watch a DOM element for appears/disappears/changes and report the result.',
      inputSchema: {
        selector: z.string().describe('CSS selector to watch'),
        condition: z.enum(['appears', 'disappears', 'changes']).optional().describe('Condition to watch for'),
        timeout_ms: z.number().int().positive().optional().describe('Timeout in milliseconds'),
      },
    },
    async ({ selector, condition = 'appears', timeout_ms = 30000 }) => {
      const page = await getPage({ state });
      const result = await watchElement(page, selector, condition, timeout_ms);
      await audit('watch_element', `${condition} ${selector}`, null, state);
      return textResponse([
        `Watch selector: ${selector}`,
        `Condition: ${condition}`,
        `Result: ${result.met ? 'met' : result.timeout ? 'timeout' : 'unknown'}`,
        ...(result.text ? [`Text: ${result.text}`] : []),
      ], { selector, condition, result });
    }
  );

  server.registerTool(
    'scroll',
    {
      description: 'Scroll the page or a specific container by pixel amount. Use hint_id to scroll a nested scrollable area (e.g. sidebar, chat list) instead of the whole page. Returns scroll position (scrollTop/scrollHeight). NOTE: If your goal is to make a known element visible, use scroll_into_view instead — it is a single call and much more accurate.',
      inputSchema: {
        direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
        amount: z.number().int().positive().optional().describe('Scroll distance in pixels (default: 600). Use small values like 50-150 for precise scrolling.'),
        hint_id: z.string().optional().describe('Hint ID of an element inside the scrollable container to target'),
      },
    },
    async ({ direction, amount = 600, hint_id }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'scroll');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncState(page, state);

      let scrollTarget = null;
      let scrollOptions = {};

      if (hint_id) {
        const normalizedId = String(hint_id).trim();
        const selector = `[data-grasp-id="${normalizedId}"]`;
        const ancestorSelector = await findScrollableAncestor(page, selector);
        if (ancestorSelector) {
          scrollOptions.selector = ancestorSelector;
          scrollTarget = ancestorSelector;
        }
      }

      await scroll(page, direction, amount, scrollOptions);
      await syncState(page, state, { force: true });

      const scrollInfo = await page.evaluate((sel) => {
        const target = sel ? document.querySelector(sel) : document.documentElement;
        if (!target) return null;
        return {
          scrollTop: Math.round(target.scrollTop),
          scrollHeight: Math.round(target.scrollHeight),
          clientHeight: Math.round(target.clientHeight),
          scrollLeft: Math.round(target.scrollLeft),
          scrollWidth: Math.round(target.scrollWidth),
          clientWidth: Math.round(target.clientWidth),
          atTop: target.scrollTop <= 0,
          atBottom: target.scrollTop + target.clientHeight >= target.scrollHeight - 1,
          atLeft: target.scrollLeft <= 0,
          atRight: target.scrollLeft + target.clientWidth >= target.scrollWidth - 1,
        };
      }, scrollTarget);

      const targetLabel = scrollTarget ? `container ${scrollTarget}` : 'page';
      await audit('scroll', `${direction} ${amount} target=${targetLabel}`, null, state);

      const posInfo = scrollInfo
        ? (direction === 'left' || direction === 'right'
          ? ` Position: ${scrollInfo.scrollLeft}/${scrollInfo.scrollWidth}px.${scrollInfo.atLeft ? ' [AT LEFT]' : ''}${scrollInfo.atRight ? ' [AT RIGHT]' : ''}`
          : ` Position: ${scrollInfo.scrollTop}/${scrollInfo.scrollHeight}px.${scrollInfo.atTop ? ' [AT TOP]' : ''}${scrollInfo.atBottom ? ' [AT BOTTOM]' : ''}`)
        : '';
      return textResponse(
        `Scrolled ${targetLabel} ${direction} by ${amount}px.${posInfo}`,
        {
          direction,
          amount,
          target: scrollTarget ?? 'page',
          ...(scrollInfo ?? {}),
          page_role: state.pageState?.currentRole ?? 'unknown',
          grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
          dom_revision: state.pageState?.domRevision ?? 0,
        }
      );
    }
  );

  server.registerTool(
    'scroll_into_view',
    {
      description: 'Scroll the page or container so that a specific element becomes visible in the viewport. Uses browser-native scrollIntoView which automatically handles arbitrarily nested scrollable containers in one call. PREFERRED over scroll() when you need to locate a known element — no pixel estimation or evaluate() needed.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID of the element to scroll into view'),
        position: z.enum(['center', 'start', 'end', 'nearest']).optional().describe('Where to place the element in the viewport (default: center)'),
      },
    },
    async ({ hint_id, position = 'center' }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'scroll_into_view');
      if (confirmationError) return confirmationError;
      const page = await getPage({ state });
      await syncState(page, state, { force: true });
      const normalizedId = String(hint_id).trim();
      const selector = `[data-grasp-id="${normalizedId}"]`;

      const result = await page.evaluate(({ sel, pos }) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, reason: 'not_found' };

        const before = el.getBoundingClientRect();
        el.scrollIntoView({ behavior: 'instant', block: pos, inline: 'nearest' });
        const after = el.getBoundingClientRect();

        return {
          ok: true,
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || el.innerText?.trim()?.substring(0, 60) || '',
          moved: Math.abs(after.top - before.top) > 1 || Math.abs(after.left - before.left) > 1,
          rect: {
            top: Math.round(after.top),
            left: Math.round(after.left),
            width: Math.round(after.width),
            height: Math.round(after.height),
          },
        };
      }, { sel: selector, pos: position });

      if (!result.ok) {
        return errorResponse(`Element [${normalizedId}] not found. Call get_hint_map to refresh.`);
      }

      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await syncState(page, state, { force: true });
      await audit('scroll_into_view', `[${normalizedId}] position=${position}`, null, state);

      const movedLabel = result.moved ? 'Scrolled to' : 'Already visible:';
      return textResponse(
        `${movedLabel} [${normalizedId}] (${result.tag}: "${result.label}"). Position: top=${result.rect.top}px, left=${result.rect.left}px.`,
        { hint_id: normalizedId, position, moved: result.moved, rect: result.rect }
      );
    }
  );

  server.registerTool(
    'screenshot',
    {
      description: 'Take a screenshot of the current browser viewport, or a specific element by hint ID. Returns base64-encoded PNG image. Use annotate=true to overlay HintMap element labels on the screenshot for visual identification.',
      inputSchema: {
        fullPage: z.boolean().optional().describe('Capture the full scrollable page instead of just the viewport'),
        annotate: z.boolean().optional().describe('Overlay HintMap element IDs on the screenshot (e.g. [B0], [I1], [L2])'),
        hint_id: z.string().optional().describe('Capture only this element (mutually exclusive with fullPage and annotate)'),
      },
    },
    async ({ fullPage = false, annotate = false, hint_id } = {}) => {
      try {
        if (hint_id && (fullPage || annotate)) {
          return errorResponse('hint_id is mutually exclusive with fullPage and annotate. Use hint_id alone for element screenshots.');
        }

        const page = await getPage({ state });
        await page.waitForFunction(
          () => document.body && document.body.getBoundingClientRect().height > 100,
          { timeout: 3000 }
        ).catch(() => {});

        if (annotate) {
          await syncState(page, state, { force: true });
          const hints = state.hintMap ?? [];
          if (hints.length > 0) {
            await page.evaluate((hintItems) => {
              const container = document.createElement('div');
              container.id = '__grasp_annotations__';
              container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';

              for (const h of hintItems) {
                const el = document.elementFromPoint(h.x, h.y);
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                const box = document.createElement('div');
                box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid rgba(255,0,0,0.7);box-sizing:border-box;pointer-events:none;`;

                const tag = document.createElement('div');
                const labelTop = rect.top > 16 ? '-16px' : `${rect.height + 2}px`;
                tag.style.cssText = `position:absolute;left:0;top:${labelTop};background:rgba(255,0,0,0.85);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;`;
                tag.textContent = h.id;
                box.appendChild(tag);
                container.appendChild(box);
              }
              document.body.appendChild(container);
            }, hints);
          }
        }

        if (hint_id) {
          const normalizedId = String(hint_id).trim();
          await syncState(page, state, { force: true });
          const selector = `[data-grasp-id="${normalizedId}"]`;
          const el = page.locator(selector);
          const count = await el.count();
          if (count === 0) {
            return errorResponse(`Element [${normalizedId}] not found for screenshot. Call get_hint_map to refresh available IDs.`);
          }
          const box = await el.first().boundingBox();
          if (!box || box.width === 0 || box.height === 0) {
            return errorResponse(`Element [${normalizedId}] is not visible (zero bounds). Scroll it into view first.`);
          }
          const viewport = page.viewportSize() || await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }));
          const clip = {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.min(box.width, viewport.width - Math.max(0, box.x)),
            height: Math.min(box.height, viewport.height - Math.max(0, box.y)),
          };
          if (clip.width <= 0 || clip.height <= 0) {
            return errorResponse(`Element [${normalizedId}] is outside the viewport. Use scroll_into_view first.`);
          }
          const base64 = await page.screenshot({ encoding: 'base64', clip });
          return imageResponse(base64);
        }

        const base64 = await page.screenshot({ encoding: 'base64', fullPage });

        if (annotate) {
          await page.evaluate(() => {
            const overlay = document.getElementById('__grasp_annotations__');
            if (overlay) overlay.remove();
          });
        }

        return imageResponse(base64);
      } catch (err) {
        try {
          const p = await getPage({ state });
          await p.evaluate(() => {
            const overlay = document.getElementById('__grasp_annotations__');
            if (overlay) overlay.remove();
          });
        } catch {
          // ignore cleanup errors
        }
        return errorResponse(`Screenshot failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'get_tabs',
    {
      description: 'List all open browser tabs with index, title, and URL.',
      inputSchema: {},
    },
    async () => {
      const tabs = await listTabs();
      await audit('get_tabs', `${tabs.length} tabs`, null, state);
      return textResponse(
        tabs.map((tab, index) => `[${tab.index ?? index}] ${tab.title} — ${tab.url}`).join('\n'),
        { tabs }
      );
    }
  );

  server.registerTool(
    'switch_tab',
    {
      description: 'Switch to a browser tab by its index (from get_tabs).',
      inputSchema: {
        index: z.number().int().min(0).describe('Tab index to switch to'),
      },
    },
    async ({ index }) => {
      const confirmationError = await requireActionConfirmation('switch_tab');
      if (confirmationError) return confirmationError;
      const page = await activateTab(index);
      await syncState(page, state, { force: true });
      await audit('switch_tab', `index=${index}`, null, state);
      return textResponse(
        `Switched to tab [${index}]: ${page.url()}`,
        { index, url: page.url() }
      );
    }
  );

  server.registerTool(
    'new_tab',
    {
      description: 'Open a new browser tab and navigate to the given URL.',
      inputSchema: {
        url: z.string().url().describe('URL to open in new tab'),
      },
    },
    async ({ url }) => {
      const confirmationError = await requireActionConfirmation('new_tab');
      if (confirmationError) return confirmationError;
      const page = await openTab(url);
      await syncState(page, state, { force: true });
      await audit('new_tab', url, null, state);
      return textResponse(
        `Opened new tab: ${page.url()}`,
        { url: page.url() }
      );
    }
  );

  server.registerTool(
    'close_tab',
    {
      description: 'Close a browser tab by its index.',
      inputSchema: {
        index: z.number().int().min(0).describe('Tab index to close'),
      },
    },
    async ({ index }) => {
      const confirmationError = await requireActionConfirmation('close_tab');
      if (confirmationError) return confirmationError;
      await closeBrowserTab(index);
      await audit('close_tab', `index=${index}`, null, state);
      const remaining = await listTabs();
      return textResponse(
        `Closed tab [${index}]. ${remaining.length} tabs remaining.`,
        { closedIndex: index, remainingTabs: remaining.length }
      );
    }
  );

  server.registerTool(
    'evaluate',
    {
      description: 'Execute JavaScript in the browser page. Use specialized tools (click, type, etc.) when possible — this is a low-level escape hatch.',
      inputSchema: {
        expression: z.string().describe('JavaScript expression to evaluate (can be async)'),
      },
    },
    async ({ expression }) => {
      const confirmationError = await requireActionConfirmation('evaluate');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      try {
        const result = await page.evaluate(expression);
        const serialized = result === undefined ? null : result;
        const output = typeof serialized === 'string' ? serialized : JSON.stringify(serialized, null, 2);
        const truncated = output && output.length > 10240 ? `${output.slice(0, 10240)}\n...(truncated)` : output;
        await audit('evaluate', expression.slice(0, 100), null, state);
        return textResponse(truncated ?? 'undefined', { type: typeof result });
      } catch (err) {
        await audit('evaluate_error', err.message.slice(0, 100), null, state);
        return errorResponse(`Evaluate failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'handle_dialog',
    {
      description: 'Handle a browser dialog (alert/confirm/prompt). The dialog must already be open.',
      inputSchema: {
        action: z.enum(['accept', 'dismiss']).describe('Whether to accept or dismiss the dialog'),
        text: z.string().optional().describe('Text to enter for prompt dialogs (only used with accept)'),
      },
    },
    async ({ action, text }) => {
      const confirmationError = await requireActionConfirmation('handle_dialog');
      if (confirmationError) return confirmationError;
      if (!state.pendingDialog) {
        return errorResponse('No dialog is currently open. Dialogs are captured automatically when they appear.');
      }
      const dialog = state.pendingDialog;
      try {
        if (action === 'accept') {
          await dialog.ref.accept(text ?? '');
        } else {
          await dialog.ref.dismiss();
        }
        const info = { type: dialog.type, message: dialog.message, action };
        state.pendingDialog = null;
        await audit('handle_dialog', `${action} ${dialog.type}: "${dialog.message}"`, null, state);
        return textResponse(`Dialog ${action}ed. Type: ${dialog.type}, Message: "${dialog.message}"`, info);
      } catch (err) {
        state.pendingDialog = null;
        return errorResponse(`Dialog handling failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'upload_file',
    {
      description: 'Upload file(s) to a file input element identified by hint ID.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID of the file input element'),
        file_paths: z.array(z.string()).min(1).describe('Array of absolute file paths to upload'),
      },
    },
    async ({ hint_id, file_paths }) => {
      const confirmationError = await requireActionConfirmation('upload_file');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      await syncState(page, state);
      const normalizedId = String(hint_id).trim();
      const selector = `[data-grasp-id="${normalizedId}"]`;

      const elInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        return { found: true, tag: el.tagName, type: el.type || null };
      }, selector);

      if (!elInfo.found) {
        return errorResponse(`Element [${normalizedId}] not found.`);
      }
      if (elInfo.tag !== 'INPUT' || elInfo.type !== 'file') {
        return errorResponse(`Element [${normalizedId}] is not a file input (found: <${elInfo.tag} type="${elInfo.type}">).`);
      }

      const locator = page.locator(selector);
      await locator.setInputFiles(file_paths);
      await syncState(page, state, { force: true });
      await audit('upload_file', `[${normalizedId}] ${file_paths.length} file(s)`, null, state);
      return textResponse(
        `Uploaded ${file_paths.length} file(s) to [${normalizedId}]: ${file_paths.map((p) => p.split(/[/\\]/).pop()).join(', ')}`,
        { hint_id: normalizedId, files: file_paths }
      );
    }
  );

  server.registerTool(
    'drag',
    {
      description: 'Drag an element and drop it onto another element, both identified by hint ID.',
      inputSchema: {
        from_hint_id: z.string().describe('Hint ID of the element to drag'),
        to_hint_id: z.string().describe('Hint ID of the drop target'),
      },
    },
    async ({ from_hint_id, to_hint_id }) => {
      const confirmationError = await requireActionConfirmation('drag');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      await syncState(page, state);
      const fromId = String(from_hint_id).trim();
      const toId = String(to_hint_id).trim();
      const fromSel = `[data-grasp-id="${fromId}"]`;
      const toSel = `[data-grasp-id="${toId}"]`;

      const boxes = await page.evaluate(({ fs, ts }) => {
        const from = document.querySelector(fs);
        const to = document.querySelector(ts);
        if (!from) return { error: 'from_not_found' };
        if (!to) return { error: 'to_not_found' };
        const fb = from.getBoundingClientRect();
        const tb = to.getBoundingClientRect();
        return {
          from: { x: fb.x + (fb.width / 2), y: fb.y + (fb.height / 2), label: from.textContent?.slice(0, 30) },
          to: { x: tb.x + (tb.width / 2), y: tb.y + (tb.height / 2), label: to.textContent?.slice(0, 30) },
        };
      }, { fs: fromSel, ts: toSel });

      if (boxes.error === 'from_not_found') return errorResponse(`Source element [${fromId}] not found.`);
      if (boxes.error === 'to_not_found') return errorResponse(`Target element [${toId}] not found.`);

      const steps = 8;
      const dx = (boxes.to.x - boxes.from.x) / steps;
      const dy = (boxes.to.y - boxes.from.y) / steps;

      await page.mouse.move(boxes.from.x, boxes.from.y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i += 1) {
        await page.mouse.move(
          boxes.from.x + (dx * i),
          boxes.from.y + (dy * i),
        );
        await new Promise((resolve) => setTimeout(resolve, 30 + (Math.random() * 50)));
      }
      await page.mouse.up();

      await syncState(page, state, { force: true });
      await audit('drag', `[${fromId}] → [${toId}]`, null, state);
      return textResponse(
        `Dragged [${fromId}] "${boxes.from.label}" → [${toId}] "${boxes.to.label}"`,
        { from: fromId, to: toId }
      );
    }
  );

  server.registerTool(
    'go_back',
    {
      description: 'Navigate back in browser history (like pressing the Back button).',
      inputSchema: {},
    },
    async () => {
      const confirmationError = await requireActionConfirmation('go_back');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      const prevUrl = page.url();
      const resp = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
      await syncState(page, state, { force: true });
      const newUrl = page.url();
      await audit('go_back', `${prevUrl} → ${newUrl}`, null, state);
      if (!resp && newUrl === prevUrl) {
        return textResponse('No previous page in history.', { url: newUrl, changed: false });
      }
      return textResponse(`Navigated back: ${newUrl}`, { url: newUrl, changed: newUrl !== prevUrl });
    }
  );

  server.registerTool(
    'go_forward',
    {
      description: 'Navigate forward in browser history.',
      inputSchema: {},
    },
    async () => {
      const confirmationError = await requireActionConfirmation('go_forward');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      const prevUrl = page.url();
      const resp = await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
      await syncState(page, state, { force: true });
      const newUrl = page.url();
      await audit('go_forward', `${prevUrl} → ${newUrl}`, null, state);
      if (!resp && newUrl === prevUrl) {
        return textResponse('No forward page in history.', { url: newUrl, changed: false });
      }
      return textResponse(`Navigated forward: ${newUrl}`, { url: newUrl, changed: newUrl !== prevUrl });
    }
  );

  server.registerTool(
    'reload',
    {
      description: 'Reload the current page.',
      inputSchema: {},
    },
    async () => {
      const confirmationError = await requireActionConfirmation('reload');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      const url = page.url();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await syncState(page, state, { force: true });
      await audit('reload', url, null, state);
      return textResponse(`Reloaded: ${url}`, { url });
    }
  );

  server.registerTool(
    'get_console_logs',
    {
      description: 'Get captured browser console messages. Logs are captured automatically in the background.',
      inputSchema: {
        level: z.enum(['all', 'error', 'warning', 'info', 'log', 'debug']).optional().describe('Filter by log level (default: all)'),
        clear: z.boolean().optional().describe('Clear the log buffer after returning (default: false)'),
      },
    },
    async ({ level = 'all', clear = false }) => {
      try {
        await getPageWithListeners({ state });
      } catch {
        // ok if no page
      }
      let logs = state.consoleLogs || [];
      if (level !== 'all') {
        logs = logs.filter((log) => log.level === level);
      }
      const result = logs.map((log) => `[${log.level}] ${log.text}`).join('\n') || '(no logs)';
      const meta = { count: logs.length, total: state.consoleLogs?.length ?? 0 };
      if (clear) {
        state.consoleLogs = [];
      }
      await audit('get_console_logs', `${logs.length} entries (level=${level}, clear=${clear})`, null, state);
      return textResponse(result, meta);
    }
  );

  server.registerTool(
    'get_cookies',
    {
      description: 'Get browser cookies, optionally filtered by URL/domain.',
      inputSchema: {
        url: z.string().optional().describe('URL to filter cookies for (e.g., "https://example.com")'),
      },
    },
    async ({ url } = {}) => {
      const page = await getPageWithListeners({ state });
      const context = page.context();
      const filterUrl = url || page.url();
      const cookies = await context.cookies(filterUrl);
      await audit('get_cookies', `${cookies.length} cookies for ${filterUrl}`, null, state);
      const summary = cookies.map((cookie) => `${cookie.name}=${cookie.value.slice(0, 40)}${cookie.value.length > 40 ? '...' : ''} (domain=${cookie.domain})`).join('\n') || '(no cookies)';
      return textResponse(summary, { count: cookies.length, cookies });
    }
  );

  server.registerTool(
    'set_cookie',
    {
      description: 'Set a browser cookie.',
      inputSchema: {
        name: z.string().describe('Cookie name'),
        value: z.string().describe('Cookie value'),
        domain: z.string().optional().describe('Cookie domain (e.g., ".example.com")'),
        path: z.string().optional().describe('Cookie path (default: "/")'),
        httpOnly: z.boolean().optional().describe('HTTP only flag'),
        secure: z.boolean().optional().describe('Secure flag'),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
      },
    },
    async ({ name, value, domain, path = '/', httpOnly, secure, sameSite }) => {
      const confirmationError = await requireActionConfirmation('set_cookie');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      const context = page.context();
      const pageUrl = new URL(page.url());
      const cookie = {
        name,
        value,
        domain: domain || pageUrl.hostname,
        path,
        ...(httpOnly !== undefined && { httpOnly }),
        ...(secure !== undefined && { secure }),
        ...(sameSite && { sameSite }),
      };
      await context.addCookies([cookie]);
      await audit('set_cookie', `${name}=${value.slice(0, 20)} domain=${cookie.domain}`, null, state);
      return textResponse(`Cookie set: ${name}=${value.slice(0, 40)} (domain=${cookie.domain})`, { cookie });
    }
  );

  server.registerTool(
    'clear_cookies',
    {
      description: 'Clear all browser cookies for the current context.',
      inputSchema: {},
    },
    async () => {
      const confirmationError = await requireActionConfirmation('clear_cookies');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      const context = page.context();
      await context.clearCookies();
      await audit('clear_cookies', 'all cookies cleared', null, state);
      return textResponse('All cookies cleared.');
    }
  );

  server.registerTool(
    'wait_for',
    {
      description: 'Wait for a condition: text to appear, text to disappear, or URL to contain a string.',
      inputSchema: {
        text: z.string().optional().describe('Wait for this text to appear on the page'),
        text_gone: z.string().optional().describe('Wait for this text to disappear from the page'),
        url_contains: z.string().optional().describe('Wait for the page URL to contain this string'),
        timeout: z.number().optional().describe('Timeout in ms (default: 10000)'),
      },
    },
    async ({ text, text_gone, url_contains, timeout = 10000 }) => {
      const provided = [text, text_gone, url_contains].filter((value) => value !== undefined);
      if (provided.length === 0) {
        return errorResponse('Provide exactly one condition: text, text_gone, or url_contains.');
      }
      if (provided.length > 1) {
        return errorResponse('Provide only one condition at a time (text, text_gone, or url_contains).');
      }

      const page = await getPageWithListeners({ state });

      try {
        if (text) {
          await page.getByText(text).first().waitFor({ state: 'visible', timeout });
          await audit('wait_for', `text "${text}" appeared`, null, state);
          return textResponse(`Text "${text}" appeared on the page.`);
        }
        if (text_gone) {
          await page.getByText(text_gone).first().waitFor({ state: 'hidden', timeout });
          await audit('wait_for', `text "${text_gone}" gone`, null, state);
          return textResponse(`Text "${text_gone}" is no longer visible.`);
        }
        if (url_contains) {
          await page.waitForURL(`**/*${url_contains}*`, { timeout });
          await syncState(page, state, { force: true });
          await audit('wait_for', `url contains "${url_contains}"`, null, state);
          return textResponse(`URL now contains "${url_contains}": ${page.url()}`);
        }
      } catch {
        const condition = text ? `text "${text}"` : text_gone ? `text_gone "${text_gone}"` : `url "${url_contains}"`;
        return errorResponse(`Timeout waiting for ${condition} after ${timeout}ms.`);
      }
    }
  );

  server.registerTool(
    'double_click',
    {
      description: 'Double-click an element by hint ID.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID from get_hint_map'),
      },
    },
    async ({ hint_id }) => {
      const confirmationError = await requireActionConfirmation('double_click');
      if (confirmationError) return confirmationError;
      const normalizedHintId = String(hint_id).trim();
      const page = await getPageWithListeners({ state });
      await syncState(page, state);
      const rebuildHints = createRebuildHints(page, state);

      const result = await clickByHintId(page, normalizedHintId, { rebuildHints, clickCount: 2 });
      await syncState(page, state, { force: true });
      await audit('double_click', `[${normalizedHintId}] "${result.label}"`, null, state);
      return textResponse(
        `Double-clicked [${normalizedHintId}]: "${result.label}"\nPage now has ${state.hintMap?.length ?? 0} elements.`,
        { hint_id: normalizedHintId, label: result.label }
      );
    }
  );

  server.registerTool(
    'check',
    {
      description: 'Set the checked state of a checkbox or radio button by hint ID.',
      inputSchema: {
        hint_id: z.string().describe('Hint ID of the checkbox or radio element'),
        checked: z.boolean().optional().describe('Desired state: true to check, false to uncheck (default: true)'),
      },
    },
    async ({ hint_id, checked = true }) => {
      const confirmationError = await requireActionConfirmation('check');
      if (confirmationError) return confirmationError;
      const normalizedId = String(hint_id).trim();
      const page = await getPageWithListeners({ state });
      await syncState(page, state);
      const selector = `[data-grasp-id="${normalizedId}"]`;

      const elInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        return {
          found: true,
          tag: el.tagName,
          type: (el.type || '').toLowerCase(),
          isChecked: el.checked ?? false,
        };
      }, selector);

      if (!elInfo.found) {
        return errorResponse(`Element [${normalizedId}] not found.`);
      }
      if (elInfo.tag !== 'INPUT' || !['checkbox', 'radio'].includes(elInfo.type)) {
        return errorResponse(`Element [${normalizedId}] is not a checkbox or radio (found: <${elInfo.tag} type="${elInfo.type}">).`);
      }

      if (elInfo.isChecked === checked) {
        await audit('check', `[${normalizedId}] already ${checked ? 'checked' : 'unchecked'}`, null, state);
        return textResponse(`[${normalizedId}] is already ${checked ? 'checked' : 'unchecked'}. No action taken.`, { hint_id: normalizedId, checked, changed: false });
      }

      const locator = page.locator(selector);
      await locator.click();
      await syncState(page, state, { force: true });

      await audit('check', `[${normalizedId}] → ${checked ? 'checked' : 'unchecked'}`, null, state);
      return textResponse(
        `[${normalizedId}] is now ${checked ? 'checked' : 'unchecked'}.`,
        { hint_id: normalizedId, checked, changed: true }
      );
    }
  );

  server.registerTool(
    'key_down',
    {
      description: 'Press and hold a key without releasing. Use key_up to release. Useful for Shift+Click, Ctrl+Drag, etc.',
      inputSchema: {
        key: z.string().describe('Key name (e.g., "Shift", "Control", "Alt", "Meta", "a")'),
      },
    },
    async ({ key }) => {
      const confirmationError = await requireActionConfirmation('key_down');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      await page.keyboard.down(key);
      await audit('key_down', key, null, state);
      return textResponse(`Key "${key}" pressed and held. Use key_up to release.`);
    }
  );

  server.registerTool(
    'key_up',
    {
      description: 'Release a previously held key.',
      inputSchema: {
        key: z.string().describe('Key name to release (e.g., "Shift", "Control", "Alt", "Meta", "a")'),
      },
    },
    async ({ key }) => {
      const confirmationError = await requireActionConfirmation('key_up');
      if (confirmationError) return confirmationError;
      const page = await getPageWithListeners({ state });
      await page.keyboard.up(key);
      await audit('key_up', key, null, state);
      return textResponse(`Key "${key}" released.`);
    }
  );
}
