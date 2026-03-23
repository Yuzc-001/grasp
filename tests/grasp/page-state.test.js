import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageGraspState, applySnapshotToPageGraspState } from '../../src/grasp/page/state.js';

test('page grasp state starts unknown', () => {
  const state = createPageGraspState();
  assert.equal(state.currentRole, 'unknown');
  assert.equal(state.graspConfidence, 'unknown');
});

test('page grasp state classifies auth page and marks reacquired on first capture', () => {
  const state = createPageGraspState();
  const next = applySnapshotToPageGraspState(state, {
    url: 'https://github.com/login',
    snapshotHash: 'h1',
    bodyText: 'Sign in to GitHub Username or email address Password',
    nodes: 7,
    forms: 2,
    navs: 1,
    headings: ['Sign in to GitHub'],
  });

  assert.equal(next.currentRole, 'auth');
  assert.equal(next.reacquired, true);
  assert.equal(next.pageIdentity, 'https://github.com/login#0');
});

test('page grasp state classifies docs pages more accurately', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://playwright.dev/docs/intro',
    snapshotHash: 'b',
    bodyText: 'Getting Started Installation On this page Installation What\'s next',
    nodes: 8,
    forms: 0,
    navs: 3,
    headings: ['Installation', 'Getting Started'],
  });

  assert.equal(state.currentRole, 'docs');
});

test('page grasp state keeps simple content pages as content', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://example.com/',
    snapshotHash: 'x',
    bodyText: 'Example Domain This domain is for use in illustrative examples in documents.',
    nodes: 1,
    forms: 0,
    navs: 0,
    headings: ['Example Domain'],
  });

  assert.equal(state.currentRole, 'content');
});

test('page grasp state classifies challenge-style pages as checkpoint', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://chatgpt.com/',
    snapshotHash: 'gate',
    title: 'Just a moment...',
    bodyText: '',
    nodes: 0,
    forms: 0,
    navs: 0,
    headings: [],
  });

  assert.equal(state.currentRole, 'checkpoint');
  assert.equal(state.riskGateDetected, true);
  assert.equal(state.checkpointKind, 'waiting_room');
  assert.equal(state.suggestedNextAction, 'wait_then_recheck');
  assert.ok(state.checkpointSignals.includes('title_or_text_just_a_moment'));
});

test('page grasp state classifies cloudflare challenge url variants as checkpoint', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://chatgpt.com/?__cf_chl_rt_tk=abc123',
    snapshotHash: 'cf-gate',
    title: 'Checking your browser before accessing',
    bodyText: '',
    nodes: 0,
    forms: 0,
    navs: 0,
    headings: [],
  });

  assert.equal(state.currentRole, 'checkpoint');
  assert.equal(state.riskGateDetected, true);
  assert.equal(state.checkpointKind, 'challenge');
  assert.ok(state.checkpointSignals.includes('cloudflare_challenge_url'));
});

test('page grasp state increments dom revision and keeps medium confidence on dom change', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://playwright.dev/',
    snapshotHash: 'a',
    bodyText: 'Fast and reliable end-to-end testing for modern web apps',
    nodes: 7,
    forms: 0,
    navs: 4,
    headings: ['Playwright'],
  });
  const next = applySnapshotToPageGraspState(state, {
    url: 'https://playwright.dev/',
    snapshotHash: 'b',
    bodyText: 'Installation Playwright Test is an end-to-end test framework',
    nodes: 8,
    forms: 0,
    navs: 4,
    headings: ['Installation'],
  });

  assert.equal(next.domRevision, 1);
  assert.equal(next.reacquired, true);
  assert.equal(next.graspConfidence, 'medium');
});

test('workspace pages classify as workspace with a coarse surface hint', () => {
  const state = createPageGraspState();
  const next = applySnapshotToPageGraspState(state, {
    url: 'https://www.zhipin.com/web/geek/chat?id=112222491&source=0',
    snapshotHash: 'chat-a',
    title: 'BOSS直聘',
    bodyText: '消息 按Enter键发送 发简历 换电话 换微信 李女士 人工智能训练师',
    nodes: 42,
    forms: 0,
    navs: 3,
    headings: [],
  });

  assert.equal(next.currentRole, 'workspace');
  assert.equal(next.workspaceSurface, 'thread');
});

test('path substrings do not trigger workspace classification', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://example.com/chatops-guide',
    snapshotHash: 'content-a',
    title: 'Example article',
    bodyText: 'This is a normal article page with illustrative text.',
    nodes: 6,
    forms: 0,
    navs: 1,
    headings: ['Example article'],
  });

  assert.notEqual(state.currentRole, 'workspace');
  assert.equal(state.currentRole, 'content');
});

test('composer text alone does not trigger workspace classification on generic pages', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://example.com/article',
    snapshotHash: 'content-b',
    title: 'Example article',
    bodyText: '输入消息 按Enter键发送 发送消息 This is a normal article page with illustrative text.',
    nodes: 6,
    forms: 0,
    navs: 1,
    headings: ['Example article'],
  });

  assert.notEqual(state.currentRole, 'workspace');
  assert.equal(state.currentRole, 'content');
});

test('composer-dominant workspace pages classify as composer surface', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://www.zhipin.com/web/geek/chat?id=112222491&source=0',
    snapshotHash: 'chat-b',
    title: 'BOSS直聘',
    bodyText: '输入消息 按Enter键发送 发送消息',
    nodes: 18,
    forms: 0,
    navs: 2,
    headings: [],
  });

  assert.equal(state.currentRole, 'workspace');
  assert.equal(state.workspaceSurface, 'composer');
});
