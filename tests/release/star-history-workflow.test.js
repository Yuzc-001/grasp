import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const workflowPath = new URL('../../.github/workflows/update-star-history.yml', import.meta.url);
const scriptPath = new URL('../../scripts/update-star-history.mjs', import.meta.url);
const dataPath = new URL('../../star-history-data.json', import.meta.url);
const englishReadmePath = new URL('../../README.md', import.meta.url);
const chineseReadmePath = new URL('../../README.zh-CN.md', import.meta.url);

test('star history workflow refreshes the local svg every 12 hours and on demand', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron:\s*'0 \*\/12 \* \* \*'/);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node scripts\/update-star-history\.mjs/);
  assert.match(workflow, /STAR_HISTORY_TOKEN/);
  assert.match(workflow, /git add star-history\.svg star-history-data\.json/);
  assert.match(workflow, /git commit -m "chore: update star history svg"/);
  assert.match(workflow, /git push/);
  assert.doesNotMatch(workflow, /api\.star-history\.com/);
});

test('star history script supports public snapshot fallback', () => {
  const script = readFileSync(scriptPath, 'utf8');

  assert.match(script, /STAR_HISTORY_TOKEN/);
  assert.match(script, /stargazers_count/);
  assert.match(script, /star-history-data\.json/);
  assert.match(script, /public-snapshot/);
  assert.match(script, /isAccessRestrictedError/);
});

test('readmes point star history at the tracked local svg artifact', () => {
  const englishReadme = readFileSync(englishReadmePath, 'utf8');
  const chineseReadme = readFileSync(chineseReadmePath, 'utf8');

  assert.match(englishReadme, /\[!\[Star History Chart\]\(\.\/star-history\.svg\)\]\(https:\/\/www\.star-history\.com\/#Yuzc-001\/grasp&Date\)/);
  assert.match(chineseReadme, /\[!\[Star History Chart\]\(\.\/star-history\.svg\)\]\(https:\/\/www\.star-history\.com\/#Yuzc-001\/grasp&Date\)/);
});

test('star history assets exist in the repository', () => {
  const svgPath = new URL('../../star-history.svg', import.meta.url);

  assert.equal(existsSync(scriptPath), true);
  assert.equal(existsSync(svgPath), true);
  assert.equal(existsSync(dataPath), true);

  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const series = Array.isArray(data) ? data : data.series;
  assert.ok(Array.isArray(series) && series.length > 0);
  assert.ok(Number.isFinite(series.at(-1).count));
});
