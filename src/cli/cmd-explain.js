import { readLatestRouteDecision } from '../server/audit.js';

export function formatRouteExplanation(route) {
  if (!route) {
    return [
      '',
      '  No route decision recorded yet.',
      '  Run entry(url, intent) first, then ask Grasp to explain the route.',
      '',
    ];
  }

  const fallback = route.fallback_chain?.length
    ? route.fallback_chain.join(' -> ')
    : 'none';
  const triggers = route.evidence?.triggers?.length
    ? route.evidence.triggers.join(', ')
    : 'none';

  return [
    '',
    '  Grasp Route Explanation',
    `  ${'─'.repeat(44)}`,
    `  URL        ${route.url ?? 'unknown'}`,
    `  Intent     ${route.intent ?? 'unknown'}`,
    `  Status     ${route.status ?? 'unknown'}`,
    `  Mode       ${route.selected_mode ?? 'unknown'}`,
    `  Confidence ${route.confidence ?? 'unknown'}`,
    `  Risk       ${route.risk_level ?? 'unknown'}`,
    `  Human      ${route.requires_human ? 'yes' : 'no'}`,
    `  Next       ${route.next_step ?? 'unknown'}`,
    `  Fallback   ${fallback}`,
    `  Failure    ${route.failure_type ?? 'none'}`,
    `  Because    ${triggers}`,
    '',
  ];
}

export async function runExplain() {
  const route = await readLatestRouteDecision();
  formatRouteExplanation(route).forEach((line) => console.log(line));
}
