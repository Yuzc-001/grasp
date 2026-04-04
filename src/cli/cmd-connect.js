import { spawn } from 'child_process';
import { join } from 'path';
import { homedir, platform } from 'os';
import { readConfig, writeConfig } from './config.js';

import { detectChromePath } from './detect-chrome.js';

import { detectClients, autoConfigureAll } from './auto-configure.js';

import { formatBanner, formatErrorCopy, formatStep, printBlock } from './output.js';

import { readBrowserInstance } from '../runtime/browser-instance.js';


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
    const info = await readBrowserInstance(cdpUrl, { timeout: 800 });
    if (info) return info;
  }
  return null;
}

export async function runConnect() {
  const config = await readConfig();
  const cdpUrl = process.env.CHROME_CDP_URL || config.cdpUrl;
  const userDataDir = join(homedir(), 'chrome-grasp');

  printBlock(formatBanner('Grasp Runtime Setup', 'Bring a Chrome CDP session into the runtime.'));

  console.log('  One URL, one best path.');

  console.log('');


  // Step 1: detect Chrome
  const chromePath = detectChromePath();
  if (chromePath) {

    printBlock(formatStep('ok', 'Chrome found', chromePath));

  } else {

    printBlock(formatStep('fail', 'Chrome not found'));

    printBlock(formatErrorCopy({

      whatHappened: 'Grasp could not find a local Chrome installation for the dedicated browser runtime.',

      tried: ['Checked the common install locations for this operating system.'],

      nextSteps: ['Install Google Chrome from https://www.google.com/chrome/.', 'Run grasp doctor or grasp connect again.'],

    }));

    process.exit(1);

  }


  // Step 2: check or launch Chrome with CDP
  console.log('');

  printBlock(formatStep('wait', `Ensuring browser runtime at ${cdpUrl} ...`));

  let chromeInfo = await readBrowserInstance(cdpUrl);
  let launchedDedicatedProfile = false;

  if (!chromeInfo) {

    printBlock(formatStep('wait', 'Chrome not running, launching dedicated profile...'));

    chromeInfo = await launchChrome(chromePath, cdpUrl);

    launchedDedicatedProfile = chromeInfo !== null;

  }



  if (!chromeInfo) {

    printBlock(formatStep('fail', 'Failed to bring the browser runtime online'));

    printBlock(formatErrorCopy({

      whatHappened: 'Grasp could not start or reach the dedicated chrome-grasp browser runtime.',

      tried: [

        `Attempted to connect to ${cdpUrl}.`,

        'Tried launching a dedicated chrome-grasp profile automatically.',

      ],

      nextSteps: [

        platform() === 'win32'

          ? 'Run start-chrome.bat to launch the dedicated browser runtime manually.'

          : `Launch Chrome manually: "${chromePath}" --remote-debugging-port=9222 --user-data-dir=$HOME/chrome-grasp`,

        'Run grasp doctor for a focused setup diagnosis.',

      ],

    }));

    process.exit(1);

  }



  printBlock(formatStep('ok', `Browser runtime ready (${chromeInfo.browser ?? 'unknown'})`, `Profile: ${userDataDir}`));

  console.log(`       Instance: ${chromeInfo.display === 'headless' ? 'headless browser' : chromeInfo.display === 'windowed' ? 'windowed browser' : 'unknown browser mode'}`);

  if (launchedDedicatedProfile) {

    console.log('       Scope: dedicated chrome-grasp profile, not an arbitrary existing browser session');

  }

  if (chromeInfo.warning) {

    console.log(`       Warning: ${chromeInfo.warning}`);

  }


  // Step 3: save cdpUrl to config
  await writeConfig({ cdpUrl });

  // Step 4: get active tab
  try {
    const tabsRes = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(1500) });
    const tabs = await tabsRes.json();
    const tab = tabs.find(t => t.type === 'page' && t.url && !t.url.startsWith('chrome://'));
    if (tab) {
      printBlock(formatStep('ok', `Current page: ${tab.title?.slice(0, 50) || tab.url}`));

    }
  } catch { /* ignore */ }

  // Step 5: auto-configure AI clients
  console.log('');

  printBlock(formatStep('wait', 'Connecting AI clients...'));

  const clients = detectClients();

  if (clients.length === 0) {
    printBlock(formatStep('fail', 'No AI clients found'));
    printBlock(formatErrorCopy({
      whatHappened: 'Grasp did not detect a supported AI client it could configure automatically.',
      tried: ['Checked for Claude Code, Codex CLI, and Cursor on this machine.'],
      nextSteps: ['Add Grasp manually to your AI client config.', '{ "mcpServers": { "grasp": { "command": "npx", "args": ["-y", "@yuzc-001/grasp"] } } }'],
    }));
  } else {
    const results = await autoConfigureAll(clients);
    for (const { label, result } of results) {
      if (result === 'written') {
        printBlock(formatStep('ok', `${label} — config written`));
      } else if (result === 'already-configured') {
        printBlock(formatStep('ok', `${label} — already configured`));
      } else {
        printBlock(formatStep('fail', `${label} — failed, add manually`));
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
  console.log('  Runtime ready. First win:');
  console.log('    1. Tell your AI: "call get_status"');
  console.log('    2. Then: "use entry(url, intent) on a real page"');
  console.log('    3. Then: "inspect, then extract or continue"');
  console.log('    4. Then: "explain_route or grasp explain"');
  console.log('');
}
