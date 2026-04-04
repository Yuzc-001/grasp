import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { detectChromePath, startChromeHint } from '../cli/detect-chrome.js';
import { writeRuntimeStatus } from '../server/runtime-status.js';
import { getActiveTaskFrame, isSafeModeEnabled } from '../server/state.js';

const CDP_URL = process.env.CHROME_CDP_URL || 'http://localhost:9222';
const DEFAULT_RETRY_DELAYS = [0, 250, 1000];
const SAFE_MODE = isSafeModeEnabled();

async function autoLaunchChrome(cdpUrl) {
  const chromePath = detectChromePath();
  if (!chromePath) return false;

  const parsedUrl = new URL(cdpUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsedUrl.hostname)) return false;

  const port = parsedUrl.port || '9222';
  const userDataDir = join(homedir(), 'chrome-grasp');

  console.error(`[Grasp] Chrome not running — auto-launching: ${chromePath}`);
  spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
  ], { detached: true, stdio: 'ignore' }).unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        console.error('[Grasp] Auto-launched Chrome is ready.');
        return true;
      }
    } catch {
      // not ready yet
    }
  }

  console.error('[Grasp] Auto-launch: Chrome did not become reachable in time.');
  return false;
}

async function defaultConnect() {
  try {
    const browser = await chromium.connectOverCDP(CDP_URL);
    console.error('[Grasp] Connected to Chrome via CDP:', CDP_URL);
    return browser;
  } catch (err) {
    throw new Error(
      `Chrome not reachable at ${CDP_URL}.\n` +
      `Start Chrome with remote debugging enabled:\n` +
      `  ${startChromeHint(CDP_URL)}\n` +
      `Or run: grasp status  to diagnose the problem.\n` +
      `(${err.message})`
    );
  }
}

const defaultPersistStatus = async (snapshot) => {
  await writeRuntimeStatus(snapshot);
};

function runPersist(persistFn, snapshot) {
  if (!persistFn) return;
  try {
    const result = persistFn(snapshot);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // swallow
  }
}

function clearTargetSession(state) {
  if (state) {
    const activeTaskFrame = getActiveTaskFrame(state);
    if (activeTaskFrame) {
      activeTaskFrame.pinnedTarget = null;
      state.targetSession = null;
      return;
    }
    if (state.targetSession) {
      state.targetSession = null;
    }
  }
}

function isInternalBrowserUrl(url = '') {
  return url.startsWith('chrome://')
    || url.startsWith('chrome-extension://')
    || url.startsWith('about:');
}

function isTransientExecutionContextError(error) {
  const message = error?.message ?? '';
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id');
}

function getUrlHost(url = '') {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

async function safeReadPageTitle(page, { attempts = 3, delayMs = 120 } = {}) {
  let lastError = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await page.title();
    } catch (error) {
      lastError = error;
      if (!isTransientExecutionContextError(error) || index === attempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (index + 1)));
    }
  }

  if (lastError && !isTransientExecutionContextError(lastError)) {
    throw lastError;
  }

  return null;
}

export async function readStablePageTitle(page, options = {}) {
  return safeReadPageTitle(page, options);
}

function getPinnedTargetSession(state) {
  const activeTaskFrame = getActiveTaskFrame(state);
  if (activeTaskFrame) {
    return activeTaskFrame.pinnedTarget ?? null;
  }
  return state?.targetSession ?? null;
}

function isPinnedTargetAvailable(page, browser) {
  if (!page) return false;
  if (page.isClosed?.() === true) return false;

  const contexts = browser?.contexts?.() ?? [];
  for (const context of contexts) {
    const pages = context?.pages?.() ?? [];
    if (pages.includes(page)) {
      return true;
    }
  }

  return false;
}

function matchesPinnedTarget(page, targetSession) {
  const currentUrl = page?.url?.() ?? '';
  if (!currentUrl) return false;
  if (isInternalBrowserUrl(currentUrl)) return false;

  const targetHost = targetSession?.host ?? getUrlHost(targetSession?.url ?? '');
  const currentHost = getUrlHost(currentUrl);
  if (targetHost && currentHost && targetHost === currentHost) {
    return true;
  }

  if (targetSession?.url && currentUrl === targetSession.url) {
    return true;
  }

  return false;
}

export async function pinTargetPage(page, state) {
  const currentUrl = page.url();
  const targetSession = {
    page,
    url: currentUrl,
    host: getUrlHost(currentUrl),
    title: await safeReadPageTitle(page),
  };
  if (state) {
    const activeTaskFrame = getActiveTaskFrame(state);
    if (activeTaskFrame) {
      activeTaskFrame.pinnedTarget = targetSession;
      state.targetSession = null;
    } else {
      state.targetSession = targetSession;
    }
  }
  return targetSession;
}

export function createConnectionSupervisor({
  connect = defaultConnect,
  now = () => Date.now(),
  retryDelays = DEFAULT_RETRY_DELAYS,
  persistStatus = defaultPersistStatus,
  safeMode = SAFE_MODE,
  cdpUrl = CDP_URL,
  autoLaunch = autoLaunchChrome,
} = {}) {
  let browser = null;
  let pending = null;
  let status = {
    state: 'idle',
    retryCount: 0,
    lastError: null,
    lastAttemptAt: null,
    connectedAt: null,
    cdpUrl,
    safeMode,
    updatedAt: now(),
  };

  function updateStatus(updates) {
    status = {
      ...status,
      ...updates,
      cdpUrl,
      safeMode,
      updatedAt: now(),
    };
    runPersist(persistStatus, status);
    return status;
  }

  function attachDisconnectListener(instance) {
    if (!instance || typeof instance.once !== 'function') return;
    instance.once('disconnected', () => {
      browser = null;
      updateStatus({ state: 'disconnected', lastError: 'browser disconnected' });
    });
  }

  async function attemptConnect() {
    updateStatus({ state: 'connecting', lastError: null });

    for (let index = 0; index < retryDelays.length; index += 1) {
      const delayMs = retryDelays[index];
      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const attemptCount = index + 1;
      updateStatus({
        retryCount: attemptCount,
        lastAttemptAt: now(),
        lastError: null,
      });

      try {
        const candidate = await connect();
        browser = candidate;
        attachDisconnectListener(candidate);
        updateStatus({
          state: 'connected',
          connectedAt: now(),
          lastError: null,
          retryCount: attemptCount,
        });
        return candidate;
      } catch (error) {
        updateStatus({ lastError: error.message });
      }
    }

    if (autoLaunch) {
      updateStatus({ state: 'auto_launching', lastError: 'CDP unreachable, attempting auto-launch' });
      const launched = await autoLaunch(cdpUrl);
      if (launched) {
        try {
          const candidate = await connect();
          browser = candidate;
          attachDisconnectListener(candidate);
          updateStatus({
            state: 'connected',
            connectedAt: now(),
            lastError: null,
            retryCount: retryDelays.length + 1,
          });
          return candidate;
        } catch (error) {
          updateStatus({ lastError: error.message });
        }
      }
    }

    updateStatus({ state: 'CDP_UNREACHABLE', retryCount: retryDelays.length, lastAttemptAt: now() });
    throw new Error(status.lastError ?? 'CDP unreachable');
  }

  async function getBrowser() {
    if (browser?.isConnected?.()) {
      updateStatus({ state: 'connected', connectedAt: now(), lastError: null });
      return browser;
    }

    if (pending) {
      return pending;
    }

    pending = attemptConnect();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function getStatus() {
    return status;
  }

  function reset() {
    browser = null;
    pending = null;
    updateStatus({
      cdp: { state: 'unknown', browserVersion: null, protocolVersion: null },
      page: { state: 'unknown', title: null, url: null },
      browser_process: { state: 'unknown', pid: null },
      server: {
        state: 'idle',
        retryCount: 0,
        lastError: null,
        lastAttemptAt: null,
        connectedAt: null,
      },
    });
  }

  return { getBrowser, getStatus, reset };
}

const supervisor = createConnectionSupervisor();

async function getBrowser() {
  return supervisor.getBrowser();
}

async function getActivePage({ state = null, browser = null } = {}) {
  const resolvedBrowser = browser ?? await getBrowser();
  const pinnedTarget = getPinnedTargetSession(state);

  if (pinnedTarget?.page) {
    const pinnedPage = pinnedTarget.page;
    if (isPinnedTargetAvailable(pinnedPage, resolvedBrowser) && matchesPinnedTarget(pinnedPage, pinnedTarget)) {
      return pinnedPage;
    }
    clearTargetSession(state);
  }

  const context = resolvedBrowser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();

  const userPages = pages.filter((page) => {
    const url = page.url();
    if (!url) return false;
    if (isInternalBrowserUrl(url)) return false;
    return true;
  });

  if (userPages.length === 0) {
    if (pages.length > 0) return pages[pages.length - 1];
    const newPage = await context.newPage();
    console.error('[Grasp] No open tabs — created a blank tab.');
    return newPage;
  }

  for (const page of userPages) {
    try {
      const isVisible = await page.evaluate(() => document.visibilityState === 'visible');
      if (isVisible) return page;
    } catch {
      // Page still loading — skip
    }
  }

  return userPages[userPages.length - 1];
}

async function navigateTo(url, { state = null, browser = null } = {}) {
  const page = await getActivePage({ state, browser });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      console.error(
        `[Grasp] Navigation to ${url} timed out, continuing with partially loaded page.`
      );
    } else {
      throw err;
    }
  }

  return page;
}

async function getTabs() {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();
  return Promise.all(
    pages.map(async (p, i) => ({
      index: i,
      title: await p.title().catch(() => ''),
      url: p.url(),
      isUser: p.url() && !p.url().startsWith('chrome://') && !p.url().startsWith('about:'),
    }))
  );
}

async function switchTab(index) {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();
  if (index < 0 || index >= pages.length) {
    throw new Error(`Tab index ${index} out of range (0-${pages.length - 1})`);
  }
  await pages[index].bringToFront();
  return pages[index];
}

async function newTab(url) {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    if (!err.message?.includes('timeout')) {
      await page.close().catch(() => {});
      throw err;
    }
    console.error(`[Grasp] newTab navigation timeout for ${url}, continuing.`);
  }
  await page.bringToFront();
  return page;
}

async function trustedContextOpen(url) {
  return newTab(url);
}

async function closeTab(index) {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();
  if (index < 0 || index >= pages.length) {
    throw new Error(`Tab index ${index} out of range (0-${pages.length - 1})`);
  }
  await pages[index].close();
}

export { getBrowser, getActivePage, navigateTo, getTabs, switchTab, newTab, trustedContextOpen, closeTab };
