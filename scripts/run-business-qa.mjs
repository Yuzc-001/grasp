import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { capturePageSnapshot } from '../src/grasp/page/capture.js';
import { closeTab, getActivePage, getTabs, newTab } from '../src/layer1-bridge/chrome.js';
import { readBrowserInstance } from '../src/runtime/browser-instance.js';
import { createServerState, syncPageState } from '../src/server/state.js';
import { storeRuntimeConfirmation } from '../src/server/runtime-confirmation.js';
import { registerGatewayTools } from '../src/server/tools.gateway.js';

const DEFAULT_SCENARIOS = [
  { name: 'wechat_home', url: 'https://mp.weixin.qq.com/', intent: 'extract' },
  { name: 'boss_home', url: 'https://www.zhipin.com/', intent: 'extract' },
  { name: 'cloudflare_challenge', url: 'https://www.scrapingcourse.com/cloudflare-challenge', intent: 'extract' },
];

function createHarness(state) {
  const tools = new Map();
  const server = {
    registerTool(name, _spec, handler) {
      tools.set(name, handler);
    },
  };
  registerGatewayTools(server, state);
  return {
    async call(name, args = {}) {
      const handler = tools.get(name);
      if (!handler) {
        throw new Error(`Missing tool: ${name}`);
      }
      return handler(args);
    },
  };
}

async function closeUserTabs() {
  const tabs = await getTabs();
  const userTabs = tabs
    .filter((tab) => tab.isUser)
    .map((tab) => tab.index)
    .sort((a, b) => b - a);

  for (const index of userTabs) {
    await closeTab(index);
  }
}

async function resetRuntimeSurface(state) {
  await closeUserTabs();
  const page = await newTab('https://example.com/');
  await page.bringToFront().catch(() => {});
  await syncPageState(page, state, { force: true });
  return page;
}

function summarizeGatewayResult(result) {
  return {
    status: result?.meta?.status ?? null,
    page_url: result?.meta?.page?.url ?? null,
    page_role: result?.meta?.page?.page_role ?? null,
    route: result?.meta?.route?.selected_mode ?? null,
    next: result?.meta?.continuation?.suggested_next_action ?? null,
    handoff_state: result?.meta?.continuation?.handoff_state ?? null,
    error_code: result?.meta?.error_code ?? null,
    instance_display: result?.meta?.runtime?.instance?.display ?? null,
  };
}

async function runScenario(scenario, cdpUrl) {
  const state = createServerState();
  const instance = await readBrowserInstance(cdpUrl);
  if (!instance) {
    throw new Error(`Runtime instance unavailable at ${cdpUrl}`);
  }
  storeRuntimeConfirmation(state, instance);
  await resetRuntimeSurface(state);

  const harness = createHarness(state);
  const entry = await harness.call('entry', { url: scenario.url, intent: scenario.intent });
  const inspect = await harness.call('inspect');
  const activePage = await getActivePage({ state });
  await syncPageState(activePage, state, { force: true });
  const snapshot = await capturePageSnapshot(activePage);
  const tabs = (await getTabs()).filter((tab) => tab.isUser);

  return {
    entry: summarizeGatewayResult(entry),
    inspect: summarizeGatewayResult(inspect),
    active_page: {
      title: await activePage.title().catch(() => null),
      url: activePage.url(),
    },
    pinned_target: state.targetSession
      ? {
          url: state.targetSession.url,
          host: state.targetSession.host ?? null,
          title: state.targetSession.title ?? null,
          live_url: state.targetSession.page?.url?.() ?? null,
        }
      : null,
    snapshot: {
      title: snapshot.title,
      nodes: snapshot.nodes,
      forms: snapshot.forms,
      navs: snapshot.navs,
      headings: snapshot.headings,
      body_prefix: snapshot.bodyText.slice(0, 320),
    },
    visible_tabs: tabs,
  };
}

async function main() {
  const cdpUrl = process.env.CHROME_CDP_URL || 'http://localhost:9222';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(os.tmpdir(), `grasp-business-qa-${stamp}`);
  const reportPath = path.join(reportDir, 'report.json');
  const report = {
    generated_at: new Date().toISOString(),
    report_dir: reportDir,
    cdp_url: cdpUrl,
    scenarios: {},
  };

  for (const scenario of DEFAULT_SCENARIOS) {
    report.scenarios[scenario.name] = await runScenario(scenario, cdpUrl);
  }

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
