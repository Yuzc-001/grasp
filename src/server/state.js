import { probe, listTools } from '../layer1-bridge/webmcp.js';
import { buildHintMap } from '../layer2-perception/hints.js';
import { createHandoffState } from '../grasp/handoff/state.js';
import { createPageGraspState, applySnapshotToPageGraspState } from '../grasp/page/state.js';
import { capturePageSnapshot } from '../grasp/page/capture.js';

const TRANSIENT_CONTEXT_ERRORS = [
  'Execution context was destroyed',
  'Cannot find context with specified id',
];

function isTransientExecutionContextError(error) {
  const message = error?.message ?? '';
  return TRANSIENT_CONTEXT_ERRORS.some((pattern) => message.includes(pattern));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransientPageStep(step, { attempts = 3, delayMs = 120 } = {}) {
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await step();
    } catch (error) {
      lastError = error;
      if (!isTransientExecutionContextError(error) || i === attempts - 1) {
        throw error;
      }
      await sleep(delayMs * (i + 1));
    }
  }

  throw lastError;
}

export function isSafeModeEnabled() {
  return process.env.GRASP_SAFE_MODE !== 'false';
}

export function createServerState() {
  return {
    webmcp: null,
    hintMap: [],
    lastUrl: null,
    targetSession: null,
    activeTaskId: null,
    hintRegistry: new Map(),
    hintCounters: { B: 0, I: 0, L: 0, S: 0 },
    safeMode: isSafeModeEnabled(),
    pageState: createPageGraspState(),
    handoff: createHandoffState(),
    runtimeTruth: null,
    verificationContext: null,
    lastRouteTrace: null,
    taskFrames: new Map(),
  };
}

export function getActiveTaskFrame(state) {
  const taskId = state?.activeTaskId ?? state?.taskId ?? null;
  if (!taskId) return null;
  return state?.taskFrames?.get(taskId) ?? null;
}

export async function syncPageState(page, state, { force = false } = {}) {
  const url = page.url();
  const snapshotData = await capturePageSnapshot(page);
  const snapshotHash = `${url}|${snapshotData.nodes}|${snapshotData.bodyText}`;
  const prevPageState = state.pageState ?? createPageGraspState();
  const nextPageState = applySnapshotToPageGraspState(prevPageState, {
    url,
    snapshotHash,
    title: snapshotData.title,
    bodyText: snapshotData.bodyText,
    nodes: snapshotData.nodes,
    forms: snapshotData.forms,
    navs: snapshotData.navs,
    headings: snapshotData.headings,
  });
  const urlChanged = prevPageState.lastUrl !== url;
  const domRevisionChanged = prevPageState.domRevision !== nextPageState.domRevision;
  state.pageState = nextPageState;
  state.lastUrl = nextPageState.lastUrl;
  const activeTaskFrame = getActiveTaskFrame(state);
  if (activeTaskFrame) {
    activeTaskFrame.lastUrl = nextPageState.lastUrl;
  }

  const needsRefresh = force || state.webmcp === null || urlChanged || domRevisionChanged;
  if (!needsRefresh) return state;

  if (urlChanged) {
    state.hintRegistry = new Map();
    state.hintCounters = { B: 0, I: 0, L: 0, S: 0 };
  }

  await retryTransientPageStep(async () => {
    const webmcp = await probe(page);
    state.lastUrl = url;

    if (webmcp.available) {
      const tools = await listTools(page, webmcp);
      state.webmcp = { ...webmcp, tools };
      state.hintMap = [];
      return;
    }

    state.webmcp = webmcp;
    state.hintMap = await buildHintMap(page, state.hintRegistry, state.hintCounters);
  });
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
