import { chromium } from 'playwright-core';
import { startChromeHint } from '../cli/detect-chrome.js';

const CDP_URL = process.env.CHROME_CDP_URL || 'http://localhost:9222';

let _browser = null;
let _connecting = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) {
    return _browser;
  }

  _browser = null;

  if (_connecting) return _connecting;

  _connecting = (async () => {
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
  })();

  try {
    _browser = await _connecting;
    return _browser;
  } finally {
    _connecting = null;
  }
}

async function getActivePage() {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();

  const userPages = pages.filter((page) => {
    const url = page.url();
    if (!url) return false;
    if (url.startsWith('chrome://')) return false;
    if (url.startsWith('chrome-extension://')) return false;
    if (url.startsWith('about:')) return false;
    return true;
  });

  if (userPages.length === 0) {
    if (pages.length > 0) return pages[pages.length - 1];
    throw new Error('No open tabs found in Chrome.');
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

async function navigateTo(url) {
  const page = await getActivePage();

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

export { getBrowser, getActivePage, navigateTo, getTabs, switchTab, newTab, closeTab };
