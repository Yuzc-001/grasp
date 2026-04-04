import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakePage } from '../helpers/fake-page.js';
import { registerGatewayTools } from '../../src/server/tools.gateway.js';
import { storeRuntimeConfirmation } from '../../src/server/runtime-confirmation.js';

function createServerAndState() {
  const calls = [];
  const server = {
    registerTool(name, spec, handler) {
      calls.push({ name, spec, handler });
    },
  };
  const state = {
    pageState: { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false },
    handoff: { state: 'idle' },
  };

  return { calls, server, state };
}

test('extract_batch returns structured records and writes CSV/JSON/Markdown artifacts', async () => {
  const { calls, server, state } = createServerAndState();
  const runtimeInstance = {
    browser: 'Chrome/136.0.7103.114',
    protocolVersion: '1.3',
    display: 'windowed',
    headless: false,
    warning: null,
  };
  storeRuntimeConfirmation(state, runtimeInstance);

  const pages = new Map([
    ['https://example.com/alice', createFakePage({
      url: () => 'https://example.com/alice',
      title: () => 'Alice Profile',
    })],
    ['https://example.com/bob', createFakePage({
      url: () => 'https://example.com/bob',
      title: () => 'Bob Profile',
    })],
  ]);
  let currentUrl = 'https://example.com/alice';
  const writtenArtifacts = [];

  registerGatewayTools(server, state, {
    getBrowserInstance: async () => runtimeInstance,
    enterWithStrategy: async ({ url }) => {
      currentUrl = url;
      state.pageState = { currentRole: 'content', graspConfidence: 'high', riskGateDetected: false };
      return {
        url,
        title: await pages.get(url).title(),
        preflight: { session_trust: 'high', recommended_entry_strategy: 'direct_goto' },
        pageState: state.pageState,
        handoff: state.handoff,
        entry_method: 'direct_goto',
        final_url: url,
        verified: true,
      };
    },
    getActivePage: async () => pages.get(currentUrl),
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true, attempts: 1 }),
    extractMainContent: async (page) => ({
      title: await page.title(),
      text: page.url().includes('/alice')
        ? '职位: 前端工程师\n公司名称: OpenAI\n城市: San Francisco'
        : '职位: 设计工程师\n公司名称: Midjourney\n城市: San Francisco',
    }),
    extractStructuredContent: async (page, fields) => ({
      requested_fields: fields,
      record: page.url().includes('/alice')
        ? { 职位: '前端工程师', 公司名称: 'OpenAI' }
        : { 职位: '设计工程师', 公司名称: 'Midjourney' },
      missing_fields: ['邮箱'],
      evidence: [
        { field: '职位', label: '职位', value: page.url().includes('/alice') ? '前端工程师' : '设计工程师', strategy: 'inline_pair' },
      ],
    }),
    writeArtifact: async (artifact) => {
      writtenArtifacts.push(artifact);
      return {
        path: `/tmp/${artifact.filename}`,
        bytes: Buffer.isBuffer(artifact.data)
          ? artifact.data.length
          : Buffer.byteLength(String(artifact.data), artifact.encoding === 'utf8' ? 'utf8' : undefined),
      };
    },
  });

  const extractBatch = calls.find((tool) => tool.name === 'extract_batch');
  const result = await extractBatch.handler({
    urls: ['https://example.com/alice', 'https://example.com/bob'],
    fields: ['职位', '公司名称', '邮箱'],
    include_markdown: true,
  });

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.records.length, 2);
  assert.deepEqual(result.meta.result.records[0].record, {
    职位: '前端工程师',
    公司名称: 'OpenAI',
  });
  assert.deepEqual(result.meta.result.records[1].record, {
    职位: '设计工程师',
    公司名称: 'Midjourney',
  });
  assert.equal(writtenArtifacts.length, 3);
  assert.equal(result.meta.result.artifacts.csv.path, '/tmp/batch-extract.csv');
  assert.equal(result.meta.result.artifacts.json.path, '/tmp/batch-extract.json');
  assert.equal(result.meta.result.artifacts.markdown.path, '/tmp/batch-extract.md');
});

test('share_page writes markdown, screenshot, and pdf artifacts from the current page projection', async () => {
  const { calls, server, state } = createServerAndState();
  const page = createFakePage({
    url: () => 'https://example.com/share',
    title: () => 'Shareable Result',
  });
  const scratchPage = createFakePage({
    setContent: async () => undefined,
    screenshot: async () => Buffer.from('png-binary'),
    pdf: async () => Buffer.from('%PDF-1.7'),
    close: async () => undefined,
  });
  page.context = () => ({
    newPage: async () => scratchPage,
  });

  const writtenArtifacts = [];

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true, attempts: 1 }),
    extractMainContent: async () => ({
      title: 'Shareable Result',
      text: '这是一个适合分享给家人和朋友的结果页面。',
    }),
    buildExplainShareCard: async () => ({
      engine: 'pretext',
      width: 640,
      estimated_height: 420,
      title_lines: 1,
      summary_lines: 2,
      body_lines: 3,
      card_markdown: '# Shareable Result',
    }),
    writeArtifact: async (artifact) => {
      writtenArtifacts.push(artifact);
      return {
        path: `/tmp/${artifact.filename}`,
        bytes: Buffer.isBuffer(artifact.data)
          ? artifact.data.length
          : Buffer.byteLength(String(artifact.data), artifact.encoding === 'utf8' ? 'utf8' : undefined),
      };
    },
  });

  const sharePage = calls.find((tool) => tool.name === 'share_page');
  const markdownResult = await sharePage.handler({ format: 'markdown' });
  const screenshotResult = await sharePage.handler({ format: 'screenshot' });
  const pdfResult = await sharePage.handler({ format: 'pdf' });

  assert.equal(writtenArtifacts.length, 3);
  assert.equal(markdownResult.meta.result.artifact.format, 'markdown');
  assert.equal(screenshotResult.meta.result.artifact.format, 'screenshot');
  assert.equal(pdfResult.meta.result.artifact.format, 'pdf');
  assert.equal(screenshotResult.meta.result.artifact.path, '/tmp/share-page.png');
  assert.equal(pdfResult.meta.result.artifact.path, '/tmp/share-page.pdf');
  assert.equal(pdfResult.meta.result.explain_card.engine, 'pretext');
});

test('explain_share_card exposes layout metadata for the current page share card', async () => {
  const { calls, server, state } = createServerAndState();
  const page = createFakePage({
    url: () => 'https://example.com/explain',
    title: () => 'Explain Result',
  });

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true, attempts: 1 }),
    extractMainContent: async () => ({
      title: 'Explain Result',
      text: '这里是正文内容，用于生成分享解释卡片。',
    }),
    buildExplainShareCard: async () => ({
      engine: 'pretext',
      width: 640,
      estimated_height: 360,
      title_lines: 1,
      summary_lines: 1,
      body_lines: 2,
      card_markdown: '# Explain Result',
    }),
  });

  const explainShareCard = calls.find((tool) => tool.name === 'explain_share_card');
  const result = await explainShareCard.handler();

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.explain_card.engine, 'pretext');
  assert.equal(result.meta.result.explain_card.estimated_height, 360);
  assert.match(result.content[0].text, /Explain card engine: pretext/);
});

test('share_page falls back when share card measurement crashes', async () => {
  const { calls, server, state } = createServerAndState();
  const page = createFakePage({
    url: () => 'https://example.com/share',
    title: () => 'Shareable Result',
  });
  const writtenArtifacts = [];

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true, attempts: 1 }),
    extractMainContent: async () => ({
      title: 'Shareable Result',
      text: '这是一个适合分享给家人和朋友的结果页面。',
    }),
    buildExplainShareCard: async () => {
      throw new Error('window.__graspPretextMeasure is not a function');
    },
    writeArtifact: async (artifact) => {
      writtenArtifacts.push(artifact);
      return {
        path: `/tmp/${artifact.filename}`,
        bytes: Buffer.byteLength(String(artifact.data), artifact.encoding === 'utf8' ? 'utf8' : undefined),
      };
    },
  });

  const sharePage = calls.find((tool) => tool.name === 'share_page');
  const result = await sharePage.handler({ format: 'markdown' });

  assert.equal(writtenArtifacts.length, 1);
  assert.equal(result.meta.result.explain_card.engine, 'fallback');
  assert.equal(result.meta.result.artifact.format, 'markdown');
  assert.match(result.content[0].text, /Status: direct/);
});

test('explain_share_card falls back when share card measurement crashes', async () => {
  const { calls, server, state } = createServerAndState();
  const page = createFakePage({
    url: () => 'https://example.com/explain',
    title: () => 'Explain Result',
  });

  registerGatewayTools(server, state, {
    getActivePage: async () => page,
    syncPageState: async (_page, currentState) => {
      currentState.pageState = state.pageState;
      return currentState;
    },
    waitUntilStable: async () => ({ stable: true, attempts: 1 }),
    extractMainContent: async () => ({
      title: 'Explain Result',
      text: '这里是正文内容，用于生成分享解释卡片。',
    }),
    buildExplainShareCard: async () => {
      throw new Error('window.__graspPretextMeasure is not a function');
    },
  });

  const explainShareCard = calls.find((tool) => tool.name === 'explain_share_card');
  const result = await explainShareCard.handler({});

  assert.equal(result.meta.status, 'direct');
  assert.equal(result.meta.result.explain_card.engine, 'fallback');
  assert.match(result.content[0].text, /Explain card engine: fallback/);
});
