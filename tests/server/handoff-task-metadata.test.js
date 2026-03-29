import test from 'node:test';
import assert from 'node:assert/strict';
import { attachHandoffTaskMetadata } from '../../src/grasp/handoff/persist.js';

test('attachHandoffTaskMetadata merges task metadata onto handoff state', () => {
  const handoff = { state: 'handoff_required', reason: 'login_required' };
  const source = {
    taskId: 'task-123',
    siteKey: 'boss-zhipin',
    sessionKey: 'geek-user-1',
    lastUrl: 'https://www.zhipin.com/web/geek/chat',
  };

  const result = attachHandoffTaskMetadata(handoff, source);

  assert.equal(result.state, 'handoff_required');
  assert.equal(result.taskId, 'task-123');
  assert.equal(result.siteKey, 'boss-zhipin');
  assert.equal(result.sessionKey, 'geek-user-1');
  assert.equal(result.lastUrl, 'https://www.zhipin.com/web/geek/chat');
});

test('attachHandoffTaskMetadata preserves existing metadata when source is empty', () => {
  const handoff = {
    state: 'idle',
    taskId: 'task-123',
    siteKey: 'boss-zhipin',
  };

  const result = attachHandoffTaskMetadata(handoff, {});

  assert.equal(result.taskId, 'task-123');
  assert.equal(result.siteKey, 'boss-zhipin');
});
