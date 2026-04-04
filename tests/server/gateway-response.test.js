import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGatewayResponse } from '../../src/server/gateway-response.js';

test('buildGatewayResponse returns the normalized gateway shape', () => {
  const response = buildGatewayResponse({
    status: 'direct',
    page: { title: 'Example', url: 'https://example.com', page_role: 'content', risk_gate: false, grasp_confidence: 'high' },
    result: { summary: 'Summary', main_text: 'Body', structured_sections: [], markdown: '# Example\n\nBody' },
    continuation: { can_continue: true, suggested_next_action: 'extract', handoff_state: 'idle' },
    evidence: { source: 'unit-test' },
  });

  assert.equal(response.content[0].type, 'text');
  assert.equal(response.meta.status, 'direct');
  assert.equal(response.meta.page.title, 'Example');
  assert.equal(response.meta.result.markdown, '# Example\n\nBody');
  assert.equal(response.meta.continuation.suggested_next_action, 'extract');
});

test('buildGatewayResponse includes runtime instance metadata when provided', () => {
  const response = buildGatewayResponse({
    status: 'direct',
    page: { title: 'Example', url: 'https://example.com', page_role: 'content', risk_gate: false, grasp_confidence: 'high' },
    continuation: { can_continue: true, suggested_next_action: 'inspect', handoff_state: 'idle' },
    runtime: {
      instance: {
        browser: 'HeadlessChrome/136.0.7103.114',
        display: 'headless',
        warning: 'Current endpoint is a headless browser, not a visible local browser window.',
      },
    },
  });

  assert.match(response.content[0].text, /Instance: headless/);
  assert.match(response.content[0].text, /Current endpoint is a headless browser, not a visible local browser window\./);
  assert.equal(response.meta.runtime.instance.display, 'headless');
});

test('buildGatewayResponse injects agent boundary guidance into text and meta', () => {
  const response = buildGatewayResponse({
    status: 'direct',
    page: { title: 'Example', url: 'https://example.com', page_role: 'content', risk_gate: false, grasp_confidence: 'high' },
    continuation: { can_continue: true, suggested_next_action: 'extract', handoff_state: 'idle' },
    route: { selected_mode: 'public_read' },
  });

  assert.equal(response.meta.agent_boundary.key, 'public_read');
  assert.equal(response.meta.agent_prompt.boundary_key, 'public_read');
  assert.equal(response.meta.agent_prompt.surface_key, 'public_content');
  assert.equal(response.meta.agent_prompt.prompt_pack.boundary, 'public_read');
  assert.equal(response.meta.agent_prompt.prompt_pack.surface, 'public_content');
  assert.match(response.meta.agent_prompt.system_prompt, /Current boundary: public_read/);
  assert.match(response.content[0].text, /Boundary: public_read/);
  assert.match(response.content[0].text, /Boundary guidance:/);
});

test('buildGatewayResponse includes a runtime state register for the active route', () => {
  const response = buildGatewayResponse({
    status: 'direct',
    page: { title: 'Example', url: 'https://example.com', page_role: 'content', risk_gate: false, grasp_confidence: 'high' },
    continuation: { can_continue: true, suggested_next_action: 'extract', handoff_state: 'idle' },
    route: { selected_mode: 'public_read' },
  });

  assert.deepEqual(response.meta.runtime_state, {
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
    next_gap: 'Need fresh extraction evidence from the current readable page.',
  });
});
