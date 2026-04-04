import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';

import { registerGatewayTools } from '../../src/server/tools.gateway.js';

import { resolveGatewayDeps } from '../../src/server/tools.gateway.deps.js';


function createBossPage({ url, title, selectors }) {
  return createFakePage({
    url: () => url,
    title: () => title,
    evaluate: async (fn, ...args) => {
      const saved = new Map();
      saved.set('document', globalThis.document);
      globalThis.document = {
        querySelector: (selector) => selectors[selector] ?? null,
        querySelectorAll: (selector) => selectors[selector] ?? [],
      };

      try {
        return await fn(...args);
      } finally {
        globalThis.document = saved.get('document');
      }
    },
  });
}

test('resolveGatewayDeps preserves explicit overrides and fills defaults', async () => {
  const explicit = {
    enterWithStrategy: async () => 'entered',
    getActivePage: async () => 'page',
  };

  const resolved = resolveGatewayDeps(explicit);

  assert.equal(resolved.enter, explicit.enterWithStrategy);
  assert.equal(resolved.getPage, explicit.getActivePage);
  assert.equal(typeof resolved.getBrowserInstance, 'function');
  assert.equal(typeof resolved.writeArtifact, 'function');
  assert.equal(typeof resolved.clearHandoff, 'function');
});

test('entry returns a gateway response with strategy metadata', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  let receivedArgs;
  registerGatewayTools(server, state, {
    enterWithStrategy: async (args) => {
      receivedArgs = args;
      return { url: 'https://example.com', title: 'Example', preflight: { session_trust: 'high' }, pageState: state.pageState };
    },
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://example.com' });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.url, 'https://example.com');
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
  assert.equal(result.meta.agent_boundary.key, 'public_read');
  assert.deepEqual(result.meta.runtime_state, {
    goal: 'Read the current page on the active route and extract useful content.',
    current_boundary: 'public_read',
    redlines: ['page-changing actions', 'form_runtime tools', 'workspace_runtime tools'],
    evidence_anchor: {
      route_mode: 'public_read',
      page_role: 'content',
      url: 'https://example.com',
      handoff_state: 'idle',
      instance_display: null,
    },
    next_gap: 'Need fresh readable-page evidence before deeper actions.',
  });
  assert.equal(receivedArgs.deps.auditName, 'entry');
});

test('entry marks low-trust preheat outcomes as warmup', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'low', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://github.com', title: 'GitHub', preflight: { session_trust: 'low', recommended_entry_strategy: 'preheat_before_direct_entry' }, pageState: state.pageState }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'warmup');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'preheat_session');
});

test('entry reports the resolved final url instead of echoing the requested target url', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'medium', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({
      url: 'https://www.zhipin.com/',
      final_url: 'https://www.zhipin.com/zhengzhou/?seoRefer=index',
      title: 'BOSS直聘',
      preflight: { session_trust: 'medium', recommended_entry_strategy: 'direct' },
      pageState: state.pageState,
      verified: false,
    }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://www.zhipin.com/', intent: 'extract' });

  assert.equal(result.meta.page.url, 'https://www.zhipin.com/zhengzhou/?seoRefer=index');
});

test('entry marks handoff or preheat outcomes as gated', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    lastUrl: 'https://example.com/current',
    pageState: { currentRole: 'checkpoint', graspConfidence: 'low', riskGateDetected: true },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://github.com', title: 'Just a moment', preflight: { session_trust: 'low', recommended_entry_strategy: 'handoff_or_preheat' }, pageState: state.pageState, handoff: { state: 'handoff_required' } }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'gated');
  assert.equal(result.meta.page.url, 'https://example.com/current');
  assert.equal(result.meta.continuation.can_continue, false);
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(result.meta.continuation.handoff_state, 'handoff_required');
  assert.equal(result.meta.agent_boundary.key, 'handoff');
});

test('entry ignores stale handoff state after a verified direct public entry', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: {
      state: 'awaiting_reacquisition',
      expected_url_contains: 'github.com',
      continuation_goal: 'resume_private_session',
    },
  };
  const persisted = [];
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({
      url: 'https://example.com',
      title: 'Example',
      preflight: { session_trust: 'medium', recommended_entry_strategy: 'direct' },
      pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'handoff_required', expected_url_contains: 'github.com' },
      verified: true,
      final_url: 'https://example.com',
    }),
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = {
        currentRole: 'content',
        graspConfidence: 'high',
        riskGateDetected: false,
      };
      return currentState;
    },
    writeHandoffState: async (snapshot) => {
      persisted.push(snapshot);
    },
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const inspect = calls.find((tool) => tool.name === 'inspect');
  const result = await entry.handler({ url: 'https://example.com', intent: 'extract' });
  const inspectResult = await inspect.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.agent_boundary.key, 'public_read');
  assert.equal(result.meta.route.selected_mode, 'public_read');
  assert.equal(result.meta.continuation.suggested_next_action, 'extract');
  assert.equal(state.handoff.state, 'idle');
  assert.equal(state.handoff.expected_url_contains, null);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].state, 'idle');
  assert.equal(inspectResult.meta.status, 'direct');
  assert.equal(inspectResult.meta.continuation.suggested_next_action, 'extract');
});

test('entry ignores stale handoff state after a verified direct form entry', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({
      url: 'https://httpbin.org/forms/post',
      title: 'HTTPBin Form',
      preflight: { session_trust: 'medium', recommended_entry_strategy: 'direct' },
      pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'handoff_required', expected_url_contains: 'github.com' },
      verified: true,
      final_url: 'https://httpbin.org/forms/post',
    }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://httpbin.org/forms/post', intent: 'submit' });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.agent_boundary.key, 'form_runtime');
  assert.equal(result.meta.route.selected_mode, 'form_runtime');
  assert.equal(result.meta.continuation.suggested_next_action, 'form_inspect');
});

test('entry keeps public navigation-heavy pages on extract instead of workspace continuation', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false, workspaceSurface: null },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({
      url: 'https://github.com/vercel/next.js',
      title: 'GitHub - vercel/next.js',
      preflight: { session_trust: 'low', recommended_entry_strategy: 'preheat_before_direct_entry' },
      pageState: { currentRole: 'navigation-heavy', workspaceSurface: 'list', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: 'idle' },
      verified: true,
      final_url: 'https://github.com/vercel/next.js',
    }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com/vercel/next.js', intent: 'extract' });

  assert.equal(result.meta.route.selected_mode, 'public_read');
  assert.equal(result.meta.agent_boundary.key, 'public_read');
  assert.equal(result.meta.continuation.suggested_next_action, 'extract');
});

test('inspect returns current gateway page status without raw primitive wording', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const inspect = calls.find((tool) => tool.name === 'inspect');
  const result = await inspect.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.page_role, 'content');
  assert.equal(result.meta.continuation.suggested_next_action, 'extract');
  assert.doesNotMatch(result.content[0].text, /page_role|handoff_state|suggested_next_action/);
});

test('inspect tolerates transient page.title failures after a redirecting runtime navigation', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  let titleReads = 0;
  const page = createFakePage({
    url: () => 'https://www.zhipin.com/zhengzhou/?seoRefer=index',
    title: async () => {
      titleReads += 1;
      if (titleReads === 1) {
        throw new Error('Execution context was destroyed, most likely because of a navigation');
      }
      return 'BOSS直聘';
    },
  });
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const inspect = calls.find((tool) => tool.name === 'inspect');
  const result = await inspect.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.title, 'BOSS直聘');
  assert.equal(titleReads, 2);
});

test('inspect reports runtime instance identity when available', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    getBrowserInstance: async () => ({
      browser: 'HeadlessChrome/136.0.7103.114',
      display: 'headless',
      warning: 'Current endpoint is a headless browser, not a visible local browser window.',
    }),
  });

  const inspect = calls.find((tool) => tool.name === 'inspect');
  const result = await inspect.handler();

  assert.match(result.content[0].text, /Instance: headless/);
  assert.match(result.content[0].text, /Current endpoint is a headless browser, not a visible local browser window\./);
  assert.equal(result.meta.runtime.instance.browser, 'HeadlessChrome/136.0.7103.114');
});

test('entry is blocked until the runtime instance is explicitly confirmed', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => {
      throw new Error('entry should not run before confirmation');
    },
    getBrowserInstance: async () => ({
      browser: 'Chrome/136.0.7103.114',
      display: 'windowed',
      warning: null,
    }),
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://example.com' });

  assert.match(result.content[0].text, /Runtime instance confirmation required/);
  assert.equal(result.meta.error_code, 'INSTANCE_CONFIRMATION_REQUIRED');
});

test('inspect and continue pass state into the active page lookup', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });
  const state = {
    activeTaskId: 'task-a',
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };
  let inspectArgs = null;
  let continueArgs = null;

  registerGatewayTools(server, state, {
    getActivePage: async (args) => {
      if (!inspectArgs) {
        inspectArgs = args;
      } else {
        continueArgs = args;
      }
      return page;
    },
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const inspect = calls.find((tool) => tool.name === 'inspect');
  const continueTool = calls.find((tool) => tool.name === 'continue');

  await inspect.handler();
  await continueTool.handler();

  assert.equal(inspectArgs.state, state);
  assert.equal(continueArgs.state, state);
});

test('extract returns summary, main text, and markdown in one payload', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => ({ title: 'Example', text: 'Example summary. More body text.' }),
  });

  const extract = calls.find((tool) => tool.name === 'extract');
  const result = await extract.handler({ include_markdown: true });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.engine, 'data');
  assert.equal(result.meta.result.surface, 'content');
  assert.equal(result.meta.result.title, 'Example');
  assert.equal(result.meta.result.url, 'https://example.com');
  assert.equal(result.meta.result.summary, 'Example summary');
  assert.equal(result.meta.result.main_text, 'Example summary. More body text.');
  assert.match(result.meta.result.markdown, /^# /);
});

test('extract_structured returns a structured record plus JSON and Markdown exports', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/profile',
    title: () => 'Candidate Profile',
  });
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => ({
      title: 'Candidate Profile',
      text: '职位: 前端工程师\n公司名称: OpenAI\n城市: San Francisco',
    }),
    extractStructuredContent: async (_page, fields) => ({
      requested_fields: fields,
      record: {
        职位: '前端工程师',
        公司名称: 'OpenAI',
      },
      missing_fields: ['邮箱'],
      evidence: [
        { field: '职位', label: '职位', value: '前端工程师', strategy: 'inline_pair' },
        { field: '公司名称', label: '公司名称', value: 'OpenAI', strategy: 'inline_pair' },
      ],
    }),
  });

  const extractStructured = calls.find((tool) => tool.name === 'extract_structured');
  const result = await extractStructured.handler({
    fields: ['职位', '公司名称', '邮箱'],
    include_markdown: true,
  });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.engine, 'data');
  assert.equal(result.meta.result.title, 'Candidate Profile');
  assert.deepEqual(result.meta.result.structured.requested_fields, ['职位', '公司名称', '邮箱']);
  assert.deepEqual(result.meta.result.structured.record, {
    职位: '前端工程师',
    公司名称: 'OpenAI',
  });
  assert.deepEqual(result.meta.result.structured.missing_fields, ['邮箱']);
  assert.equal(typeof result.meta.result.exports.json, 'string');
  assert.match(result.meta.result.exports.json, /"公司名称": "OpenAI"/);
  assert.match(result.meta.result.exports.markdown, /^# Candidate Profile/);
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
});

test('extract uses fast path on BOSS pages and skips heavy read dependencies', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };
  let receivedPageArg = null;
  let syncCalls = 0;
  const page = createBossPage({
    url: 'https://www.zhipin.com/web/geek/jobs?query=ai',
    title: 'BOSS直聘 - 搜索',
    selectors: {
      'a[href*="job_detail"]': [
        { innerText: '算法工程师', textContent: '算法工程师', href: '/job_detail/1.html', getAttribute: (name) => (name === 'href' ? '/job_detail/1.html' : null) },
        { innerText: '推荐算法工程师', textContent: '推荐算法工程师', href: '/job_detail/2.html', getAttribute: (name) => (name === 'href' ? '/job_detail/2.html' : null) },
      ],
    },
  });

  registerGatewayTools(server, state, {
    getActivePage: async (args) => {
      receivedPageArg = args;
      return page;
    },
    syncPageState: async (_page, currentState, options) => {
      syncCalls += 1;
      currentState.pageState = state.pageState;
      assert.deepEqual(options, { force: true });
      return currentState;
    },
    waitUntilStable: async () => {
      throw new Error('waitUntilStable should not run on fast path');
    },
    extractMainContent: async () => {
      throw new Error('extractMainContent should not run on fast path');
    },
  });

  const extract = calls.find((tool) => tool.name === 'extract');
  const result = await extract.handler({ include_markdown: true });

  assert.equal(receivedPageArg.state, state);
  assert.equal(syncCalls, 1);
  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.engine, 'runtime');
  assert.equal(result.meta.result.surface, 'search');
  assert.equal(result.meta.result.title, 'BOSS直聘 - 搜索');
  assert.equal(result.meta.result.url, 'https://www.zhipin.com/web/geek/jobs?query=ai');
  assert.equal(result.meta.result.main_text, '算法工程师\n推荐算法工程师');
  assert.match(result.meta.result.markdown, /^# BOSS直聘 - 搜索/);
});

test('extract uses the runtime branch for non-BOSS runtime hosts', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };
  let syncCalls = 0;
  let extractCalls = 0;
  const page = createFakePage({
    url: () => 'https://mp.weixin.qq.com/',
    title: () => '微信公众平台',
  });

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState, options) => {
      syncCalls += 1;
      currentState.pageState = state.pageState;
      assert.deepEqual(options, { force: true });
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => {
      extractCalls += 1;
      return { title: '微信公众平台', text: 'Runtime branch content.' };
    },
  });

  const extract = calls.find((tool) => tool.name === 'extract');
  const result = await extract.handler();

  assert.equal(syncCalls, 1);
  assert.equal(extractCalls, 1);
  assert.equal(result.meta.result.engine, 'runtime');
  assert.equal(result.meta.result.surface, 'content');
  assert.equal(result.meta.result.url, 'https://mp.weixin.qq.com/');
});

test('extract falls back to the old path on non-BOSS pages', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };
  let syncCalls = 0;
  let extractCalls = 0;
  const page = createFakePage({
    url: () => 'https://example.com',
    title: () => 'Example',
  });

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      syncCalls += 1;
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => {
      extractCalls += 1;
      return { title: 'Example', text: 'Example body text.' };
    },
  });

  const extract = calls.find((tool) => tool.name === 'extract');
  const result = await extract.handler();

  assert.equal(syncCalls, 1);
  assert.equal(extractCalls, 1);
  assert.equal(result.meta.result.engine, 'data');
  assert.equal(result.meta.result.surface, 'content');
  assert.equal(result.meta.result.title, 'Example');
  assert.equal(result.meta.result.url, 'https://example.com');
  assert.equal(result.meta.result.main_text, 'Example body text.');
});

test('inspect and extract block checkpoint pages with handoff guidance', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/checkpoint',
    title: () => 'Just a moment',
  });
  const state = {
    pageState: { currentRole: 'checkpoint', graspConfidence: 'low', riskGateDetected: true },
    handoff: { state: 'handoff_required' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => ({ title: 'Just a moment', text: 'Please wait...' }),
  });

  const inspect = calls.find((tool) => tool.name === 'inspect');
  const extract = calls.find((tool) => tool.name === 'extract');

  const inspectResult = await inspect.handler();
  const extractResult = await extract.handler();

  assert.equal(inspectResult.meta.status, 'handoff_required');
  assert.equal(inspectResult.meta.continuation.can_continue, false);
  assert.equal(inspectResult.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(inspectResult.meta.continuation.handoff_state, 'handoff_required');

  assert.equal(extractResult.meta.status, 'handoff_required');
  assert.equal(extractResult.meta.continuation.can_continue, false);
  assert.equal(extractResult.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(extractResult.meta.continuation.handoff_state, 'handoff_required');
});

test('inspect and extract stay blocked while handoff recovery is still in progress', async () => {
  for (const handoffState of ['handoff_in_progress', 'awaiting_reacquisition']) {
    const calls = [];
    const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
    const page = createFakePage({
      url: () => 'https://example.com/after-human-step',
      title: () => 'Example',
    });
    const state = {
      lastUrl: 'https://example.com/after-human-step',
      pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
      handoff: { state: handoffState },
    };

    registerGatewayTools(server, state, {
      getActivePage: async () => page,
      syncPageState: async (_page, currentState) => {
        currentState.pageState = state.pageState;
        return currentState;
      },
      waitUntilStable: async () => ({ stable: true }),
      extractMainContent: async () => ({ title: 'Example', text: 'Readable body that should stay blocked until resume.' }),
    });

    const inspect = calls.find((tool) => tool.name === 'inspect');
    const extract = calls.find((tool) => tool.name === 'extract');

    const inspectResult = await inspect.handler();
    const extractResult = await extract.handler();

    assert.equal(inspectResult.meta.status, 'handoff_required');
    assert.equal(inspectResult.meta.continuation.can_continue, false);
    assert.equal(inspectResult.meta.continuation.suggested_next_action, 'request_handoff');
    assert.equal(inspectResult.meta.continuation.handoff_state, handoffState);

    assert.equal(extractResult.meta.status, 'handoff_required');
    assert.equal(extractResult.meta.continuation.can_continue, false);
    assert.equal(extractResult.meta.continuation.suggested_next_action, 'request_handoff');
    assert.equal(extractResult.meta.continuation.handoff_state, handoffState);
  }
});

test('continue returns handoff guidance when the page is gated', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/checkpoint',
    title: () => 'Just a moment',
  });
  const state = {
    pageState: { currentRole: 'checkpoint', graspConfidence: 'low', riskGateDetected: true },
    handoff: { state: 'handoff_required' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'handoff_required');
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
});

test('continue suggests form_inspect on direct form pages', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/form',
    title: () => 'Form',
  });
  const state = {
    pageState: { currentRole: 'form', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'form_inspect');
});

test('continue suggests workspace_inspect on direct workspace pages', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/workspace',
    title: () => 'Workspace',
  });
  const state = {
    pageState: { currentRole: 'workspace', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'workspace_inspect');
});

test('continue prefers workspace_inspect when the page affordance is a workspace list', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/cgi-bin/home',
    title: () => 'Control Center',
  });
  const state = {
    pageState: {
      currentRole: 'form',
      workspaceSurface: 'list',
      graspConfidence: 'high',
      riskGateDetected: false,
    },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'workspace_inspect');
});

test('continue prefers workspace_inspect when the hint map exposes a left-rail workspace list', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/cgi-bin/home',
    title: () => 'Control Center',
  });
  const state = {
    hintMap: [
      { id: 'L1', type: 'a', label: '公众号', x: 128, y: 48 },
      { id: 'L2', type: 'a', label: '首页', x: 108, y: 111 },
      { id: 'L3', type: 'a', label: '新的功能', x: 108, y: 598 },
    ],
    pageState: {
      currentRole: 'content',
      workspaceSurface: null,
      graspConfidence: 'medium',
      riskGateDetected: false,
    },
    handoff: { state: 'idle' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      currentState.hintMap = state.hintMap;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'workspace_inspect');
});

test('continue returns resumed workspace guidance with workspace_inspect as the next step', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/workspace/resumed',
    title: () => 'Workspace',
  });
  const state = {
    pageState: { currentRole: 'workspace', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'resumed_verified', expected_url_contains: 'example.com' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'resumed');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'workspace_inspect');
});

test('smoke: entry returns direct on a direct page', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://example.com/', title: 'Example Domain', preflight: { session_trust: 'high' }, pageState: state.pageState }),
    getBrowserInstance: async () => null,
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://example.com/' });

  assert.equal(result.meta.status, 'direct');
  assert.deepEqual(result.meta.result, {});
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
});

test('smoke: extract returns non-empty main text on a readable page', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://example.com/',
    title: () => 'Example Domain',
  });
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true }),
    extractMainContent: async () => ({ title: 'Example Domain', text: 'Example domain content for smoke coverage.' }),
  });

  const extract = calls.find((tool) => tool.name === 'extract');
  const result = await extract.handler();

  assert.equal(result.meta.status, 'direct');
  assert.ok(result.meta.result.main_text.length > 0);
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
});

test('smoke: continue returns handoff guidance on a handoff-required page', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const page = createFakePage({
    url: () => 'https://github.com/login',
    title: () => 'Sign in to GitHub',
  });
  const state = {
    pageState: { currentRole: 'checkpoint', graspConfidence: 'low', riskGateDetected: true },
    handoff: { state: 'handoff_required' },
  };

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
  });

  const continueTool = calls.find((tool) => tool.name === 'continue');
  const result = await continueTool.handler();

  assert.equal(result.meta.status, 'handoff_required');
  assert.equal(result.meta.continuation.can_continue, false);
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(result.meta.continuation.handoff_state, 'handoff_required');
});
