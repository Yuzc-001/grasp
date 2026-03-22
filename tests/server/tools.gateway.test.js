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
  const state = { pageState: { currentRole: 'checkpoint', graspConfidence: 'low', riskGateDetected: true }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://github.com', title: 'Just a moment', preflight: { session_trust: 'low', recommended_entry_strategy: 'handoff_or_preheat' }, pageState: state.pageState, handoff: { state: 'handoff_required' } }),
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'gated');
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

  assert.equal(result.meta.result.summary, 'Example summary');
  assert.equal(result.meta.result.main_text, 'Example summary. More body text.');
  assert.match(result.meta.result.markdown, /^# /);
});
