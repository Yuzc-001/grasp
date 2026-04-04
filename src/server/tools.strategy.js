import { z } from 'zod';

import { getActivePage, navigateTo, pinTargetPage, readStablePageTitle, trustedContextOpen } from '../layer1-bridge/chrome.js';
import { textResponse } from './responses.js';
import { syncPageState } from './state.js';
import { audit } from './audit.js';
import { requestHandoff } from '../grasp/handoff/events.js';
import { attachHandoffTaskMetadata, readHandoffState, writeHandoffState } from '../grasp/handoff/persist.js';
import { buildCheckpointHandoffSuggestion, buildSessionTrustPreflight } from './continuity.js';
import { createEntryOrchestrator } from './entry-orchestrator.js';
import { readBrowserInstance } from '../runtime/browser-instance.js';
import { requireConfirmedRuntimeInstance } from './runtime-confirmation.js';

function getEntryStrategies(preflight) {
  if (preflight.recommended_entry_strategy === 'resume_existing_session') {
    return ['trusted_context_open', 'direct_goto'];
  }

  if (preflight.recommended_entry_strategy === 'preheat_before_direct_entry') {
    return ['trusted_context_open', 'direct_goto'];
  }

  return ['direct_goto'];
}

export async function enterWithStrategy({ url, state, deps = {} }) {
  const getActivePageFn = deps.getActivePage ?? getActivePage;
  const directGoto = deps.directGoto ?? deps.navigateTo ?? navigateTo;
  const trustedContextOpenFn = deps.trustedContextOpen ?? trustedContextOpen;
  const syncState = deps.syncPageState ?? syncPageState;
  const readHandoff = deps.readHandoffState ?? readHandoffState;
  const auditFn = deps.audit ?? audit;
  const auditName = deps.auditName ?? 'navigate_with_strategy';

  const handoff = await readHandoff();
  let pageState = state.pageState ?? {};

  try {
    const activePage = await getActivePageFn({ state });
    await syncState(activePage, state);
    pageState = state.pageState ?? {};
  } catch {
    // allow strategy selection even before first active page is available
  }

  const preflight = buildSessionTrustPreflight(url, pageState, handoff);

  if (preflight.recommended_entry_strategy === 'handoff_or_preheat') {
    return { url, title: null, preflight, pageState, handoff };
  }

  const orchestrator = createEntryOrchestrator({
    directGoto,
    trustedContextOpen: trustedContextOpenFn,
  });
  const entry = await orchestrator.run({
    targetUrl: url,
    strategies: getEntryStrategies(preflight),
    state,
  });

  const page = entry.page;
  if (page) {
    await syncState(page, state, { force: true });
    await pinTargetPage(page, state);
  }
  await auditFn(auditName, `${entry.entry_method ?? preflight.recommended_entry_strategy} :: ${url}`);

  return {
    url,
    title: page ? await readStablePageTitle(page) : null,
    preflight,
    pageState: state.pageState ?? pageState,
    handoff,
    entry_method: entry.entry_method,
    final_url: entry.final_url,
    verified: entry.verified,
    evidence: entry.evidence,
  };
}

export function registerStrategyTools(server, state, deps = {}) {
  const getPage = deps.getActivePage ?? getActivePage;
  const getBrowserInstance = deps.getBrowserInstance ?? (() => readBrowserInstance(process.env.CHROME_CDP_URL || 'http://localhost:9222'));

  server.registerTool(
    'preheat_session',
    {
      description: 'Warm up a target host before direct entry by visiting the origin and waiting for page state to settle.',
      inputSchema: {
        url: z.string().url().describe('Target URL whose host should be preheated'),
      },
    },
    async ({ url }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'preheat_session');
      if (confirmationError) return confirmationError;
      let origin = url;
      try {
        const parsed = new URL(url);
        origin = `${parsed.protocol}//${parsed.host}/`;
      } catch {}

      const page = await navigateTo(origin);
      await syncPageState(page, state, { force: true });
      await audit('preheat_session', origin);

      return textResponse([
        `Preheated host: ${origin}`,
        `Current page: ${await readStablePageTitle(page) ?? 'unknown'}`,
        `Page role: ${state.pageState?.currentRole ?? 'unknown'}`,
        `Risk gate detected: ${state.pageState?.riskGateDetected ? 'yes' : 'no'}`,
        `Suggested next action: ${state.pageState?.suggestedNextAction ?? 'none'}`,
      ], { origin, pageState: state.pageState });
    }
  );

  server.registerTool(
    'navigate_with_strategy',
    {
      description: 'Run session trust preflight before navigation and apply the recommended entry strategy.',
      inputSchema: {
        url: z.string().url().describe('Target URL to open'),
      },
    },
    async ({ url }) => {
      const instance = await getBrowserInstance();
      const confirmationError = requireConfirmedRuntimeInstance(state, instance, 'navigate_with_strategy');
      if (confirmationError) return confirmationError;
      const outcome = await enterWithStrategy({ url, state });
      const { preflight, handoff, pageState } = outcome;

      if (preflight.recommended_entry_strategy === 'handoff_or_preheat') {
        const checkpointSuggestion = pageState.currentRole === 'checkpoint'
          ? buildCheckpointHandoffSuggestion(pageState, url)
          : null;
        return textResponse([
          `Navigation strategy: ${preflight.recommended_entry_strategy}`,
          `Session trust: ${preflight.session_trust}`,
          'Direct navigation is not recommended right now.',
          checkpointSuggestion
            ? `Suggested next step: request_handoff_from_checkpoint (${checkpointSuggestion.reason})`
            : 'Suggested next step: run preheat_session or enter the handoff path.',
        ], { preflight, handoff, pageState, checkpointSuggestion });
      }

      const extra = preflight.recommended_entry_strategy === 'preheat_before_direct_entry'
        ? 'Preheat recommended: this host looks high-risk for a cold direct entry.'
        : 'Direct navigation accepted.';

      return textResponse([
        `Navigation strategy: ${preflight.recommended_entry_strategy}`,
        `Session trust: ${preflight.session_trust}`,
        `Navigated to: ${url}`,
        `Page title: ${outcome.title ?? 'unknown'}`,
        `Entry method: ${outcome.entry_method ?? 'unknown'}`,
        `Verified: ${outcome.verified ? 'yes' : 'no'}`,
        extra,
      ], {
        preflight,
        pageState: state.pageState,
        entry_method: outcome.entry_method ?? null,
        final_url: outcome.final_url ?? null,
        verified: outcome.verified ?? false,
        evidence: outcome.evidence ?? null,
      });
    }
  );

  server.registerTool(
    'session_trust_preflight',
    {
      description: 'Estimate session trust and recommended entry strategy before or during navigation to a high-friction site.',
      inputSchema: {
        url: z.string().url().describe('Target URL to evaluate'),
      },
    },
    async ({ url }) => {
      let pageState = state.pageState ?? {};
      try {
        const page = await getPage({ state });
        await syncPageState(page, state);
        pageState = state.pageState ?? {};
      } catch {
        // allow preflight without active page
      }
      const handoff = await readHandoffState();
      const preflight = buildSessionTrustPreflight(url, pageState, handoff);
      return textResponse([
        `Target: ${preflight.target_url}`,
        `Session trust: ${preflight.session_trust}`,
        `Recommended entry strategy: ${preflight.recommended_entry_strategy}`,
        `Same target context: ${preflight.same_target_context ? 'yes' : 'no'}`,
        `Checkpoint active: ${preflight.checkpoint_active ? 'yes' : 'no'}`,
        ...(preflight.trust_signals.length ? [`Trust signals: ${preflight.trust_signals.join(', ')}`] : []),
      ], { preflight, handoff, pageState });
    }
  );

  server.registerTool(
    'suggest_handoff',
    {
      description: 'Suggest a handoff payload based on the current page state, especially for checkpoint/gated pages.',
      inputSchema: {},
    },
    async () => {
      const page = await getPage({ state });
      await syncPageState(page, state, { force: true });
      const suggestion = buildCheckpointHandoffSuggestion(state.pageState, page.url());
      return textResponse([
        `Suggested reason: ${suggestion.reason}`,
        `Suggested next action: ${suggestion.suggested_next_action}`,
        `Checkpoint kind: ${suggestion.checkpoint_kind}`,
        ...(suggestion.checkpoint_signals?.length ? [`Checkpoint signals: ${suggestion.checkpoint_signals.join(', ')}`] : []),
        `Note: ${suggestion.note}`,
      ], { suggestion, pageState: state.pageState });
    }
  );

  server.registerTool(
    'request_handoff_from_checkpoint',
    {
      description: 'Create and persist a handoff directly from the current checkpoint/gated page state.',
      inputSchema: {
        note: z.string().optional().describe('Optional override note for the generated checkpoint handoff'),
      },
    },
    async ({ note } = {}) => {
      const page = await getPage({ state });
      await syncPageState(page, state, { force: true });
      const suggestion = buildCheckpointHandoffSuggestion(state.pageState, page.url());
      state.handoff = attachHandoffTaskMetadata(requestHandoff(await readHandoffState(), suggestion.reason, note ?? suggestion.note, {
        expected_url_contains: suggestion.expected_url_contains,
        expected_page_role: suggestion.expected_page_role,
        expected_selector: suggestion.expected_selector,
        continuation_goal: suggestion.continuation_goal,
        expected_hint_label: suggestion.expected_hint_label,
      }), state);
      await writeHandoffState(state.handoff);
      await audit('handoff_request_from_checkpoint', `${suggestion.reason}${note ? ` :: ${note}` : ''}`);
      return textResponse([
        `Checkpoint handoff requested: ${suggestion.reason}`,
        `Checkpoint kind: ${suggestion.checkpoint_kind}`,
        `Suggested next action: ${suggestion.suggested_next_action}`,
        `State: handoff_required`,
        `Note: ${note ?? suggestion.note}`,
      ], { handoff: state.handoff, suggestion, pageState: state.pageState });
    }
  );
}
