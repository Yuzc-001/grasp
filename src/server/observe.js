import { extractMainContent, waitUntilStable } from './content.js';
import { rankAffordances } from './affordances.js';
import { syncPageState } from './state.js';

export async function observeSearchSnapshot({ page, state, query, frame, deps = {} }) {
  const waitStable = deps.waitStable ?? waitUntilStable;
  const extractContent = deps.extractContent ?? extractMainContent;
  await waitStable(page, { stableChecks: 2, interval: 150, timeout: 2500 });
  await syncPageState(page, state, { force: true });
  const hints = state.hintMap.map((hint) => ({ ...hint }));
  const ranking = rankAffordances({ hints });
  const searchIds = new Set(ranking.search_input.map((hint) => hint.id));
  const annotatedHints = hints.map((hint) => ({
    ...hint,
    semantic: searchIds.has(hint.id)
      ? 'search_input'
      : hint.type === 'button'
        ? 'submit_control'
        : 'candidate',
  }));
  const content = await extractContent(page);
  const domRevision = state.pageState?.domRevision ?? 0;
  const submitCandidate = ranking.command_button?.[0] ?? null;
  return {
    query,
    title: await page.title(),
    url: page.url(),
    hints: annotatedHints,
    ranking,
    content,
    domRevision,
    submitCandidate,
    frameId: frame?.taskId ?? null,
  };
}
