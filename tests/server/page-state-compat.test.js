import test from 'node:test';
import assert from 'node:assert/strict';

import { createPageState, applySnapshotToPageState } from '../../src/server/page-state.js';
import { createPageGraspState, applySnapshotToPageGraspState } from '../../src/grasp/page/state.js';

test('legacy server page-state exports point at the grasp page-state implementation', () => {
  const legacyState = createPageState();
  const graspState = createPageGraspState();

  assert.deepEqual(legacyState, graspState);

  const legacyNext = applySnapshotToPageState(legacyState, {
    url: 'https://mp.weixin.qq.com/',
    snapshotHash: 'snap-1',
    title: '微信公众平台',
    bodyText: '使用账号登录 立即注册',
    nodes: 12,
    forms: 1,
    navs: 2,
    headings: ['微信公众平台'],
  });
  const graspNext = applySnapshotToPageGraspState(graspState, {
    url: 'https://mp.weixin.qq.com/',
    snapshotHash: 'snap-1',
    title: '微信公众平台',
    bodyText: '使用账号登录 立即注册',
    nodes: 12,
    forms: 1,
    navs: 2,
    headings: ['微信公众平台'],
  });

  assert.deepEqual(legacyNext, graspNext);
  assert.equal(legacyNext.currentRole, 'content');
});
