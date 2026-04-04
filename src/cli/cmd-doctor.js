import { readConfig } from './config.js';
import { detectChromePath, startChromeHint } from './detect-chrome.js';
import { detectClients } from './auto-configure.js';
import { formatBanner, formatErrorCopy, formatStep, printBlock } from './output.js';
import { readBrowserInstance } from '../runtime/browser-instance.js';

export async function runDoctor() {
  const config = await readConfig();
  const cdpUrl = process.env.CHROME_CDP_URL || config.cdpUrl;
  const chromePath = detectChromePath();
  const browserInstance = await readBrowserInstance(cdpUrl);
  const clients = detectClients();

  printBlock(formatBanner(
    'Grasp Runtime Doctor',
    'Diagnose the dedicated browser runtime Grasp uses for agent work.',
  ));

  if (chromePath) {
    printBlock(formatStep('ok', 'Chrome found', chromePath));
  } else {
    printBlock(formatStep('fail', 'Chrome not found'));
    printBlock(formatErrorCopy({
      whatHappened: 'Grasp could not find a local Chrome or Chromium installation.',
      tried: [
        'Checked common Chrome and Edge install paths for this operating system.',
      ],
      nextSteps: [
        'Install Google Chrome.',
        'Run grasp doctor again after Chrome is installed.',
      ],
    }));
    return;
  }

  if (browserInstance) {
    printBlock(formatStep(
      'ok',
      `Browser runtime reachable (${browserInstance.browser ?? 'unknown'})`,
      `Endpoint: ${cdpUrl}`,
    ));
  } else {
    printBlock(formatStep('fail', 'Browser runtime not reachable', `Endpoint: ${cdpUrl}`));
    printBlock(formatErrorCopy({
      whatHappened: 'The dedicated browser runtime is not responding on the configured CDP endpoint.',
      tried: [
        `Tried connecting to ${cdpUrl}.`,
        'Looked for a reusable dedicated chrome-grasp browser runtime.',
      ],
      nextSteps: [
        'Start the dedicated browser runtime.',
        `If needed, launch Chrome manually with: ${startChromeHint(cdpUrl)}`,
      ],
    }));
    return;
  }

  if (clients.length > 0) {
    printBlock(formatStep('ok', `AI clients detected: ${clients.join(', ')}`));
  } else {
    printBlock(formatStep('wait', 'No supported AI clients detected automatically'));
    printBlock(formatErrorCopy({
      whatHappened: 'Grasp did not find a supported local AI client configuration to update automatically.',
      tried: [
        'Checked the known local config locations for Claude Code, Codex CLI, and Cursor.',
      ],
      nextSteps: [
        'Add Grasp manually to your AI client MCP configuration if needed.',
        'Run grasp connect after your client is installed to try auto-configuration again.',
      ],
    }));
    return;
  }

  printBlock(formatStep(
    'ok',
    'Doctor checks passed',
    'This dedicated browser runtime is ready for connect/status flows.',
  ));
}
