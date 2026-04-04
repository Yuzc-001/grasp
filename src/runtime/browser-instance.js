const DEFAULT_TIMEOUT = 1500;

export function inferBrowserInstance(versionInfo = {}) {
  const browser = typeof versionInfo?.Browser === 'string'
    ? versionInfo.Browser
    : null;
  const protocolVersion = typeof versionInfo?.['Protocol-Version'] === 'string'
    ? versionInfo['Protocol-Version']
    : null;
  const normalized = browser?.toLowerCase() ?? '';

  let headless = null;
  if (normalized.includes('headlesschrome/') || normalized.includes('headlessedg/')) {
    headless = true;
  } else if (normalized.includes('chrome/') || normalized.includes('edg/')) {
    headless = false;
  }

  const display = headless === true
    ? 'headless'
    : headless === false
      ? 'windowed'
      : 'unknown';

  return {
    browser,
    protocolVersion,
    headless,
    display,
    warning: headless === true
      ? 'Current endpoint is a headless browser, not a visible local browser window.'
      : null,
  };
}

export function requireVisibleBrowserInstance(instance, contextLabel = 'This check') {
  if (instance?.headless === false) return null;

  const label = typeof contextLabel === 'string' && contextLabel.trim()
    ? contextLabel.trim()
    : 'This check';

  if (instance?.headless === true) {
    const browser = instance.browser ?? 'unknown browser';
    return `${label} requires a visible local browser window. Current browser: ${browser}`;
  }

  return `${label} requires a visible local browser window. Current browser could not be identified.`;
}

export async function readBrowserInstance(cdpUrl, {
  fetchImpl = fetch,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  try {
    const res = await fetchImpl(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const versionInfo = await res.json();
    return inferBrowserInstance(versionInfo);
  } catch {
    return null;
  }
}
