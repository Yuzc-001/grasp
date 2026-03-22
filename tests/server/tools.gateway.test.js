import test from 'node:test';
import assert from 'node:assert/strict';
import { registerGatewayTools } from '../../src/server/tools.gateway.js';

test('entry returns a gateway response with strategy metadata', async () => {
  const calls = [];
  const server = { registerTool(name, spec, handler) { calls.push({ name, handler }); } };
  const state = { pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false }, handoff: { state: 'idle' } };

  registerGatewayTools(server, state, {
    enterWithStrategy: async () => ({ url: 'https://example.com', title: 'Example', preflight: { session_trust: 'high' }, pageState: state.pageState }),
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://example.com' });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.page.url, 'https://example.com');
  assert.equal(result.meta.continuation.suggested_next_action, 'inspect');
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
    enterWithStrategy: async () => ({ url: 'https://github.com', title: 'Just a moment', preflight: { session_trust: 'low', recommended_entry_strategy: 'handoff_or_preheat' }, pageState: state.pageState }),
  });

  const entry = calls.find((tool) => tool.name === 'entry');
  const result = await entry.handler({ url: 'https://github.com' });

  assert.equal(result.meta.status, 'gated');
  assert.equal(result.meta.continuation.can_continue, false);
  assert.equal(result.meta.continuation.suggested_next_action, 'request_handoff');
});
