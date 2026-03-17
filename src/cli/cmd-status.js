import { readConfig } from './config.js';
import { detectChromePath, startChromeHint } from './detect-chrome.js';
import { readLogs } from '../server/audit.js';

async function pingChrome(cdpUrl) {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getActiveChromeTab(cdpUrl) {
  try {
    const res = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(1500) });
    const tabs = await res.json();
    return tabs.find(t =>
      t.type === 'page' &&
      t.url &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('about:')
    ) ?? null;
  } catch {
    return null;
  }
}

export async function runStatus() {
  const config = await readConfig();
  const cdpUrl = process.env.CHROME_CDP_URL || config.cdpUrl;

  const sep = '─'.repeat(44);
  console.log('');
  console.log('  Grasp Status');
  console.log(`  ${sep}`);

  const chromeInfo = await pingChrome(cdpUrl);
  const connected = chromeInfo !== null;

  console.log(`  CDP URL    ${cdpUrl}`);
  console.log(`  Chrome     ${connected ? 'running  ' + chromeInfo.Browser : 'not reachable'}`);
  console.log(`  Safe mode  ${config.safeMode ? 'on' : 'off'}`);

  if (connected) {
    const tab = await getActiveChromeTab(cdpUrl);
    if (tab) {
      const title = tab.title?.slice(0, 50) || '(no title)';
      const url   = tab.url?.slice(0, 70) || '';
      console.log(`  Active tab ${title}`);
      console.log(`             ${url}`);
    }
  } else {
    const chromePath = detectChromePath();
    console.log('');
    if (chromePath) {
      console.log(`  Chrome found at:`);
      console.log(`    ${chromePath}`);
      console.log('');
      console.log(`  Start it for Grasp:`);
      console.log(`    ${startChromeHint(cdpUrl)}`);
    } else {
      console.log(`  Chrome not found. Install Google Chrome, then run:`);
      console.log(`    ${startChromeHint(cdpUrl)}`);
    }
  }

  const logs = await readLogs(3);
  if (logs.length > 0) {
    console.log('');
    console.log(`  Recent activity`);
    logs.forEach(l => console.log(`    ${l}`));
  }

  console.log('');
}
