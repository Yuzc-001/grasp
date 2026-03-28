import { readConfig } from './config.js';
import { detectChromePath, startChromeHint } from './detect-chrome.js';
import { readRuntimeTruth } from '../server/runtime-status.js';
import { readLatestRouteDecision, readLogs } from '../server/audit.js';
import { isSafeModeEnabled } from '../server/state.js';

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

export function formatConnectionLabel(connected, runtimeTruth) {
  if (connected) return 'ready';

  // Backward compatibility for legacy runtime-status snapshots/tests.
  if (runtimeTruth?.state === 'CDP_UNREACHABLE') return 'browser unreachable';
  if (runtimeTruth?.state) return 'disconnected';

  if (runtimeTruth?.cdp?.state === 'unreachable') return 'browser unreachable';
  if (runtimeTruth?.server?.state && runtimeTruth.server.state !== 'idle') return 'disconnected';
  return 'browser unreachable';
}

export function formatLatestRouteSummary(route) {
  if (!route?.selected_mode) return null;
  const nextStep = route.next_step ?? 'unknown';
  const intent = route.intent ?? 'unknown';
  return `${route.selected_mode} -> ${nextStep} (intent: ${intent})`;
}

export async function runStatus() {
  const config = await readConfig();
  const cdpUrl = process.env.CHROME_CDP_URL || config.cdpUrl;
  const runtimeTruth = await readRuntimeTruth();
  const safeMode = isSafeModeEnabled();
  const safeModeNote = safeMode === config.safeMode ? '' : ` (config: ${config.safeMode ? 'on' : 'off'})`;

  const sep = '─'.repeat(44);
  console.log('');
  console.log('  Grasp Runtime Status');
  console.log(`  ${sep}`);

  const chromeInfo = await pingChrome(cdpUrl);
  const connected = chromeInfo !== null;

  const statusLabel = formatConnectionLabel(connected, runtimeTruth);
  console.log(`  Runtime    ${statusLabel}`);
  console.log(`  Endpoint   ${cdpUrl}`);
  if (!connected && runtimeTruth?.server?.lastError) {
    console.log(`             Last error: ${runtimeTruth.server.lastError}`);
  }
  if (runtimeTruth?.updatedAt) {
    const updatedAt = new Date(runtimeTruth.updatedAt).toLocaleString();
    console.log(`             Last seen: ${updatedAt}`);
  }
  console.log(`  Browser    ${connected ? 'running  ' + chromeInfo.Browser : 'not reachable'}`);
  console.log('  Profile    chrome-grasp');
  console.log(`  Safe mode  ${safeMode ? 'on' : 'off'}${safeModeNote}`);
  const latestRoute = await readLatestRouteDecision();
  const latestRouteSummary = formatLatestRouteSummary(latestRoute);
  if (latestRouteSummary) {
    console.log(`  Last route ${latestRouteSummary}`);
  }

  if (connected) {
      const tab = await getActiveChromeTab(cdpUrl);
      if (tab) {
        const title = tab.title?.slice(0, 50) || '(no title)';
        const url = tab.url?.slice(0, 70) || '';
        console.log(`  Current page ${title}`);
        console.log(`             ${url}`);
      }
  } else {
    const chromePath = detectChromePath();
    console.log('');
    if (chromePath) {
      console.log('  Chrome found at:');
      console.log(`    ${chromePath}`);
      console.log('');
      console.log('  Bring the runtime back:');
      console.log(`    ${startChromeHint(cdpUrl)}`);
    } else {
      console.log('  Chrome not found. Install Google Chrome, then run:');
      console.log(`    ${startChromeHint(cdpUrl)}`);
    }
  }

  const logs = await readLogs(3);
  if (logs.length > 0) {
    console.log('');
    console.log('  Recent activity');
    logs.forEach((l) => console.log(`    ${l}`));
  }

  console.log('');
}
