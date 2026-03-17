import { probe, listTools } from '../layer1-bridge/webmcp.js';
import { buildHintMap } from '../layer2-perception/hints.js';

export function createServerState() {
  return {
    webmcp: null,
    hintMap: [],
    lastUrl: null,
    hintRegistry: new Map(),   // fingerprint → id，跨调用保持稳定
    hintCounters: { B: 0, I: 0, L: 0, S: 0 },
    safeMode: process.env.GRASP_SAFE_MODE !== 'false',
  };
}

export async function syncPageState(page, state, { force = false } = {}) {
  const url = page.url();
  const needsRefresh = force || state.webmcp === null || state.lastUrl !== url;

  if (!needsRefresh) {
    return state;
  }

  // URL 变化 → 新页面，清空 hint 注册表
  if (state.lastUrl !== url) {
    state.hintRegistry = new Map();
    state.hintCounters = { B: 0, I: 0, L: 0, S: 0 };
  }

  const webmcp = await probe(page);
  state.lastUrl = url;

  if (webmcp.available) {
    const tools = await listTools(page, webmcp);
    state.webmcp = { ...webmcp, tools };
    state.hintMap = [];
    return state;
  }

  state.webmcp = webmcp;
  state.hintMap = await buildHintMap(page, state.hintRegistry, state.hintCounters);
  return state;
}

export function describeMode(state) {
  if (state.webmcp?.available) {
    return {
      mode: 'WebMCP',
      detail: `WebMCP via ${state.webmcp.source} (${state.webmcp.tools?.length ?? 0} native tools)`,
      summary: `WebMCP (${state.webmcp.tools?.length ?? 0} native tools)`,
    };
  }

  return {
    mode: 'CDP',
    detail: 'CDP (Hint Map + Mouse Events)',
    summary: 'CDP (Hint Map + Mouse Events)',
  };
}
