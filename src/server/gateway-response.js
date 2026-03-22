import { textResponse } from './responses.js';

export function buildGatewayResponse({
  status,
  page,
  result = {},
  continuation = {},
  evidence = {},
  message,
}) {
  const lines = [
    `Status: ${status}`,
    `Page: ${page?.title ?? 'unknown'}`,
    `URL: ${page?.url ?? 'unknown'}`,
    result.summary ? `Summary: ${result.summary}` : null,
    continuation.suggested_next_action ? `Next: ${continuation.suggested_next_action}` : null,
  ].filter(Boolean);

  return textResponse(message ?? lines, {
    status,
    page,
    result,
    continuation,
    evidence,
  });
}
