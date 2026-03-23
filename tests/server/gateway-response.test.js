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
