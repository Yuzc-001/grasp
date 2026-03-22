import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';
import { registerGatewayTools } from '../../src/server/tools.gateway.js';

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
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://example.com' });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.url, 'https://example.com');
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
  assert.equal(receivedArgs.deps.auditName, 'entry');
});

test('entry marks low-trust preheat outcomes as warmup', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'low', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://github.com', title: 'GitHub', preflight: { session_trust: 'low', recommended_entry_strategy: 'preheat_before_direct_entry' }, pageState: state.pageState }),
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'warmup');
  assert.equal(result.meta.continuation.can_continue, true);
  assert.equal(result.meta.continuation.suggested_next_action, 'preheat_session');
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
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'gated');
  assert.equal(result.meta.page.url, 'https://example.com/current');
  assert.equal(result.meta.continuation.can_continue, false);
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
  assert.equal(result.meta.continuation.handoff_state, 'handoff_required');
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
  assert.equal(result.meta.result.summary, 'Example summary');
  assert.equal(result.meta.result.main_text, 'Example summary. More body text.');
  assert.match(result.meta.result.markdown, /^# /);
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

test('smoke: entry returns direct on a direct page', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://example.com/', title: 'Example Domain', preflight: { session_trust: 'high' }, pageState: state.pageState }),
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
