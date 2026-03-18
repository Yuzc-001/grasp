const DEFAULT_STABLE_CHECKS = 3;
const DEFAULT_INTERVAL = 200;
const DEFAULT_TIMEOUT = 5000;

async function defaultSnapshot(page) {
  return page.evaluate(() => {
    const safeText = (el) => (el?.innerText ?? '').trim();
    const main = document.querySelector('main') || document.querySelector('article');
    const mainText = safeText(main);
    const bodyText = safeText(document.body);
    return {
      title: document.title ?? '',
      mainText,
      bodyText,
      readyState: document.readyState,
    };
  });
}

export async function extractMainContent(page) {
  const { title, mainText, bodyText } = await defaultSnapshot(page);
  const text = (mainText && mainText.length > 0) ? mainText : bodyText;
  return {
    title,
    text: (text ?? '').trim(),
  };
}

export async function waitUntilStable(page, options = {}) {
  const {
    getSnapshot,
    stableChecks = DEFAULT_STABLE_CHECKS,
    interval = DEFAULT_INTERVAL,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const snapshotter = typeof getSnapshot === 'function'
    ? () => getSnapshot(page)
    : () => defaultSnapshot(page);

  const start = Date.now();
  const history = [];
  let lastSnapshot;

  while (Date.now() - start < timeout) {
    const snapshot = await snapshotter();
    history.push(snapshot);
    lastSnapshot = snapshot;

    if (history.length >= stableChecks) {
      const recent = history.slice(-stableChecks);
      const normalized = recent.map((item) => JSON.stringify(item));
      const first = normalized[0];
      if (normalized.every((value) => value === first)) {
        return {
          stable: true,
          attempts: history.length,
          snapshot: recent[0],
        };
      }
    }

    if (interval > 0) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    stable: false,
    attempts: history.length,
    snapshot: lastSnapshot,
  };
}
