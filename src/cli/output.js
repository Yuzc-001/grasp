import { formatErrorCopy } from './error-copy.js';

const STEP_LABELS = {
  ok: '[ok]',
  wait: '[..]',
  fail: '[!!]',
};

export function formatBanner(title, subtitle = '') {
  const lines = [
    '',
    `  ${title}`,
    `  ${'─'.repeat(44)}`,
  ];

  if (subtitle) {
    lines.push(`  ${subtitle}`);
  }

  return lines.join('\n');
}

export function formatStep(kind, message, detail) {
  const label = STEP_LABELS[kind] ?? STEP_LABELS.wait;
  const lines = [`  ${label} ${message}`];

  if (detail) {
    lines.push(`       ${detail}`);
  }

  return lines.join('\n');
}

export function formatListSection(title, items = []) {
  if (!items.length) return '';
  return [
    `  ${title}`,
    ...items.map((item) => `    - ${item}`),
  ].join('\n');
}

export function printBlock(text = '') {
  console.log(text);
}

export { formatErrorCopy };
