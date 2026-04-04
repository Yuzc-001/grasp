import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRuntimeConfirmationSummary,
  isRuntimeInstanceConfirmed,
  storeRuntimeConfirmation,
} from '../../src/server/runtime-confirmation.js';

test('storeRuntimeConfirmation returns null and leaves state untouched when instance is unavailable', () => {
  const state = {};

  const confirmation = storeRuntimeConfirmation(state, null);

  assert.equal(confirmation, null);
  assert.equal(state.runtimeConfirmation, undefined);
});

test('storeRuntimeConfirmation persists an instance key when runtime metadata exists', () => {
  const state = {};
  const instance = {
    browser: 'Chrome/146.0.7680.177',
    protocolVersion: '1.3',
    display: 'windowed',
    headless: false,
    warning: null,
  };

  const confirmation = storeRuntimeConfirmation(state, instance);

  assert.equal(confirmation.display, 'windowed');
  assert.equal(confirmation.instance_key, 'windowed|Chrome/146.0.7680.177|1.3');
  assert.equal(state.runtimeConfirmation, confirmation);
  assert.equal(isRuntimeInstanceConfirmed(state, instance), true);
});

test('getRuntimeConfirmationSummary reports instance_unavailable without crashing after a prior confirmation', () => {
  const state = {};
  const instance = {
    browser: 'Chrome/146.0.7680.177',
    protocolVersion: '1.3',
    display: 'windowed',
    headless: false,
    warning: null,
  };
  storeRuntimeConfirmation(state, instance);

  const summary = getRuntimeConfirmationSummary(state, null);

  assert.deepEqual(summary, {
    confirmed: false,
    reason: 'instance_unavailable',
    confirmation: state.runtimeConfirmation,
  });
});
