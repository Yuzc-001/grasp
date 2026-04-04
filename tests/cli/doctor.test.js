import test from 'node:test';
import assert from 'node:assert/strict';

import { renderHelpText } from '../../index.js';

test('renderHelpText registers the doctor command and dedicated runtime model', () => {
  const help = renderHelpText();

  assert.match(help, /grasp doctor\s+Diagnose the dedicated browser runtime/i);
  assert.match(help, /dedicated chrome-grasp profile/i);
  assert.match(help, /not a browser extension and does not take over arbitrary windows/i);
});
