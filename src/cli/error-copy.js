function formatListSection(title, items = []) {
  if (!items.length) return '';
  return [
    `  ${title}`,
    ...items.map((item) => `    - ${item}`),
  ].join('\n');
}

export function formatErrorCopy({ whatHappened, tried = [], nextSteps = [] }) {
  const sections = [
    '',
    '  What happened',
    `    ${whatHappened}`,
  ];

  const triedSection = formatListSection('What Grasp already tried', tried);
  if (triedSection) sections.push('', triedSection);

  const nextSection = formatListSection('What you should do next', nextSteps);
  if (nextSection) sections.push('', nextSection);

  return sections.join('\n');
}
