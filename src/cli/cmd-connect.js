import { spawn } from 'child_process';
import { join } from 'path';
import { homedir, platform } from 'os';
import { readConfig, writeConfig } from './config.js';
import { detectChromePath } from './detect-chrome.js';
import { detectClients, autoConfigureAll } from './auto-configure.js';

const STEP_OK   = '[ok]';
const STEP_WAIT = '[..]';
const STEP_FAIL = '[!!]';

async function pingChrome(cdpUrl, timeout = 1500) {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function launchChrome(chromePath, cdpUrl) {
  const port = new URL(cdpUrl).port || '9222';
  const userDataDir = join(homedir(), 'chrome-grasp');

  spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
  ], { detached: true, stdio: 'ignore' }).unref();

  // Wait up to 8s
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 500));
    const info = await pingChrome(cdpUrl, 800);
    if (info) return info;
  }
  return null;
}

export async function runConnect() {
  const config = await readConfig();
  const cdpUrl = process.env.CHROME_CDP_URL || config.cdpUrl;

  console.log('');
  console.log('  Grasp Connect');
  console.log('  ' + '─'.repeat(44));
  console.log('');

  // Step 1: detect Chrome
  const chromePath = detectChromePath();
  if (chromePath) {
    console.log(`  ${STEP_OK} Chrome found`);
    console.log(`       ${chromePath}`);
  } else {
    console.log(`  ${STEP_FAIL} Chrome not found`);
    console.log('');
    console.log('  Install Google Chrome and try again:');
    console.log('  https://www.google.com/chrome/');
    console.log('');
    process.exit(1);
  }

  // Step 2: check or launch Chrome with CDP
  console.log('');
  console.log(`  ${STEP_WAIT} Connecting to Chrome at ${cdpUrl} ...`);
  let chromeInfo = await pingChrome(cdpUrl);

  if (!chromeInfo) {
    console.log(`  ${STEP_WAIT} Chrome not running, launching...`);
    chromeInfo = await launchChrome(chromePath, cdpUrl);
  }

  if (!chromeInfo) {
    console.log(`  ${STEP_FAIL} Failed to connect to Chrome`);
    console.log('');
    console.log('  Try running manually:');
    if (platform() === 'win32') {
      console.log('    start-chrome.bat');
    } else {
      console.log(`    "${chromePath}" --remote-debugging-port=9222 --user-data-dir=$HOME/chrome-grasp`);
    }
    console.log('');
    process.exit(1);
  }

  console.log(`  ${STEP_OK} Chrome connected  (${chromeInfo.Browser})`);

  // Step 3: save cdpUrl to config
  await writeConfig({ cdpUrl });

  // Step 4: get active tab
  try {
    const tabsRes = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(1500) });
    const tabs = await tabsRes.json();
    const tab = tabs.find(t => t.type === 'page' && t.url && !t.url.startsWith('chrome://'));
    if (tab) {
      console.log(`  ${STEP_OK} Active tab: ${tab.title?.slice(0, 50) || tab.url}`);
    }
  } catch { /* ignore */ }

  // Step 5: auto-configure AI clients
  console.log('');
  console.log(`  ${STEP_WAIT} Detecting AI clients...`);
  const clients = detectClients();

  if (clients.length === 0) {
    console.log(`  ${STEP_FAIL} No AI clients found`);
    console.log('');
    console.log('  Add manually to your AI client config:');
    console.log('    { "mcpServers": { "grasp": { "command": "npx", "args": ["-y", "grasp"] } } }');
  } else {
    const results = await autoConfigureAll(clients);
    for (const { label, result } of results) {
      if (result === 'written') {
        console.log(`  ${STEP_OK} ${label}  — config written`);
      } else if (result === 'already-configured') {
        console.log(`  ${STEP_OK} ${label}  — already configured`);
      } else {
        console.log(`  ${STEP_FAIL} ${label}  — failed, add manually`);
      }
    }

    const needsRestart = results
      .filter(r => r.result === 'written')
      .map(r => r.label);

    if (needsRestart.length > 0) {
      console.log('');
      console.log(`  Restart ${needsRestart.join(', ')} to apply changes.`);
    }
  }

  console.log('');
  console.log('  ' + '─'.repeat(44));
  console.log('  Done. Tell your AI: "call get_status" to verify.');
  console.log('');
}
