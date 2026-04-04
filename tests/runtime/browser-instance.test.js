import test from 'node:test';
import assert from 'node:assert/strict';

import { inferBrowserInstance, requireVisibleBrowserInstance } from '../../src/runtime/browser-instance.js';

test('inferBrowserInstance marks HeadlessChrome endpoints as headless', () => {
  const instance = inferBrowserInstance({
    Browser: 'HeadlessChrome/136.0.7103.114',
    'Protocol-Version': '1.3',
  });

  assert.deepEqual(instance, {
    browser: 'HeadlessChrome/136.0.7103.114',
    protocolVersion: '1.3',
    headless: true,
    display: 'headless',
    warning: 'Current endpoint is a headless browser, not a visible local browser window.',
  });
});

test('inferBrowserInstance marks Chrome endpoints as windowed instead of visible-local', () => {
  const instance = inferBrowserInstance({
    Browser: 'Chrome/136.0.7103.114',
    'Protocol-Version': '1.3',
  });

  assert.deepEqual(instance, {
    browser: 'Chrome/136.0.7103.114',
    protocolVersion: '1.3',
    headless: false,
    display: 'windowed',
    warning: null,
  });
});

test('requireVisibleBrowserInstance returns an error for headless endpoints', () => {
  const message = requireVisibleBrowserInstance({
    browser: 'HeadlessChrome/136.0.7103.114',
    protocolVersion: '1.3',
    headless: true,
    display: 'headless',
    warning: 'Current endpoint is a headless browser, not a visible local browser window.',
  }, 'real browser check');

  assert.match(message, /real browser check requires a visible local browser window/i);
  assert.match(message, /HeadlessChrome\/136\.0\.7103\.114/);
});

test('requireVisibleBrowserInstance accepts windowed endpoints', () => {
  const message = requireVisibleBrowserInstance({
    browser: 'Chrome/136.0.7103.114',
    protocolVersion: '1.3',
    headless: false,
    display: 'windowed',
    warning: null,
  }, 'real browser check');

  assert.equal(message, null);
});

test('inferBrowserInstance recognizes visible Edge and headless Edge endpoints', () => {
  const edge = inferBrowserInstance({
    Browser: 'Edg/136.0.3240.76',
    'Protocol-Version': '1.3',
  });
  const headlessEdge = inferBrowserInstance({
    Browser: 'HeadlessEdg/136.0.3240.76',
    'Protocol-Version': '1.3',
  });

  assert.equal(edge.headless, false);
  assert.equal(edge.display, 'windowed');
  assert.equal(edge.warning, null);

  assert.equal(headlessEdge.headless, true);
  assert.equal(headlessEdge.display, 'headless');
  assert.match(headlessEdge.warning, /headless browser/i);
});
