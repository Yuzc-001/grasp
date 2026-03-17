import { z } from 'zod';

import { getActivePage, navigateTo, getTabs, switchTab, newTab, closeTab } from '../layer1-bridge/chrome.js';
import { callTool } from '../layer1-bridge/webmcp.js';
import { buildHintMap } from '../layer2-perception/hints.js';
import { clickByHintId, typeByHintId, scroll, watchElement, pressKey, hoverByHintId } from '../layer3-action/actions.js';
import { errorResponse, imageResponse, textResponse } from './responses.js';
import { describeMode, syncPageState } from './state.js';
import { audit, readLogs } from './audit.js';

const HIGH_RISK_KEYWORDS = [
  '发送', '提交', '删除', '支付', '确认', '清空', '注销', '退出', '解绑', '重置',
  'send', 'submit', 'delete', 'pay', 'confirm', 'clear', 'logout', 'unsubscribe', 'reset', 'remove',
];

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

        return textResponse([
          'Grasp is connected',
          '',
          `Page: ${title}`,
          `URL: ${page.url()}`,
          `Mode: ${mode}`,
          `  ${detail}`,
          `Hint Map: ${state.hintMap.length} elements cached`,
        ]);
      } catch (err) {
        return errorResponse(`Grasp is NOT connected.\n${err.message}`);
      }
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
    'click',
    {
      description: "Click an element by its Hint Map ID (e.g. 'B1'). Call get_hint_map first if you don't have IDs.",
      inputSchema: { hint_id: z.string().describe('Hint Map ID like B1, I2, L3') },
    },
    async ({ hint_id }) => {
      const page = await getActivePage();

      try {
        const normalizedHintId = hint_id.toUpperCase();

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

        const urlBefore = page.url();
        const result = await clickByHintId(page, normalizedHintId);
        audit('click', `[${normalizedHintId}] "${result.label}"`);
        await syncPageState(page, state, { force: true });

        const urlAfter = page.url();
        const nav = urlAfter !== urlBefore ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Clicked [${normalizedHintId}]: "${result.label}"${nav}\nPage now has ${state.hintMap.length} elements. Call get_hint_map to see updated state.`
        );
      } catch (err) {
        return errorResponse(`Click failed: ${err.message}`);
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
      try {
        const normalizedHintId = hint_id.toUpperCase();
        const urlBefore = page.url();
        const result = await clickByHintId(page, normalizedHintId);
        audit('confirm_click', `[${normalizedHintId}] "${result.label}"`);
        await syncPageState(page, state, { force: true });

        const urlAfter = page.url();
        const nav = urlAfter !== urlBefore ? `\nNavigated to: ${urlAfter}` : '';
        return textResponse(
          `Force-clicked [${normalizedHintId}]: "${result.label}"${nav}\nPage now has ${state.hintMap.length} elements.`
        );
      } catch (err) {
        return errorResponse(`confirm_click failed: ${err.message}`);
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

      try {
        const normalizedHintId = hint_id.toUpperCase();
        await typeByHintId(page, normalizedHintId, text, press_enter);
        audit('type', `[${normalizedHintId}] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`);
        await syncPageState(page, state, { force: true });

        return textResponse(
          `Typed "${text}" into [${normalizedHintId}]${press_enter ? ' and pressed Enter' : ''}.`
        );
      } catch (err) {
        return errorResponse(`Type failed: ${err.message}`);
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
      try {
        const page = await getActivePage();
        await pressKey(page, key);
        audit('press_key', key);
        return textResponse(`Pressed: ${key}`);
      } catch (err) {
        return errorResponse(`press_key failed: ${err.message}`);
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

        function getFieldLabel(el) {
          // aria-labelledby
          const labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            const text = labelledBy.trim().split(/\s+/)
              .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
              .filter(Boolean).join(' ');
            if (text) return text;
          }
          if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
          // <label for="id">
          const id = el.getAttribute('id');
          if (id) {
            const lbl = document.querySelector(`label[for="${id}"]`);
            if (lbl?.textContent?.trim()) return lbl.textContent.trim();
          }
          if (el.getAttribute('placeholder')?.trim()) return el.getAttribute('placeholder').trim();
          if (el.getAttribute('name')?.trim()) return el.getAttribute('name').trim();
          return el.tagName.toLowerCase();
        }

        function describeField(el) {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag);
          const required = el.required || el.getAttribute('required') !== null;
          const hintId = getHintId(el);
          const label = getFieldLabel(el);
          const idStr = hintId ? `[${hintId}]` : '(no hint id — call get_hint_map first)';
          return `  ${idStr} ${label}  (${type}${required ? ', required' : ''})`;
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

      const lines = groups.flatMap(g => [g.header, ...g.fields, '']);
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
      try {
        const page = await getActivePage();
        const result = await hoverByHintId(page, hint_id.toUpperCase());
        audit('hover', `[${hint_id.toUpperCase()}] "${result.label}"`);
        await syncPageState(page, state, { force: true });
        return textResponse(
          `Hovered over [${hint_id.toUpperCase()}]: "${result.label}". ${state.hintMap.length} elements now visible.`
        );
      } catch (err) {
        return errorResponse(`hover failed: ${err.message}`);
      }
    }
  );
}
