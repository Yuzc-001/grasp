const PRETEXT_MODULE_URL = new URL('../../node_modules/@chenglou/pretext/dist/layout.js', import.meta.url).href;

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function fallbackLayout(text, maxWidth, lineHeight) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { height: lineHeight, lineCount: 1 };
  }

  const charsPerLine = Math.max(10, Math.floor(maxWidth / 9));
  const lineCount = Math.max(1, Math.ceil(normalized.length / charsPerLine));
  return {
    height: lineCount * lineHeight,
    lineCount,
  };
}

async function defaultCreateScratchPage(page) {
  const context = page?.context?.();
  if (!context || typeof context.newPage !== 'function') {
    throw new Error('Pretext measurement requires a browser page context.');
  }
  return context.newPage();
}

async function measureWithPretext(page, blocks, deps = {}) {
  const createScratchPage = deps.createScratchPage ?? defaultCreateScratchPage;
  const scratchPage = await createScratchPage(page);

  try {
    await scratchPage.setContent('<!doctype html><html><body></body></html>', { waitUntil: 'load' });
    await scratchPage.addScriptTag({
      type: 'module',
      content: `
        import { prepare, layout } from ${JSON.stringify(PRETEXT_MODULE_URL)};
        window.__graspPretextMeasure = async (blocks) => {
          return blocks.map((block) => {
            const prepared = prepare(block.text, block.font, { whiteSpace: block.whiteSpace ?? 'normal' });
            const result = layout(prepared, block.maxWidth, block.lineHeight);
            return {
              key: block.key,
              height: result.height,
              lineCount: result.lineCount,
            };
          });
        };
      `,
    });

    const measured = await scratchPage.evaluate(async (input) => {
      if (typeof window.__graspPretextMeasure !== 'function') {
        return { error: 'pretext_helper_missing' };
      }

      try {
        return await window.__graspPretextMeasure(input);
      } catch (error) {
        return {
          error: error?.message ?? 'pretext_measure_failed',
        };
      }
    }, blocks);

    if (!Array.isArray(measured)) {
      throw new Error(measured?.error ?? 'pretext_helper_missing');
    }

    return measured;
  } finally {
    await scratchPage.close?.().catch?.(() => {});
  }
}

function buildShareCardFromMeasured(projection, options = {}, blocks, measured, engine) {
  const width = Number(options.width ?? 640);
  const title = normalizeText(projection?.title, 'Untitled');
  const summary = normalizeText(projection?.summary, projection?.main_text);
  const bodyExcerpt = normalizeText(projection?.main_text).slice(0, 420);
  const byKey = Object.fromEntries(measured.map((item) => [item.key, item]));
  const estimatedHeight = (byKey.title?.height ?? 0)
    + (byKey.summary?.height ?? 0)
    + (byKey.body?.height ?? 0)
    + 220;

  return {
    engine,
    width,
    estimated_height: estimatedHeight,
    title_lines: byKey.title?.lineCount ?? 1,
    summary_lines: byKey.summary?.lineCount ?? 1,
    body_lines: byKey.body?.lineCount ?? 1,
    body_excerpt: bodyExcerpt,
    card_markdown: [
      `# ${title}`,
      '',
      `Source: ${normalizeText(projection?.url, 'unknown')}`,
      '',
      `Summary: ${summary}`,
      '',
      `Layout engine: ${engine}`,
      `Estimated height: ${estimatedHeight}px`,
    ].join('\n'),
  };
}

function buildShareCardBlocks(projection, options = {}) {
  const width = Number(options.width ?? 640);
  const title = normalizeText(projection?.title, 'Untitled');
  const summary = normalizeText(projection?.summary, projection?.main_text);
  const bodyExcerpt = normalizeText(projection?.main_text).slice(0, 420);

  return {
    width,
    title,
    summary,
    bodyExcerpt,
    blocks: [
      { key: 'title', text: title, font: '600 28px Arial', maxWidth: width, lineHeight: 34 },
      { key: 'summary', text: summary, font: '16px Arial', maxWidth: width, lineHeight: 24 },
      { key: 'body', text: bodyExcerpt, font: '14px Arial', maxWidth: width, lineHeight: 22, whiteSpace: 'pre-wrap' },
    ],
  };
}

export function buildFallbackExplainShareCard(projection, options = {}) {
  const { blocks } = buildShareCardBlocks(projection, options);
  const measured = blocks.map((block) => ({
    key: block.key,
    ...fallbackLayout(block.text, block.maxWidth, block.lineHeight),
  }));

  return buildShareCardFromMeasured(projection, options, blocks, measured, 'fallback');
}

export async function buildExplainShareCard(page, projection, options = {}, deps = {}) {
  const { blocks } = buildShareCardBlocks(projection, options);
  let measured = blocks.map((block) => ({
    key: block.key,
    ...fallbackLayout(block.text, block.maxWidth, block.lineHeight),
  }));
  let engine = 'fallback';

  try {
    const nextMeasured = await measureWithPretext(page, blocks, deps);
    if (Array.isArray(nextMeasured) && nextMeasured.length === blocks.length) {
      measured = nextMeasured;
      engine = 'pretext';
    }
  } catch {
    // fall back to deterministic approximation
  }

  return buildShareCardFromMeasured(projection, options, blocks, measured, engine);
}
