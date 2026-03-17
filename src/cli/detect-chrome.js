import { existsSync } from 'fs';
import { platform } from 'process';
import { join } from 'path';

const WIN_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome Beta\\Application\\chrome.exe'),
];

const MAC_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

const LINUX_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

/**
 * Returns the path to the first found Chrome/Chromium executable, or null.
 */
export function detectChromePath() {
  const paths = platform === 'win32' ? WIN_PATHS
    : platform === 'darwin' ? MAC_PATHS
    : LINUX_PATHS;
  return paths.find(p => p && existsSync(p)) ?? null;
}

/**
 * Returns a platform-appropriate command to start Chrome with CDP enabled.
 */
export function startChromeHint(cdpUrl = 'http://localhost:9222') {
  const port = new URL(cdpUrl).port || '9222';
  const chromePath = detectChromePath();

  if (platform === 'win32') {
    return chromePath
      ? `"${chromePath}" --remote-debugging-port=${port} --user-data-dir="%USERPROFILE%\\chrome-grasp"`
      : `start-chrome.bat`;
  }
  if (platform === 'darwin') {
    return chromePath
      ? `"${chromePath}" --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-grasp`
      : `open -a "Google Chrome" --args --remote-debugging-port=${port}`;
  }
  return chromePath
    ? `"${chromePath}" --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-grasp`
    : `google-chrome --remote-debugging-port=${port}`;
}
