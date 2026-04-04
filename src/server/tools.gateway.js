import { z } from 'zod';

import { buildGatewayResponse } from './gateway-response.js';
import { extractObservedContent } from './observe.js';
import { assessGatewayContinuation } from './continuity.js';
import { getActivePage, readStablePageTitle } from '../layer1-bridge/chrome.js';

import { syncPageState } from './state.js';
import { enterWithStrategy } from './tools.strategy.js';
import { readFastPath } from './fast-path-router.js';

import { selectEngine } from './engine-selection.js';
import { decideRoute } from './route-policy.js';

import {

  buildGatewayOutcome,

  getBatchStatus,

  getEffectiveEntryHandoff,

  getGatewayContinuation,

  getGatewayStatus,

  getRouteForState,

  projectPageContent,

  rememberGatewayTask,

  resolvedDirectEntry,

  toGatewayPage,

} from './tools.gateway.helpers.js';

import { auditRouteDecision, readLatestRouteDecision } from './audit.js';
import { textResponse } from './responses.js';
import { ROUTE_BLOCKED } from './error-codes.js';
import { readBrowserInstance } from '../runtime/browser-instance.js';
import { requireConfirmedRuntimeInstance } from './runtime-confirmation.js';
import { extractStructuredContent } from './structured-extraction.js';
import {
  buildExplainShareCard as defaultBuildExplainShareCard,
  buildFallbackExplainShareCard as defaultBuildFallbackExplainShareCard,
} from './explain-share-card.js';
import { clearHandoff as defaultClearHandoff } from '../grasp/handoff/events.js';
import { writeHandoffState as defaultWriteHandoffState } from '../grasp/handoff/persist.js';
import {
  buildBatchMarkdownBundle,
  buildShareHtml,
  buildShareMarkdown,
  renderShareArtifact as renderShareArtifactFile,
  serializeCsv,
  writeArtifactFile,
} from './share-artifacts.js';

function buildSafeExplainShareCard(buildExplainShareCard, buildFallbackExplainShareCard, page, projection, options = {}) {
  return Promise
    .resolve()
    .then(() => buildExplainShareCard(page, projection, options))
    .catch(() => buildFallbackExplainShareCard(projection, options));
}

export function registerGatewayTools(server, state, deps = {}) {
  const enter = deps.enterWithStrategy ?? enterWithStrategy;
  const getPage = deps.getActivePage ?? getActivePage;
  const syncState = deps.syncPageState ?? syncPageState;
  const observeContent = deps.extractObservedContent ?? extractObservedContent;
  const auditRoute = deps.auditRouteDecision ?? auditRouteDecision;
  const readLatestRoute = deps.readLatestRouteDecision ?? readLatestRouteDecision;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));
  const extractStructured = deps.extractStructuredContent ?? extractStructuredContent;
  const readFastPathContent = deps.readFastPath ?? readFastPath;
  const writeArtifact = deps.writeArtifact ?? writeArtifactFile;
  const renderShareArtifact = deps.renderShareArtifact ?? renderShareArtifactFile;
  const buildExplainShareCard = deps.buildExplainShareCard ?? defaultBuildExplainShareCard;
  const buildFallbackExplainShareCard = deps.buildFallbackExplainShareCard ?? defaultBuildFallbackExplainShareCard;
  const clearHandoff = deps.clearHandoff ?? defaultClearHandoff;
  const writeHandoffState = deps.writeHandoffState ?? defaultWriteHandoffState;

  server.registerTool(
    'entry',
    {
      description: 'Enter a URL through the gateway using preflight strategy metadata.',
      inputSchema: {
        url: z.string().url().describe('Target URL to enter'),
        intent: z.enum(['read', 'extract', 'act', 'submit', 'workspace', 'collect']).optional().describe('Task intent used to choose the best route'),
      },
    },
    async ({ url, intent = 'extract' }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'entry');
      if (confirmationError) return confirmationError;
      const outcome = await enter({ url, state, deps: { auditName: 'entry' } });
      let effectiveHandoff = getEffectiveEntryHandoff(outcome);
      if (resolvedDirectEntry(outcome)) {
        effectiveHandoff = clearHandoff(outcome.handoff ?? state.handoff ?? {});
        state.handoff = effectiveHandoff;
        await writeHandoffState(effectiveHandoff);
      }
      const gatewayOutcome = buildGatewayOutcome({
        ...outcome,
        handoff: effectiveHandoff,
      });
      const preferCurrentUrl = outcome.preflight?.recommended_entry_strategy === 'handoff_or_preheat';
      const route = decideRoute({
        url,
        intent,
        selection: selectEngine({ tool: intent, url }),
        preflight: outcome.preflight,
        pageState: outcome.pageState ?? state.pageState,
        handoff: effectiveHandoff ?? state.handoff,
      });
      const routeTrace = {
        url,
        intent,
        status: gatewayOutcome.status,
        ...route,
        failure_type: route.selected_mode === 'handoff' ? 'route_blocked' : 'none',
        error_code: route.selected_mode === 'handoff' ? ROUTE_BLOCKED : null,
      };

      state.lastRouteTrace = routeTrace;
      await auditRoute(routeTrace);

      const response = buildGatewayResponse({
        status: gatewayOutcome.status,
        page: toGatewayPage(outcome, state, { preferCurrentUrl }),
        continuation: {
          can_continue: gatewayOutcome.canContinue,
          suggested_next_action: gatewayOutcome.suggestedNextAction,
          handoff_state: effectiveHandoff?.state ?? state.handoff?.state ?? 'idle',
        },
        evidence: { strategy: outcome.preflight ?? null },
        runtime: instance ? { instance } : {},
        route: routeTrace,
        ...(routeTrace.error_code ? { error_code: routeTrace.error_code } : {}),
      });
      rememberGatewayTask(state, {
        tool: 'entry',
        status: response.meta?.status ?? gatewayOutcome.status,
        summary: response.meta?.continuation?.suggested_next_action ?? null,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'inspect',
    {
      description: 'Inspect the current gateway page status and handoff state.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage({ state });
      await syncState(page, state, { force: true });
      const instance = await getBrowserInstance();
      const route = getRouteForState({ url: page.url(), state });

      const response = buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: await readStablePageTitle(page),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: getGatewayContinuation(state, 'extract'),
        runtime: instance ? { instance } : {},
        route,
      });
      rememberGatewayTask(state, {
        tool: 'inspect',
        status: response.meta?.status ?? getGatewayStatus(state),
        summary: response.meta?.continuation?.suggested_next_action ?? null,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'extract',
    {
      description: 'Extract a concise summary of the current page content.',
      inputSchema: {
        include_markdown: z.boolean().optional().describe('Include a minimal Markdown rendering of the extracted content'),
      },
    },
    async ({ include_markdown = false } = {}) => {
      const page = await getPage({ state });
      const instance = await getBrowserInstance();
      const selection = selectEngine({ tool: 'extract', url: page.url() });
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });
      const result = await projectPageContent({
        page,
        state,
        selection,
        include_markdown,
        deps: {
          syncState,
          observeContent,
          readFastPathContent,
          waitUntilStable: deps.waitUntilStable,
          extractMainContent: deps.extractMainContent,
        },
      });

      const response = buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: result.title ?? await readStablePageTitle(page),
          url: result.url ?? page.url(),
          pageState: state.pageState,
        }, state),
        result,
        continuation: getGatewayContinuation(state, 'inspect'),
        runtime: instance ? { instance } : {},
        route,
      });
      rememberGatewayTask(state, {
        tool: 'extract',
        status: response.meta?.status ?? getGatewayStatus(state),
        summary: result.summary ?? null,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'extract_structured',
    {
      description: 'Extract the current page into a structured record for the requested fields and return JSON/Markdown exports.',
      inputSchema: {
        fields: z.array(z.string()).min(1).describe('Field labels to extract from the current page into a structured record'),
        include_markdown: z.boolean().optional().describe('Include a Markdown export alongside the JSON export'),
      },
    },
    async ({ fields, include_markdown = false } = {}) => {
      const page = await getPage({ state });
      const instance = await getBrowserInstance();
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });
      const selection = selectEngine({ tool: 'extract_structured', url: page.url() });
      const projection = await projectPageContent({
        page,
        state,
        selection,
        include_markdown,
        deps: {
          syncState,
          observeContent,
          readFastPathContent,
          waitUntilStable: deps.waitUntilStable,
          extractMainContent: deps.extractMainContent,
        },
      });
      const structured = await extractStructured(page, fields);
      const exports = {
        json: JSON.stringify({
          title: projection.title,
          url: projection.url,
          record: structured.record,
          missing_fields: structured.missing_fields,
        }, null, 2),
        ...(projection.markdown !== undefined ? { markdown: projection.markdown } : {}),
      };

      const response = buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: projection.title,
          url: projection.url,
          pageState: state.pageState,
        }, state),
        result: {
          ...projection,
          structured,
          exports,
        },
        continuation: getGatewayContinuation(state, 'inspect'),
        runtime: instance ? { instance } : {},
        route,
      });
      rememberGatewayTask(state, {
        tool: 'extract_structured',
        status: response.meta?.status ?? getGatewayStatus(state),
        summary: structured.missing_fields?.length
          ? `missing:${structured.missing_fields.join(',')}`
          : 'structured_ready',
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'extract_batch',
    {
      description: 'Visit a list of URLs through the runtime loop, extract structured records, and export CSV/JSON/Markdown artifacts.',
      inputSchema: {
        urls: z.array(z.string().url()).min(1).describe('URLs to visit sequentially through the same runtime'),
        fields: z.array(z.string()).min(1).describe('Field labels to extract into structured records and CSV columns'),
        include_markdown: z.boolean().optional().describe('Also write a Markdown bundle alongside the CSV and JSON exports'),
      },
    },
    async ({ urls, fields, include_markdown = false } = {}) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'extract_batch');
      if (confirmationError) return confirmationError;

      const records = [];

      for (const inputUrl of urls) {
        const outcome = await enter({ url: inputUrl, state, deps: { auditName: 'extract_batch' } });
        let page = null;
        try {
          page = await getPage({ state });
        } catch {
          page = null;
        }

        const status = getGatewayStatus(state);
        if (!page || status !== 'direct') {
          records.push({
            input_url: inputUrl,
            final_url: outcome.final_url ?? outcome.url ?? inputUrl,
            status,
            title: outcome.title ?? 'unknown',
            record: {},
            missing_fields: [...fields],
            route: outcome.preflight?.recommended_entry_strategy ?? 'unknown',
          });
          continue;
        }

        const selection = selectEngine({ tool: 'extract_structured', url: page.url() });
        const projection = await projectPageContent({
          page,
          state,
          selection,
          include_markdown,
          deps: {
            syncState,
            observeContent,
            readFastPathContent,
            waitUntilStable: deps.waitUntilStable,
            extractMainContent: deps.extractMainContent,
          },
        });
        const structured = await extractStructured(page, fields);

        records.push({
          input_url: inputUrl,
          final_url: projection.url,
          status,
          title: projection.title,
          record: structured.record,
          missing_fields: structured.missing_fields,
          evidence: structured.evidence,
        });
      }

      const columns = ['input_url', 'final_url', 'status', 'title', ...fields];
      const csvRows = records.map((record) => ({
        input_url: record.input_url,
        final_url: record.final_url,
        status: record.status,
        title: record.title,
        ...Object.fromEntries(fields.map((field) => [field, record.record?.[field] ?? ''])),
      }));
      const csv = serializeCsv(columns, csvRows);
      const json = JSON.stringify({
        fields,
        records,
      }, null, 2);
      const artifacts = {
        csv: await writeArtifact({
          filename: 'batch-extract.csv',
          data: csv,
          encoding: 'utf8',
          mimeType: 'text/csv',
        }),
        json: await writeArtifact({
          filename: 'batch-extract.json',
          data: json,
          encoding: 'utf8',
          mimeType: 'application/json',
        }),
      };

      if (include_markdown) {
        artifacts.markdown = await writeArtifact({
          filename: 'batch-extract.md',
          data: buildBatchMarkdownBundle({ fields, records }),
          encoding: 'utf8',
          mimeType: 'text/markdown',
        });
      }

      const page = await getPage({ state });
      const batchStatus = getBatchStatus(records);
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });

      const response = buildGatewayResponse({
        status: batchStatus,
        page: toGatewayPage({
          title: await readStablePageTitle(page),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        result: {
          fields,
          records,
          artifacts,
        },
        continuation: getGatewayContinuation(state, 'inspect'),
        runtime: instance ? { instance } : {},
        route,
        message: [
          `Status: ${batchStatus}`,
          `Visited URLs: ${urls.length}`,
          `Structured records: ${records.length}`,
          `CSV artifact: ${artifacts.csv.path}`,
          `JSON artifact: ${artifacts.json.path}`,
          ...(artifacts.markdown ? [`Markdown artifact: ${artifacts.markdown.path}`] : []),
          `Next: inspect`,
        ],
      });
      rememberGatewayTask(state, {
        tool: 'extract_batch',
        status: batchStatus,
        summary: `${records.length} records`,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
        artifacts: Object.values(artifacts),
      });
      return response;
    }
  );

  server.registerTool(
    'share_page',
    {
      description: 'Export the current page into a shareable Markdown, screenshot, or PDF artifact.',
      inputSchema: {
        format: z.enum(['markdown', 'screenshot', 'pdf']).describe('Share artifact format to generate from the current page'),
      },
    },
    async ({ format }) => {
      const page = await getPage({ state });
      const instance = await getBrowserInstance();
      const selection = selectEngine({ tool: 'extract', url: page.url() });
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });
      const projection = await projectPageContent({
        page,
        state,
        selection,
        include_markdown: true,
        deps: {
          syncState,
          observeContent,
          readFastPathContent,
          waitUntilStable: deps.waitUntilStable,
          extractMainContent: deps.extractMainContent,
        },
      });
      const explainCard = await buildSafeExplainShareCard(
        buildExplainShareCard,
        buildFallbackExplainShareCard,
        page,
        projection
      );
      let artifactMeta = null;

      if (format === 'markdown') {
        artifactMeta = await writeArtifact({
          filename: 'share-page.md',
          data: buildShareMarkdown({ projection, explainCard }),
          encoding: 'utf8',
          mimeType: 'text/markdown',
        });
      } else {
        const rendered = await renderShareArtifact(page, buildShareHtml({ projection, explainCard }), format);
        artifactMeta = await writeArtifact({
          filename: `share-page.${rendered.extension}`,
          data: rendered.data,
          mimeType: rendered.mimeType,
        });
      }

      const response = buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: projection.title,
          url: projection.url,
          pageState: state.pageState,
        }, state),
        result: {
          projection,
          explain_card: explainCard,
          artifact: {
            format,
            ...artifactMeta,
          },
        },
        continuation: getGatewayContinuation(state, 'inspect'),
        runtime: instance ? { instance } : {},
        route,
      });
      rememberGatewayTask(state, {
        tool: 'share_page',
        status: response.meta?.status ?? getGatewayStatus(state),
        summary: format,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
        artifacts: [artifactMeta],
      });
      return response;
    }
  );

  server.registerTool(
    'explain_share_card',
    {
      description: 'Explain how Grasp would lay out the current page as a share card, using Pretext when available.',
      inputSchema: {
        width: z.number().int().positive().optional().describe('Target card width in pixels'),
      },
    },
    async ({ width = 640 } = {}) => {
      const page = await getPage({ state });
      const instance = await getBrowserInstance();
      const selection = selectEngine({ tool: 'extract', url: page.url() });
      const route = getRouteForState({ url: page.url(), state, intent: 'extract' });
      const projection = await projectPageContent({
        page,
        state,
        selection,
        include_markdown: true,
        deps: {
          syncState,
          observeContent,
          readFastPathContent,
          waitUntilStable: deps.waitUntilStable,
          extractMainContent: deps.extractMainContent,
        },
      });
      const explainCard = await buildSafeExplainShareCard(
        buildExplainShareCard,
        buildFallbackExplainShareCard,
        page,
        projection,
        { width }
      );

      const response = buildGatewayResponse({
        status: getGatewayStatus(state),
        page: toGatewayPage({
          title: projection.title,
          url: projection.url,
          pageState: state.pageState,
        }, state),
        result: {
          projection,
          explain_card: explainCard,
        },
        continuation: getGatewayContinuation(state, 'share_page'),
        runtime: instance ? { instance } : {},
        route,
        message: [
          `Status: ${getGatewayStatus(state)}`,
          `Page: ${projection.title}`,
          `URL: ${projection.url}`,
          `Explain card engine: ${explainCard.engine}`,
          `Estimated height: ${explainCard.estimated_height}px`,
          `Next: share_page`,
        ],
      });
      rememberGatewayTask(state, {
        tool: 'explain_share_card',
        status: response.meta?.status ?? getGatewayStatus(state),
        summary: `${explainCard.engine}:${explainCard.estimated_height}px`,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'continue',
    {
      description: 'Decide the next continuation step without triggering browser actions.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage({ state });
      await syncState(page, state, { force: true });
      const instance = await getBrowserInstance();
      const outcome = await assessGatewayContinuation(page, state);
      const route = getRouteForState({ url: page.url(), state });

      const response = buildGatewayResponse({
        status: outcome.status,
        page: toGatewayPage({
          title: await readStablePageTitle(page),
          url: page.url(),
          pageState: state.pageState,
        }, state),
        continuation: outcome.continuation,
        runtime: instance ? { instance } : {},
        route,
      });
      rememberGatewayTask(state, {
        tool: 'continue',
        status: response.meta?.status ?? outcome.status,
        summary: response.meta?.continuation?.suggested_next_action ?? null,
        route: response.meta?.route ?? null,
        page: response.meta?.page ?? null,
      });
      return response;
    }
  );

  server.registerTool(
    'explain_route',
    {
      description: 'Explain the latest route decision and why Grasp chose it.',
      inputSchema: {},
    },
    async () => {
      const route = state.lastRouteTrace ?? await readLatestRoute();

      if (!route) {
        return textResponse([
          'Route explanation unavailable.',
          'No route decision recorded yet.',
          'Call entry(url, intent) first.',
        ]);
      }

      const fallback = route.fallback_chain?.length
        ? route.fallback_chain.join(' -> ')
        : 'none';
      const triggers = route.evidence?.triggers?.length
        ? route.evidence.triggers.join(', ')
        : 'none';
      const alternatives = route.alternatives?.length
        ? route.alternatives.map((candidate) => `${candidate.mode} (${candidate.reason})`).join('; ')
        : 'none';

      return textResponse([
        'Route explanation',
        `Mode: ${route.selected_mode ?? 'unknown'}`,
        `Template: ${route.policy_template ?? 'unknown'}`,
        `Intent: ${route.intent ?? 'unknown'}`,
        `Status: ${route.status ?? 'unknown'}`,
        `Confidence: ${route.confidence ?? 'unknown'}`,
        `Risk: ${route.risk_level ?? 'unknown'}`,
        `Requires human: ${route.requires_human ? 'yes' : 'no'}`,
        `Next: ${route.next_step ?? 'unknown'}`,
        `Fallback: ${fallback}`,
        `Alternatives: ${alternatives}`,
        `Failure type: ${route.failure_type ?? 'none'}`,
        `Evidence: ${triggers}`,
      ], { route });
    }
  );
}
