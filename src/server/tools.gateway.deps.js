import { readBrowserInstance } from '../runtime/browser-instance.js';
import { clearHandoff as defaultClearHandoff } from '../grasp/handoff/events.js';
import { writeHandoffState as defaultWriteHandoffState } from '../grasp/handoff/persist.js';
import { writeArtifactFile } from './share-artifacts.js';

export function resolveGatewayDeps(deps = {}) {
  return {
    enter: deps.enterWithStrategy ?? deps.enter,
    getPage: deps.getActivePage ?? deps.getPage,
    syncState: deps.syncPageState ?? deps.syncState,
    observeContent: deps.extractObservedContent ?? deps.observeContent,
    auditRoute: deps.auditRouteDecision ?? deps.auditRoute,
    readLatestRoute: deps.readLatestRouteDecision ?? deps.readLatestRoute,
    getBrowserInstance: deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222')),
    extractStructured: deps.extractStructuredContent ?? deps.extractStructured,
    readFastPathContent: deps.readFastPath ?? deps.readFastPathContent,
    writeArtifact: deps.writeArtifact ?? writeArtifactFile,
    renderShareArtifact: deps.renderShareArtifact,
    buildExplainShareCard: deps.buildExplainShareCard,
    buildFallbackExplainShareCard: deps.buildFallbackExplainShareCard,
    clearHandoff: deps.clearHandoff ?? defaultClearHandoff,
    writeHandoffState: deps.writeHandoffState ?? defaultWriteHandoffState,
  };
}
