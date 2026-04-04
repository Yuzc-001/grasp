import { mkdir, writeFile } from 'node:fs/promises';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_ARTIFACT_DIR = path.join(os.homedir(), '.grasp', 'artifacts');

export function getDefaultArtifactDir() {
  return DEFAULT_ARTIFACT_DIR;
}

function toSafeText(value) {
  return String(value ?? '').trim();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildShareMarkdown({ projection, explainCard } = {}) {
  const title = toSafeText(projection?.title) || 'Untitled';
  const url = toSafeText(projection?.url) || 'unknown';
  const summary = toSafeText(projection?.summary);
  const mainText = toSafeText(projection?.main_text);
  const lines = [
    `# ${title}`,
    '',
    `Source: ${url}`,
  ];

  if (summary) {
    lines.push('', '## Summary', '', summary);
  }

  if (mainText) {
    lines.push('', '## Content', '', mainText);
  }

  if (explainCard) {
    lines.push(
      '',
      '## Share Card',
      '',
      `- Engine: ${explainCard.engine}`,
      `- Estimated height: ${explainCard.estimated_height}px`,
      `- Title lines: ${explainCard.title_lines}`,
      `- Summary lines: ${explainCard.summary_lines}`,
      `- Body lines: ${explainCard.body_lines}`,
    );
  }

  return lines.join('\n').trim();
}

export function buildBatchMarkdownBundle({ fields = [], records = [] } = {}) {
  const lines = ['# Batch Extract', ''];

  for (const record of records) {
    const title = toSafeText(record?.title) || 'Untitled';
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(`- Input URL: ${toSafeText(record?.input_url) || 'unknown'}`);
    lines.push(`- Final URL: ${toSafeText(record?.final_url) || 'unknown'}`);
    lines.push(`- Status: ${toSafeText(record?.status) || 'unknown'}`);

    for (const field of fields) {
      lines.push(`- ${field}: ${toSafeText(record?.record?.[field]) || ''}`);
    }

    if (Array.isArray(record?.missing_fields) && record.missing_fields.length > 0) {
      lines.push(`- Missing fields: ${record.missing_fields.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

export function serializeCsv(columns = [], rows = []) {
  const escapeCell = (value) => {
    const cell = String(value ?? '');
    if (cell.includes('"') || cell.includes(',') || cell.includes('\n')) {
      return `"${cell.replaceAll('"', '""')}"`;
    }
    return cell;
  };

  const csvRows = [
    columns.map(escapeCell).join(','),
    ...rows.map((row) => columns.map((column) => escapeCell(row?.[column])).join(',')),
  ];

  return csvRows.join('\n');
}

export function buildShareHtml({ projection, explainCard } = {}) {
  const title = toSafeText(projection?.title) || 'Untitled';
  const url = toSafeText(projection?.url) || 'unknown';
  const summary = toSafeText(projection?.summary);
  const mainText = toSafeText(projection?.main_text);
  const headerHeight = Math.max(240, Number(explainCard?.estimated_height ?? 0));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --page-width: 860px;
        --ink: #0b1738;
        --muted: #52607a;
        --line: #d9e0ef;
        --card: #ffffff;
        --wash: linear-gradient(180deg, #eef5ff 0%, #f9fbff 100%);
        --accent: #23c993;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 40px;
        font-family: Arial, sans-serif;
        background: radial-gradient(circle at top left, #dff6ea 0%, #eef5ff 42%, #f8fbff 100%);
        color: var(--ink);
      }
      .sheet {
        width: min(100%, var(--page-width));
        margin: 0 auto;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 28px;
        overflow: hidden;
        box-shadow: 0 24px 80px rgba(11, 23, 56, 0.12);
      }
      .hero {
        min-height: ${headerHeight}px;
        padding: 40px 44px 28px;
        background: var(--wash);
        border-bottom: 1px solid var(--line);
      }
      .eyebrow {
        display: inline-block;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(35, 201, 147, 0.12);
        color: #0d7d5d;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 14px;
        font-size: 34px;
        line-height: 1.2;
      }
      .summary {
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.55;
      }
      .meta {
        margin-top: 20px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .body {
        padding: 32px 44px 44px;
        white-space: pre-wrap;
        font-size: 16px;
        line-height: 1.7;
      }
      .layout {
        margin-top: 28px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .layout-card {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.78);
      }
      .layout-card strong {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 6px;
      }
      .layout-card span {
        font-size: 18px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="hero">
        <div class="eyebrow">Grasp Share</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="summary">${escapeHtml(summary || mainText.slice(0, 160))}</p>
        <div class="meta">Source: ${escapeHtml(url)}</div>
        <div class="layout">
          <div class="layout-card"><strong>Engine</strong><span>${escapeHtml(explainCard?.engine ?? 'fallback')}</span></div>
          <div class="layout-card"><strong>Height</strong><span>${escapeHtml(String(explainCard?.estimated_height ?? 0))}px</span></div>
          <div class="layout-card"><strong>Title Lines</strong><span>${escapeHtml(String(explainCard?.title_lines ?? 0))}</span></div>
          <div class="layout-card"><strong>Summary Lines</strong><span>${escapeHtml(String(explainCard?.summary_lines ?? 0))}</span></div>
        </div>
      </section>
      <section class="body">${escapeHtml(mainText)}</section>
    </main>
  </body>
</html>`;
}

async function defaultCreateScratchPage(page) {
  const context = page?.context?.();
  if (!context || typeof context.newPage !== 'function') {
    throw new Error('Share rendering requires a browser page context.');
  }
  return context.newPage();
}

export async function renderShareArtifact(page, html, format, deps = {}) {
  const createScratchPage = deps.createScratchPage ?? defaultCreateScratchPage;
  const scratchPage = await createScratchPage(page);

  try {
    if (typeof scratchPage.setViewportSize === 'function') {
      await scratchPage.setViewportSize({ width: 960, height: 1280 });
    }
    await scratchPage.setContent(html, { waitUntil: 'load' });

    if (format === 'screenshot') {
      return {
        data: await scratchPage.screenshot({ type: 'png', fullPage: true }),
        extension: 'png',
        mimeType: 'image/png',
      };
    }

    if (format === 'pdf') {
      return {
        data: await scratchPage.pdf({
          printBackground: true,
          preferCSSPageSize: true,
        }),
        extension: 'pdf',
        mimeType: 'application/pdf',
      };
    }

    throw new Error(`Unsupported share format: ${format}`);
  } finally {
    await scratchPage.close?.().catch?.(() => {});
  }
}

export async function writeArtifactFile(artifact, deps = {}) {
  const {
    artifactDir = DEFAULT_ARTIFACT_DIR,
    mkdirImpl = mkdir,
    writeFileImpl = writeFile,
  } = deps;
  const filename = toSafeText(artifact?.filename) || 'artifact.txt';
  const fullPath = path.join(artifactDir, filename);

  await mkdirImpl(artifactDir, { recursive: true });
  await writeFileImpl(fullPath, artifact.data, artifact.encoding ? { encoding: artifact.encoding } : undefined);

  return {
    path: fullPath,
    bytes: Buffer.isBuffer(artifact.data)
      ? artifact.data.length
      : Buffer.byteLength(String(artifact.data), artifact.encoding === 'utf8' ? 'utf8' : undefined),
    mimeType: artifact.mimeType ?? null,
  };
}

export async function listArtifactFiles({ artifactDir = DEFAULT_ARTIFACT_DIR, limit = 20 } = {}) {
  try {
    const names = await readdir(artifactDir);
    const entries = [];

    for (const name of names) {
      const fullPath = path.join(artifactDir, name);
      const info = await stat(fullPath);
      if (!info.isFile()) continue;
      entries.push({
        name,
        path: fullPath,
        bytes: info.size,
        updated_at: info.mtime.toISOString(),
      });
    }

    return entries
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, limit);
  } catch {
    return [];
  }
}
