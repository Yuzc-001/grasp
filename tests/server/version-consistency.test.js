import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SERVER_INFO } from '../../src/server/index.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

function readProjectFile(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('SERVER_INFO version matches package.json version', () => {
  assert.strictEqual(SERVER_INFO.version, packageJson.version);
});

test('release surface files consistently reference v0.6.7', () => {
  const readme = readProjectFile('README.md');
  const docsReadme = readProjectFile('docs/README.md');
  const changelog = readProjectFile('CHANGELOG.md');

  assert.match(readme, /version-v0\.6\.7/);
  assert.match(readme, /Current package release: `v0\.6\.7`/);

  assert.match(docsReadme, /Current package release: `v0\.6\.7`/);
  assert.match(docsReadme, /v0\.6\.7 release notes/);

  assert.match(changelog, /## v0\.6\.7 — /);
});

test('release candidate surface mentions supported clients and dedicated runtime messaging', () => {
  const docsReadme = readProjectFile('docs/README.md');
  const landing = readProjectFile('docs/browser-runtime-landing.html');
  const releaseNotes = readProjectFile('docs/release-notes-v0.6.7.md');

  assert.match(docsReadme, /Alma/);
  assert.match(landing, /Chrome \/ Edge/);
  assert.match(landing, /chrome-grasp/);
  assert.match(releaseNotes, /Edge endpoints are now classified correctly/i);
});
