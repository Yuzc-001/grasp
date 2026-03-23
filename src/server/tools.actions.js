import { z } from 'zod';

import { getActivePage, navigateTo } from '../layer1-bridge/chrome.js';
import { clickByHintId, typeByHintId, hoverByHintId, pressKey, watchElement, scroll } from '../layer3-action/actions.js';
import { errorResponse, textResponse } from './responses.js';
import { describeMode, syncPageState } from './state.js';
import { audit } from './audit.js';
import { verifyTypeResult, verifyGenericAction } from './postconditions.js';
import { TYPE_FAILED } from './error-codes.js';
import { runVerifiedAction } from '../grasp/verify/pipeline.js';
import { readHandoffState } from '../grasp/handoff/persist.js';
import { extractMainContent } from './content.js';

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

export function registerActionTools(server, state) {
  server.registerTool(
    'navigate',
    {
      description: 'Navigate the browser to a URL and refresh Grasp page state.',
      inputSchema: { url: z.string().url().describe('Full URL to navigate to') },
    },
    async ({ url }) => {
      try {
        const page = await navigateTo(url);
        await syncPageState(page, state, { force: true });
        await audit('navigate', url);
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
        const page = await getActivePage();
        await syncPageState(page, state);
        state.handoff = await readHandoffState();
        const handoff = state.handoff ?? { state: 'idle' };
        const pageState = state.pageState ?? {};
        const { mode, detail } = describeMode(state);

        return textResponse([
          'Grasp is connected',
          '',
          `Page: ${await page.title()}`,
          `URL: ${page.url()}`,
          `Mode: ${mode}`,
          `  ${detail}`,
          `Hint Map: ${state.hintMap.length} elements cached`,
          `Page role: ${pageState.currentRole ?? 'unknown'}`,
          `Grasp confidence: ${pageState.graspConfidence ?? 'unknown'}`,
          `Reacquired: ${pageState.reacquired ? 'yes' : 'no'}`,
          `Risk gate detected: ${pageState.riskGateDetected ? 'yes' : 'no'}`,
          ...(pageState.checkpointKind ? [`Checkpoint kind: ${pageState.checkpointKind}`] : []),
          ...(pageState.checkpointSignals?.length ? [`Checkpoint signals: ${pageState.checkpointSignals.join(', ')}`] : []),
          ...(pageState.suggestedNextAction ? [`Suggested next action: ${pageState.suggestedNextAction}`] : []),
          `Handoff: ${handoff.state}`,
          ...(handoff.reason ? [`  reason: ${handoff.reason}`] : []),
        ], { handoff, pageState });
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
      const page = await getActivePage();
      await syncPageState(page, state);
      const main = await extractMainContent(page);
      const { summary } = describeMode(state);
      return textResponse([
        `Title: ${main.title}`,
        `URL: ${page.url()}`,
        `Mode: ${summary}`,
        '',
        'Visible content (truncated):',
        main.text.slice(0, 2000),
      ]);
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
      const page = await getActivePage();
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
      const page = await getActivePage();
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
          await audit('click_failed', `[${normalizedHintId}] ${failure.error_code}`);
          return buildStructuredError(`Click verification failed for [${normalizedHintId}]`, normalizedHintId, failure);
        },
        onSuccess: async ({ executionResult, evidence }) => {
          await audit('click', `[${normalizedHintId}] "${executionResult.label}"`);
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
      const page = await getActivePage();
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
          await audit('type_failed', `[${normalizedHintId}] ${failure.error_code}`);
          return buildStructuredError(`Type verification failed for [${normalizedHintId}]`, normalizedHintId, failure);
        },
        onSuccess: async ({ executionResult, evidence }) => {
          await audit('type', `[${normalizedHintId}] "${executionResult.text.slice(0, 20)}${executionResult.text.length > 20 ? '...' : ''}"`);
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
      const page = await getActivePage();
      await syncPageState(page, state);
      const prevUrl = page.url();
      const rebuildHints = createRebuildHints(page, state);

      try {
        const result = await hoverByHintId(page, normalizedHintId, { rebuildHints });
        await syncPageState(page, state, { force: true });
        await audit('hover', `[${normalizedHintId}] "${result.label}"`);
        const urlAfter = page.url();
        const nav = urlAfter !== prevUrl ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Hovered over [${normalizedHintId}]: "${result.label}".${nav}\n${state.hintMap.length} elements now visible.`,
          { hint_id: normalizedHintId }
        );
      } catch (err) {
        await audit('hover_failed', `[${normalizedHintId}] ${err.message}`);
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
      const page = await getActivePage();
      await syncPageState(page, state);
      await pressKey(page, key);
      await syncPageState(page, state, { force: true });
      await audit('press_key', key);
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
      const page = await getActivePage();
      const result = await watchElement(page, selector, condition, timeout_ms);
      await audit('watch_element', `${condition} ${selector}`);
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
      description: 'Scroll the current page up or down and refresh page state.',
      inputSchema: {
        direction: z.enum(['up', 'down']).describe('Scroll direction'),
        amount: z.number().int().positive().optional().describe('Scroll amount in pixels'),
      },
    },
    async ({ direction, amount = 600 }) => {
      const page = await getActivePage();
      await syncPageState(page, state);
      await scroll(page, direction, amount);
      await syncPageState(page, state, { force: true });
      await audit('scroll', `${direction} ${amount}`);
      return textResponse(
        `Scrolled ${direction} by ${amount}px.`,
        {
          direction,
          amount,
          page_role: state.pageState?.currentRole ?? 'unknown',
          grasp_confidence: state.pageState?.graspConfidence ?? 'unknown',
          dom_revision: state.pageState?.domRevision ?? 0,
        }
      );
    }
  );
}
