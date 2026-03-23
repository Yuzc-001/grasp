import { z } from 'zod';

import { getActivePage, navigateTo, getTabs, switchTab, newTab, closeTab } from '../layer1-bridge/chrome.js';
import { callTool } from '../layer1-bridge/webmcp.js';
import { buildHintMap, rebindHintCandidate } from '../layer2-perception/hints.js';
import { clickByHintId, typeByHintId, scroll, watchElement, pressKey, hoverByHintId } from '../layer3-action/actions.js';
import { errorResponse, imageResponse, textResponse } from './responses.js';
import { describeMode, syncPageState } from './state.js';
import { rankAffordances } from './affordances.js';
import { extractMainContent, waitUntilStable } from './content.js';
import { audit, readLogs } from './audit.js';
import { verifyTypeResult, verifyGenericAction } from './postconditions.js';
import { normalizeFormField, summarizeFormFields, buildFormVerification } from './form-tasks.js';
import { runSearchTaskTool } from './tasks/search-task.js';
import { TYPE_FAILED } from './error-codes.js';
import { runVerifiedAction } from '../grasp/verify/pipeline.js';
import {
  requestHandoff,
  markHandoffInProgress,
  markAwaitingReacquisition,
  markResumedUnverified,
  markResumeVerified,
  clearHandoff,
} from '../grasp/handoff/events.js';
import { capturePageEvidence } from '../grasp/verify/evidence.js';
import { readHandoffState, writeHandoffState } from '../grasp/handoff/persist.js';

const HIGH_RISK_KEYWORDS = [
  '发送', '提交', '删除', '支付', '确认', '清空', '注销', '退出', '解绑', '重置',
  'send', 'submit', 'delete', 'pay', 'confirm', 'clear', 'logout', 'unsubscribe', 'reset', 'remove',
];

async function getActiveHintId(page) {
  return page.evaluate(() => document.activeElement?.getAttribute('data-grasp-id') ?? null);
}

function createRebuildHints(page, state) {
  return async (hintId) => {
    const previousHint = state.hintMap.find((hint) => hint.id === hintId);
    await syncPageState(page, state, { force: true });
    if (!previousHint) return null;
    return rebindHintCandidate(previousHint, state.hintMap);
  };
}

function buildStructuredError(message, normalizedHintId, verdict) {
  const meta = {
    error_code: verdict?.error_code ?? TYPE_FAILED,
    retryable: verdict?.retryable ?? true,
    suggested_next_step: verdict?.suggested_next_step ?? 'retry',
    evidence: verdict?.evidence ?? { hint_id: normalizedHintId },
  };
  return errorResponse(message, meta);
}

export function registerTools(server, state) {
  server.registerTool(
    'navigate',
    {
      description: 'Navigate the browser to a URL. Auto-detects WebMCP support on arrival.',
      inputSchema: { url: z.string().url().describe('Full URL to navigate to') },
    },
    async ({ url }) => {
      try {
        const page = await navigateTo(url);
        audit('navigate', url);
        await syncPageState(page, state, { force: true });
        const title = await page.title();

        if (state.webmcp?.available) {
          return textResponse([
            `Navigated to: ${url}`,
            `Page title: ${title}`,
            `WebMCP detected - ${state.webmcp.tools.length} native tool(s): ${state.webmcp.tools.map((tool) => tool.name).join(', ')}`,
            'Use call_webmcp_tool to invoke them directly.',
          ]);
        }

        return textResponse([
          `Navigated to: ${url}`,
          `Page title: ${title}`,
          `CDP mode - ${state.hintMap.length} interactive elements found.`,
          'Use get_hint_map to see the full element map.',
        ]);
      } catch (err) {
        return errorResponse(`Navigation failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'get_status',
    {
      description: 'Get current Grasp engine status: Chrome connection, current page, execution mode.',
      inputSchema: {},
    },
    async () => {
      try {
        const page = await getActivePage();
        await syncPageState(page, state);
        const title = await page.title();
        const { mode, detail } = describeMode(state);

        state.handoff = await readHandoffState();
        const handoff = state.handoff ?? { state: 'idle' };
        const pageState = state.pageState ?? {};
        return textResponse([
          'Grasp is connected',
          '',
          `Page: ${title}`,
          `URL: ${page.url()}`,
          `Mode: ${mode}`,
          `  ${detail}`,
          `Hint Map: ${state.hintMap.length} elements cached`,
          `Page role: ${pageState.currentRole ?? 'unknown'}`,
          `Grasp confidence: ${pageState.graspConfidence ?? 'unknown'}`,
          `Reacquired: ${pageState.reacquired ? 'yes' : 'no'}`,
          `Handoff: ${handoff.state}`,
          ...(handoff.reason ? [`  reason: ${handoff.reason}`] : []),
        ]);
      } catch (err) {
        return errorResponse(`Grasp is NOT connected.\n${err.message}`);
      }
    }
  );

  server.registerTool(
    'request_handoff',
    {
      description: 'Mark that the current task/page requires a human step before the agent can continue.',
      inputSchema: {
        reason: z.string().describe('Why human help is required, e.g. login_required, captcha_required'),
        note: z.string().optional().describe('Optional note for the human/operator'),
      },
    },
    async ({ reason, note }) => {
      state.handoff = requestHandoff(await readHandoffState(), reason, note ?? null);
      await writeHandoffState(state.handoff);
      await audit('handoff_request', `${reason}${note ? ` :: ${note}` : ''}`);
      return textResponse([
        `Handoff requested: ${reason}`,
        ...(note ? [`Note: ${note}`] : []),
        'State: handoff_required',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'mark_handoff_in_progress',
    {
      description: 'Mark that a human is currently performing the required browser step.',
      inputSchema: {
        note: z.string().optional().describe('Optional note about the in-progress human step'),
      },
    },
    async ({ note } = {}) => {
      state.handoff = markHandoffInProgress(state.handoff, note ?? null);
      await audit('handoff_progress', note ?? 'in progress');
      return textResponse([
        'Handoff is now in progress.',
        ...(note ? [`Note: ${note}`] : []),
        'State: handoff_in_progress',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'mark_handoff_done',
    {
      description: 'Mark that the human step is done and Grasp should now reacquire the page state.',
      inputSchema: {
        note: z.string().optional().describe('Optional note left by the human/operator'),
      },
    },
    async ({ note } = {}) => {
      state.handoff = markAwaitingReacquisition(await readHandoffState(), note ?? null);
      await writeHandoffState(state.handoff);
      await audit('handoff_done', note ?? 'awaiting reacquisition');
      return textResponse([
        'Human step marked done.',
        ...(note ? [`Note: ${note}`] : []),
        'State: awaiting_reacquisition',
        'Next: call resume_after_handoff to reacquire page state.',
      ], { handoff: state.handoff });
    }
  );

  server.registerTool(
    'resume_after_handoff',
    {
      description: 'Reacquire page state after a human step, then mark the handoff as resumed (verified or unverified).',
      inputSchema: {
        verify: z.boolean().optional().describe('Whether to require visible reacquisition evidence before marking verified (default: true)'),
        note: z.string().optional().describe('Optional note about the resumed state'),
      },
    },
    async ({ verify = true, note } = {}) => {
      const page = await getActivePage();
      await syncPageState(page, state, { force: true });
      const evidence = await capturePageEvidence(page, state, {
        action: 'resume_after_handoff',
        details: {
          pageIdentity: state.pageState?.pageIdentity ?? null,
        },
      });

      if (verify && state.pageState?.reacquired) {
        state.handoff = markResumeVerified(state.handoff, evidence, note ?? null);
      } else {
        state.handoff = markResumedUnverified(state.handoff, evidence, note ?? null);
      }

      await audit('handoff_resume', `${state.handoff.state}${note ? ` :: ${note}` : ''}`);
      return textResponse([
        `Resume state: ${state.handoff.state}`,
        `Page role: ${state.pageState?.currentRole ?? 'unknown'}`,
        `Grasp confidence: ${state.pageState?.graspConfidence ?? 'unknown'}`,
        `Reacquired: ${state.pageState?.reacquired ? 'yes' : 'no'}`,
      ], { handoff: state.handoff, evidence });
    }
  );

  server.registerTool(
    'clear_handoff',
    {
      description: 'Clear the current handoff state and return to idle.',
      inputSchema: {},
    },
    async () => {
      state.handoff = clearHandoff(await readHandoffState());
      await writeHandoffState(state.handoff);
      await audit('handoff_clear', 'idle');
      return textResponse('Handoff cleared. State: idle', { handoff: state.handoff });
    }
  );

  server.registerTool(
    'get_page_summary',
    {
      description: 'Get a summary of the current page: title, URL, mode, and visible text content.',
      inputSchema: {},
    },
    async () => {
      const page = await getActivePage();
      await syncPageState(page, state);

      const text = await page.evaluate(() =>
        document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 2000) ?? ''
      );
      const { summary } = describeMode(state);

      return textResponse([
        `Title: ${await page.title()}`,
        `URL: ${page.url()}`,
        `Mode: ${summary}`,
        '',
        'Visible content (truncated):',
        text,
      ]);
    }
  );

  server.registerTool(
    'wait_until_stable',
    {
      description: 'Wait until the page stops changing before reading content.',
      inputSchema: {
        checks: z.number().int().min(1).optional().describe('Number of consecutive stable snapshots required'),
        interval: z.number().min(0).optional().describe('Polling interval in milliseconds'),
        timeout: z.number().min(0).optional().describe('Maximum wait time in milliseconds'),
      },
    },
    async ({ checks, interval, timeout } = {}) => {
      const page = await getActivePage();
      const result = await waitUntilStable(page, {
        stableChecks: checks,
        interval,
        timeout,
      });
      return textResponse(
        [
          result.stable ? 'Page stabilized.' : 'Page did not stabilize in time.',
          `Captured ${result.attempts} snapshots.`,
        ],
        {
          stable: result.stable,
          attempts: result.attempts,
          snapshot: result.snapshot,
        }
      );
    }
  );

  server.registerTool(
    'extract_main_content',
    {
      description: 'Extract the main textual content for the current page.',
      inputSchema: {},
    },
    async () => {
      const page = await getActivePage();
      await syncPageState(page, state, { force: true });
      const content = await extractMainContent(page);
      return textResponse(
        content.text,
        {
          title: content.title,
        }
      );
    }
  );

  server.registerTool(
    'get_hint_map',
    {
      description: "Get the Hint Map of interactive elements. Each element gets a short ID like [B1], [I2], [L3]. Use these IDs with click and type.",
      inputSchema: {
        filter: z.string().optional().describe('Optional keyword to filter elements by label (case-insensitive). E.g. "发送" returns only elements whose label contains "发送".'),
      },
    },
    async ({ filter } = {}) => {
      const page = await getActivePage();
      await syncPageState(page, state);
      const hints = await buildHintMap(page, state.hintRegistry, state.hintCounters);
      state.hintMap = hints;

      if (hints.length === 0) {
        return textResponse('No interactive elements found in the current viewport.');
      }

      const keyword = filter?.trim().toLowerCase();
      const filtered = keyword
        ? hints.filter((h) => h.label.toLowerCase().includes(keyword))
        : hints;

      if (filtered.length === 0) {
        return textResponse(`No elements matching "${filter}". Total elements: ${hints.length}. Call get_hint_map without filter to see all.`);
      }

      const lines = filtered.map((hint) => `[${hint.id}] ${hint.label}  (${hint.type}, pos:${hint.x},${hint.y})`);
      const header = keyword
        ? `Found ${filtered.length} elements matching "${filter}" (${hints.length} total):`
        : `Found ${hints.length} interactive elements:`;

      const hintChars = lines.join('\n').length;
      const rawSize = await page.evaluate(() => document.documentElement.outerHTML.length);
      let efficiency = '';
      if (rawSize > 0 && hintChars < rawSize) {
        const savedPct = Math.round((1 - hintChars / rawSize) * 100);
        efficiency = `\n\nToken efficiency: ~${savedPct}% saved vs raw HTML`
          + ` (hint map: ${(hintChars / 1000).toFixed(1)}K chars,`
          + ` raw DOM: ${(rawSize / 1000).toFixed(1)}K chars)`;
      }
      return textResponse(`${header}\n\n${lines.join('\n')}${efficiency}`);
    }
  );

  server.registerTool(
    'search_affordances',
    {
      description: 'Rank search-friendly hints (inputs/buttons) from the current hint map.',
      inputSchema: {},
    },
    async () => {
      const page = await getActivePage();
      await syncPageState(page, state, { force: true });
      const ranking = rankAffordances({ hints: state.hintMap });
      return textResponse(
        `Search affordance candidates: ${ranking.search_input.length}`,
        {
          search_input: ranking.search_input,
          command_button: ranking.command_button,
        }
      );
    }
  );

  server.registerTool(
    'search_task',
    {
      description: 'Run a verified search task with bounded recovery.',
      inputSchema: {
        query: z.string().describe('Query text to run through search workflow'),
        max_attempts: z.number().int().min(1).optional().describe('Maximum attempts before giving up'),
      },
    },
    async ({ query, max_attempts = 3 }) => {
      return runSearchTaskTool({ state, query, max_attempts });
    }
  );

  server.registerTool(
    'click',
    {
      description: "Click an element by its Hint Map ID (e.g. 'B1'). Call get_hint_map first if you don't have IDs.",
      inputSchema: { hint_id: z.string().describe('Hint Map ID like B1, I2, L3') },
    },
    async ({ hint_id }) => {
      const page = await getActivePage();
      const normalizedHintId = hint_id.toUpperCase();
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = state.lastUrl;
      const prevActiveId = await getActiveHintId(page);
      const rebuildHints = createRebuildHints(page, state);

      try {
        if (state.safeMode) {
          const label = await page.evaluate((id) => {
            const el = document.querySelector(`[data-grasp-id="${id}"]`);
            if (!el) return '';
            return el.getAttribute('aria-label') || el.innerText?.trim() || '';
          }, normalizedHintId);
          if (HIGH_RISK_KEYWORDS.some(k => label.toLowerCase().includes(k.toLowerCase()))) {
            return textResponse([
              `High-risk action detected: [${normalizedHintId}] "${label}"`,
              'To proceed, call confirm_click with the same hint_id.',
              'To disable safe mode globally, set GRASP_SAFE_MODE=false in environment.',
            ]);
          }
        }

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
            newDomRevision: state.pageState.domRevision,
          }),
          onFailure: async (failure) => {
            await audit('click_failed', `[${normalizedHintId}] ${failure.error_code}`);
            return buildStructuredError(
              `Click verification failed for [${normalizedHintId}]`,
              normalizedHintId,
              failure
            );
          },
          onSuccess: async ({ executionResult, evidence }) => {
            audit('click', `[${normalizedHintId}] "${executionResult.label}"`);
            const urlAfter = page.url();
            const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
            return textResponse(
              `Clicked [${normalizedHintId}]: "${executionResult.label}"${nav}\nPage now has ${state.hintMap.length} elements. Call get_hint_map to see updated state.`,
              { evidence }
            );
          },
        });
      } catch (err) {
        await audit('click_failed', `[${normalizedHintId}] ${err.message}`);
        return buildStructuredError(`Click failed: ${err.message}`, normalizedHintId);
      }
    }
  );

  server.registerTool(
    'confirm_click',
    {
      description: "Force-click a high-risk element, bypassing safe mode. Use only after explicitly confirming the action is intended.",
      inputSchema: { hint_id: z.string().describe('Hint Map ID to force-click, e.g. B1') },
    },
    async ({ hint_id }) => {
      const page = await getActivePage();
      const normalizedHintId = hint_id.toUpperCase();
      const rebuildHints = createRebuildHints(page, state);
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = state.lastUrl;
      const prevActiveId = await getActiveHintId(page);

      try {
        const result = await clickByHintId(page, normalizedHintId, { rebuildHints });
        await syncPageState(page, state, { force: true });
        const verification = await verifyGenericAction({
          page,
          hintId: normalizedHintId,
          prevDomRevision,
          prevUrl,
          prevActiveId,
          newDomRevision: state.pageState.domRevision,
        });

        if (!verification.ok) {
          await audit('confirm_click_failed', `[${normalizedHintId}] ${verification.error_code}`);
          return buildStructuredError(
            `Confirm click verification failed for [${normalizedHintId}]`,
            normalizedHintId,
            verification
          );
        }

        await audit('confirm_click', `[${normalizedHintId}] "${result.label}"`);
        const urlAfter = page.url();
        const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Force-clicked [${normalizedHintId}]: "${result.label}"${nav}\nPage now has ${state.hintMap.length} elements.`
        );
      } catch (err) {
        await audit('confirm_click_failed', `[${normalizedHintId}] ${err.message}`);
        return buildStructuredError(`confirm_click failed: ${err.message}`, normalizedHintId);
      }
    }
  );

  server.registerTool(
    'type',
    {
      description: 'Type text into an input field by its Hint Map ID. Clears existing content first.',
      inputSchema: {
        hint_id: z.string().describe('Hint Map ID of the input field, e.g. I1'),
        text: z.string().describe('Text to type'),
        press_enter: z.boolean().optional().describe('Press Enter after typing (default: false)'),
      },
    },
    async ({ hint_id, text, press_enter = false }) => {
      const page = await getActivePage();
      const normalizedHintId = hint_id.toUpperCase();
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = page.url();
      const rebuildHints = createRebuildHints(page, state);

      try {
        await typeByHintId(page, normalizedHintId, text, press_enter, { rebuildHints });
        await syncPageState(page, state, { force: true });
        const newDomRevision = state.pageState?.domRevision ?? prevDomRevision;
        const verdict = await verifyTypeResult({
          page,
          expectedText: text,
          allowPageChange: press_enter,
          prevUrl,
          prevDomRevision,
          newDomRevision,
        });
        if (!verdict.ok) {
          await audit('type_failed', `[${normalizedHintId}] ${verdict.error_code}`);
          await syncPageState(page, state, { force: true });
          return buildStructuredError(
            `Type verification failed for [${normalizedHintId}]`,
            normalizedHintId,
            verdict
          );
        }

        await audit('type', `[${normalizedHintId}] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`);
        await syncPageState(page, state, { force: true });

        return textResponse(
          `Typed "${text}" into [${normalizedHintId}]${press_enter ? ' and pressed Enter' : ''}.`
        );
      } catch (err) {
        await audit('type_failed', `[${normalizedHintId}] ${err.message}`);
        await syncPageState(page, state, { force: true });
        return buildStructuredError(
          `Type failed: ${err.message}`,
          normalizedHintId,
          {
            error_code: TYPE_FAILED,
            retryable: true,
            suggested_next_step: 'retry',
            evidence: { hint_id: normalizedHintId, reason: err.message },
          }
        );
      }
    }
  );

  server.registerTool(
    'screenshot',
    {
      description: 'Take a screenshot of the current browser viewport.',
      inputSchema: {},
    },
    async () => {
      const page = await getActivePage();
      // Wait for body to have actual content before screenshotting (prevents thin-line bug)
      await page.waitForFunction(
        () => document.body && document.body.getBoundingClientRect().height > 100,
        { timeout: 3000 }
      ).catch(() => {});
      const base64 = await page.screenshot({ encoding: 'base64', fullPage: false });
      return imageResponse(base64);
    }
  );

  server.registerTool(
    'scroll',
    {
      description: 'Scroll the page up or down to reveal more content.',
      inputSchema: {
        direction: z.enum(['up', 'down']).describe('Scroll direction'),
        amount: z.number().optional().describe('Pixels to scroll (default: 600)'),
      },
    },
    async ({ direction, amount = 600 }) => {
      const page = await getActivePage();
      await scroll(page, direction, amount);
      audit('scroll', `${direction} ${amount}px`);
      await syncPageState(page, state, { force: true });

      return textResponse(`Scrolled ${direction} by ${amount}px. ${state.hintMap.length} elements now visible.`);
    }
  );

  server.registerTool(
    'watch_element',
    {
      description: 'Watch a CSS selector for DOM changes. Waits up to 30 seconds.',
      inputSchema: {
        selector: z.string().describe('CSS selector to watch'),
        condition: z.enum(['appears', 'disappears', 'changes']).describe('Condition to wait for'),
      },
    },
    async ({ selector, condition }) => {
      const page = await getActivePage();
      const result = await watchElement(page, selector, condition);

      if (result.timeout) {
        return textResponse(`watch_element timed out after 30s waiting for "${selector}" to ${condition}.`);
      }

      return textResponse(
        `Condition met: "${selector}" ${condition}.${result.text ? `\nContent: "${result.text}"` : ''}`
      );
    }
  );

  server.registerTool(
    'call_webmcp_tool',
    {
      description: 'Call a native WebMCP tool exposed by the current page. Only available in WebMCP mode.',
      inputSchema: {
        tool_name: z.string().describe('Name of the WebMCP tool to call'),
        args: z.record(z.any()).optional().describe('Arguments to pass to the tool'),
      },
    },
    async ({ tool_name, args = {} }) => {
      const page = await getActivePage();
      await syncPageState(page, state);

      if (!state.webmcp?.available) {
        return errorResponse('WebMCP not available. Use CDP tools instead (get_hint_map -> click/type).');
      }

      try {
        const result = await callTool(page, state.webmcp, tool_name, args);

        return textResponse([
          `WebMCP tool "${tool_name}" result:`,
          '',
          typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        ]);
      } catch (err) {
        await syncPageState(page, state, { force: true });
        return errorResponse(
          `WebMCP call failed: ${err.message}\nWebMCP status after re-probe: ${state.webmcp?.available ? 'still available' : 'unavailable - use CDP tools instead'}`
        );
      }
    }
  );

  server.registerTool(
    'get_tabs',
    {
      description: 'List all open browser tabs with their index, title, and URL.',
      inputSchema: {},
    },
    async () => {
      try {
        const tabs = await getTabs();
        const lines = tabs.map((t) => `[${t.index}] ${t.title || '(no title)'}  ${t.url}`);
        return textResponse(`${tabs.length} open tabs:\n\n${lines.join('\n')}`);
      } catch (err) {
        return errorResponse(`get_tabs failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'switch_tab',
    {
      description: 'Switch to a tab by its index (from get_tabs).',
      inputSchema: { index: z.number().int().describe('Tab index from get_tabs') },
    },
    async ({ index }) => {
      try {
        const page = await switchTab(index);
        await syncPageState(page, state, { force: true });
        return textResponse(`Switched to tab [${index}]: ${page.url()}`);
      } catch (err) {
        return errorResponse(`switch_tab failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'new_tab',
    {
      description: 'Open a URL in a new browser tab and switch to it.',
      inputSchema: { url: z.string().url().describe('URL to open in new tab') },
    },
    async ({ url }) => {
      try {
        const page = await newTab(url);
        await syncPageState(page, state, { force: true });
        const title = await page.title();
        return textResponse(`Opened new tab: ${title}\nURL: ${url}`);
      } catch (err) {
        return errorResponse(`new_tab failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'close_tab',
    {
      description: 'Close a tab by its index (from get_tabs).',
      inputSchema: { index: z.number().int().describe('Tab index to close') },
    },
    async ({ index }) => {
      try {
        await closeTab(index);
        return textResponse(`Closed tab [${index}].`);
      } catch (err) {
        return errorResponse(`close_tab failed: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'get_logs',
    {
      description: 'Read recent Grasp audit log entries. Shows the last N operations performed.',
      inputSchema: {
        lines: z.number().int().optional().describe('Number of recent log lines to return (default: 50)'),
      },
    },
    async ({ lines = 50 } = {}) => {
      const entries = await readLogs(lines);
      if (entries.length === 0) {
        return textResponse('No audit log entries yet. Log is written to ~/.grasp/audit.log');
      }
      return textResponse(`Last ${entries.length} operations:\n\n${entries.join('\n')}`);
    }
  );

  server.registerTool(
    'press_key',
    {
      description: 'Press a keyboard key or shortcut. Examples: "Enter", "Escape", "Tab", "Control+Enter", "Control+a".',
      inputSchema: { key: z.string().describe('Key or shortcut, e.g. "Enter", "Control+Enter"') },
    },
    async ({ key }) => {
      const page = await getActivePage();
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = state.lastUrl;
      const prevActiveId = await getActiveHintId(page);

      try {
        await pressKey(page, key);
        await syncPageState(page, state, { force: true });
        const verification = await verifyGenericAction({
          page,
          hintId: null,
          prevDomRevision,
          prevUrl,
          prevActiveId,
          newDomRevision: state.pageState.domRevision,
        });

        if (!verification.ok) {
          await audit('press_key_failed', `[${key}] ${verification.error_code}`);
          return buildStructuredError(
            `Press key verification failed for ${key}`,
            key,
            verification
          );
        }

        audit('press_key', key);
        return textResponse(`Pressed: ${key}`);
      } catch (err) {
        await audit('press_key_failed', key);
        return buildStructuredError(`press_key failed: ${err.message}`, key);
      }
    }
  );

  server.registerTool(
    'get_form_fields',
    {
      description: 'Identify form fields on the current page grouped by form. Returns field IDs that can be used directly with type and click.',
      inputSchema: {},
    },
    async () => {
      const page = await getActivePage();
      await syncPageState(page, state);

      const groups = await page.evaluate(() => {
        function getHintId(el) {
          return el.getAttribute('data-grasp-id') || null;
        }

        function getLabelForText(el) {
          const id = el.getAttribute('id');
          if (!id) return '';
          const lbl = document.querySelector(`label[for="${id}"]`);
          return lbl?.textContent?.trim() ?? '';
        }

        function describeField(el) {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag);
          const required = el.required || el.getAttribute('required') !== null;
          return {
            hint_id: getHintId(el),
            tag,
            type,
            required,
            value: 'value' in el ? el.value : null,
            checked: 'checked' in el ? el.checked : null,
            ariaLabelledByText: (() => {
              const labelledBy = el.getAttribute('aria-labelledby');
              if (!labelledBy) return '';
              return labelledBy.trim().split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
                .filter(Boolean)
                .join(' ');
            })(),
            ariaLabel: el.getAttribute('aria-label')?.trim() ?? '',
            labelForText: getLabelForText(el),
            placeholder: el.getAttribute('placeholder')?.trim() ?? '',
            name: el.getAttribute('name')?.trim() ?? '',
          };
        }

        const FIELD_TAGS = new Set(['input', 'textarea', 'select', 'button']);
        const FIELD_TYPES_SKIP = new Set(['hidden']);

        function collectFields(root) {
          return [...root.querySelectorAll('input, textarea, select, button')]
            .filter(el => {
              const type = el.getAttribute('type') || '';
              if (FIELD_TYPES_SKIP.has(type)) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
        }

        // 1. Named <form> groups
        const forms = [...document.querySelectorAll('form')];
        const result = [];

        if (forms.length > 0) {
          for (let i = 0; i < forms.length; i++) {
            const form = forms[i];
            const fields = collectFields(form);
            if (fields.length === 0) continue;
            const action = form.getAttribute('action') || 'no action';
            result.push({
              header: `Form ${i + 1} (action="${action}"):`,
              fields: fields.map(describeField),
            });
          }
        }

        // 2. Fallback: inputs not inside any <form>
        const orphans = [...document.querySelectorAll('input, textarea, select, button')]
          .filter(el => {
            if (!FIELD_TAGS.has(el.tagName.toLowerCase())) return false;
            const type = el.getAttribute('type') || '';
            if (FIELD_TYPES_SKIP.has(type)) return false;
            if (el.closest('form')) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

        if (orphans.length > 0) {
          result.push({
            header: 'Ungrouped fields (no <form> wrapper):',
            fields: orphans.map(describeField),
          });
        }

        return result;
      });

      if (groups.length === 0) {
        return textResponse('No form fields found on the current page. Call get_hint_map to see all interactive elements.');
      }

      const normalizedGroups = groups.map((group) => ({
        header: group.header,
        fields: group.fields.map((field) => {
          const normalized = normalizeFormField(field);
          const idStr = normalized.hint_id ? `[${normalized.hint_id}]` : '(no hint id — call get_hint_map first)';
          return `  ${idStr} ${normalized.label}  (${normalized.type}${normalized.required ? ', required' : ''})`;
        }),
      }));
      const summary = summarizeFormFields(groups.flatMap((group) => group.fields));
      const verification = buildFormVerification(groups.flatMap((group) => group.fields));
      const lines = [
        ...normalizedGroups.flatMap((g) => [g.header, ...g.fields, '']),
        'Summary:',
        ...summary.lines.map((line) => `  ${line}`),
        'Verification:',
        `  completion_status: ${verification.completion_status}`,
        `  missing_required: ${verification.summary.missing_required}`,
        `  risky_pending: ${verification.summary.risky_pending}`,
        `  unresolved: ${verification.summary.unresolved}`,
      ];
      return textResponse(lines.join('\n').trimEnd());
    }
  );

  server.registerTool(
    'hover',
    {
      description: 'Hover over an element by Hint Map ID to trigger dropdown menus or tooltips.',
      inputSchema: { hint_id: z.string().describe('Hint Map ID to hover over, e.g. B1, L3') },
    },
    async ({ hint_id }) => {
      const page = await getActivePage();
      const normalizedHintId = hint_id.toUpperCase();
      const rebuildHints = createRebuildHints(page, state);
      const prevDomRevision = state.pageState?.domRevision ?? 0;
      const prevUrl = state.lastUrl;
      const prevActiveId = await getActiveHintId(page);

      try {
        const result = await hoverByHintId(page, normalizedHintId, { rebuildHints });
        await syncPageState(page, state, { force: true });
        const verification = await verifyGenericAction({
          page,
          hintId: normalizedHintId,
          prevDomRevision,
          prevUrl,
          prevActiveId,
          newDomRevision: state.pageState.domRevision,
        });

        if (!verification.ok) {
          await audit('hover_failed', `[${normalizedHintId}] ${verification.error_code}`);
          return buildStructuredError(
            `Hover verification failed for [${normalizedHintId}]`,
            normalizedHintId,
            verification
          );
        }

        audit('hover', `[${normalizedHintId}] "${result.label}"`);
        const urlAfter = page.url();
        const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Hovered over [${normalizedHintId}]: "${result.label}".${nav}\n${state.hintMap.length} elements now visible.`
        );
      } catch (err) {
        await audit('hover_failed', `[${normalizedHintId}] ${err.message}`);
        await syncPageState(page, state, { force: true });
        return buildStructuredError(
          `hover failed: ${err.message}`,
          normalizedHintId,
          {
            error_code: TYPE_FAILED,
            retryable: true,
            suggested_next_step: 'retry',
            evidence: {
              hint_id: normalizedHintId,
              reason: err.message,
            },
          }
        );
      }
    }
  );
}
