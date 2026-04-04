import test from 'node:test';
import assert from 'node:assert/strict';

import { selectEngine } from '../../src/server/engine-selection.js';

import { createEngineRuleSet, matchesHostPattern } from '../../src/server/engine-rules.js';


test('selectEngine uses data engine for ordinary public-web extract reads', () => {
  assert.equal(
    selectEngine({ tool: 'extract', url: 'https://example.com/blog' }).engine,
    'data'
  );
});

test('selectEngine keeps runtime engine for authenticated runtime sites', () => {
  assert.equal(
    selectEngine({ tool: 'extract', url: 'https://mp.weixin.qq.com/' }).engine,
    'runtime'
  );
});

test('selectEngine keeps get_page_summary on the same narrow metadata seam', () => {
  assert.equal(
    selectEngine({ tool: 'get_page_summary', url: 'https://www.zhipin.com/web/geek/chat' }).engine,
    'runtime'
  );
});

test('engine rules support wildcard matching and custom overrides', () => {
  assert.equal(matchesHostPattern('sub.example.com', '*.example.com'), true);
  assert.equal(matchesHostPattern('example.com', '*.example.com'), true);

  const customRules = [
    { engine: 'runtime', hosts: ['internal.example.com', '*.corp.local'] },
  ];
  const ruleSet = createEngineRuleSet(customRules);

  assert.equal(ruleSet.resolve('https://internal.example.com/dashboard'), 'runtime');
  assert.equal(ruleSet.resolve('https://api.corp.local/health'), 'runtime');
  assert.equal(selectEngine({ tool: 'extract', url: 'https://example.com', rules: customRules }).engine, 'data');
});
