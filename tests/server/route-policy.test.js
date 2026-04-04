import test from 'node:test';
import assert from 'node:assert/strict';

import { decideRoute, resolveRouteIntent } from '../../src/server/route-policy.js';

test('auth role no longer defaults route intent to submit', () => {
  const intent = resolveRouteIntent({
    pageState: { currentRole: 'auth' },
    lastIntent: null,
  });

  assert.equal(intent, 'act');
});

test('extract intent on auth-labeled pages does not auto-route into form_runtime', () => {
  const route = decideRoute({
    url: 'https://github.com/vercel/next.js',
    intent: 'extract',
    selection: { engine: 'data' },
    preflight: { session_trust: 'low', recommended_entry_strategy: 'preheat_before_direct_entry' },
    pageState: { currentRole: 'auth', workspaceSurface: null, riskGateDetected: false },
    handoff: { state: 'idle' },
  });

  assert.equal(route.selected_mode, 'public_read');
  assert.notEqual(route.selected_mode, 'form_runtime');
});

test('navigation-heavy public pages do not auto-route into workspace_runtime', () => {
  const intent = resolveRouteIntent({
    intent: 'extract',
    pageState: { currentRole: 'navigation-heavy', workspaceSurface: 'list' },
    lastIntent: null,
  });
  const route = decideRoute({
    url: 'https://github.com/vercel/next.js',
    intent,
    selection: { engine: 'data' },
    preflight: { session_trust: 'low', recommended_entry_strategy: 'preheat_before_direct_entry' },
    pageState: { currentRole: 'navigation-heavy', workspaceSurface: 'list', riskGateDetected: false },
    handoff: { state: 'idle' },
  });

  assert.equal(intent, 'extract');
  assert.equal(route.selected_mode, 'public_read');
  assert.notEqual(route.selected_mode, 'workspace_runtime');
});

test('wechat public platform landing page stays on live_session instead of form_runtime', () => {
  const route = decideRoute({
    url: 'https://mp.weixin.qq.com/',
    intent: 'extract',
    selection: { engine: 'runtime' },
    preflight: { session_trust: 'medium', recommended_entry_strategy: 'direct' },
    pageState: { currentRole: 'content', workspaceSurface: null, riskGateDetected: false },
    handoff: { state: 'idle' },
  });

  assert.equal(route.selected_mode, 'live_session');
  assert.notEqual(route.selected_mode, 'form_runtime');
});
