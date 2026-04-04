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

test('public repo pages with sign-in copy do not classify as auth', () => {
  const state = createPageGraspState();
  const next = applySnapshotToPageGraspState(state, {
    url: 'https://github.com/vercel/next.js',
    snapshotHash: 'repo-a',
    title: 'GitHub - vercel/next.js: The React Framework for the Web',
    bodyText: 'Skip to content Sign in Product Solutions Open Source Pricing Search code repositories Issues Pull requests Discussions The React Framework for the Web Latest commit message docs message helpers email notifications',
    nodes: 32,
    forms: 1,
    navs: 9,
    headings: ['next.js', 'The React Framework for the Web'],
  });

  assert.notEqual(next.currentRole, 'auth');
  assert.equal(next.currentRole, 'navigation-heavy');
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

test('navigation-heavy admin pages do not collapse into form pages', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://app.example.com/cgi-bin/home',
    snapshotHash: 'admin-a',
    title: 'Control Center',
    bodyText: '首页 内容管理 草稿箱 素材库 发表记录 数据概览 用户设置 搜索',
    nodes: 24,
    forms: 2,
    navs: 10,
    headings: ['内容管理'],
  });

  assert.equal(state.currentRole, 'navigation-heavy');
  assert.equal(state.workspaceSurface, 'list');
});

test('dense public landing pages do not collapse into form pages just because they expose many controls', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://www.zhipin.com/zhengzhou/?seoRefer=index',
    snapshotHash: 'boss-home',
    title: 'BOSS直聘-找工作BOSS直聘直接谈！招聘求职找工作！',
    bodyText: '郑州 首页 职位 公司 校园 APP 我要招聘 我要找工作 登录/注册 职位类型 地图 搜索 热门职位 Java 产品经理 前端开发工程师 测试工程师 运维工程师 数据分析师 平面设计 销售专员 招聘 热招职位 销售 客服 运营 直播 医疗 教育 服务业 人力 财务 行政 房地产 建筑 供应链 物流',
    nodes: 2516,
    forms: 31,
    navs: 0,
    headings: ['热招职位'],
  });

  assert.notEqual(state.currentRole, 'form');
  assert.equal(state.currentRole, 'content');
});

test('wechat official accounts landing page stays content instead of collapsing into form', () => {
  const state = applySnapshotToPageGraspState(createPageGraspState(), {
    url: 'https://mp.weixin.qq.com/',
    snapshotHash: 'wechat-home',
    title: '微信公众平台',
    bodyText: '微信公众平台 立即注册 简体中文 使用账号登录 登录 微信扫一扫，选择该微信下的 公众平台账号登录 微信公众平台 账号分类 服务号 公众号 小程序 企业微信',
    nodes: 34,
    forms: 6,
    navs: 0,
    headings: ['微信公众平台', '账号分类'],
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
