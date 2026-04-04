export function createTaskFrame({ taskId, kind, maxAttempts = 3 }) {
  const now = new Date().toISOString();
  return {
    taskId,
    kind,
    attempts: 0,
    maxAttempts,
    status: 'active',
    goal: null,
    targetUrl: null,
    createdAt: now,
    updatedAt: now,
    lastTool: null,
    lastResult: null,
    artifacts: [],
    cancelledAt: null,
    history: [],
    semanticBindings: new Map(),
    nextRecovery: null,
  };
}

export function touchTaskFrame(frame, updates = {}) {
  if (!frame) return null;
  Object.assign(frame, updates, {
    updatedAt: new Date().toISOString(),
  });
  return frame;
}

export function rememberTaskArtifacts(frame, artifacts = []) {
  if (!frame) return frame;
  const nextArtifacts = Array.isArray(artifacts) ? artifacts.filter(Boolean) : [];
  frame.artifacts = nextArtifacts;
  frame.updatedAt = new Date().toISOString();
  return frame;
}

export function rememberTaskResult(frame, {
  tool = null,
  status = null,
  summary = null,
  route = null,
  page = null,
  artifacts = null,
} = {}) {
  if (!frame) return frame;

  if (tool) {
    frame.lastTool = tool;
  }
  if (status) {
    frame.status = status;
  }

  frame.lastResult = {
    tool,
    status,
    summary,
    route,
    page,
    recordedAt: new Date().toISOString(),
  };
  frame.updatedAt = frame.lastResult.recordedAt;

  if (Array.isArray(artifacts)) {
    frame.artifacts = artifacts.filter(Boolean);
  }

  return frame;
}
