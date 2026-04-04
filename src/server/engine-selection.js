import { createEngineRuleSet, DEFAULT_RUNTIME_RULES } from './engine-rules.js';

const defaultRuleSet = createEngineRuleSet(DEFAULT_RUNTIME_RULES);

export function selectEngine({ tool, url, rules = null } = {}) {
  const ruleSet = rules ? createEngineRuleSet(rules) : defaultRuleSet;
  return {
    tool: tool ?? 'extract',
    engine: ruleSet.resolve(url),
  };
}
