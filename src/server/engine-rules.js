const DEFAULT_RUNTIME_RULES = [
  {
    engine: 'runtime',
    hosts: [
      'bosszhipin.com',
      '*.bosszhipin.com',
      'zhipin.com',
      '*.zhipin.com',
      'mp.weixin.qq.com',
      '*.mp.weixin.qq.com',
      'xiaohongshu.com',
      '*.xiaohongshu.com',
      'xhslink.com',
      '*.xhslink.com',
    ],
  },
];

function normalizeHostname(url) {
  try {
    return new URL(String(url ?? '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchesHostPattern(hostname, pattern) {
  const normalizedPattern = String(pattern ?? '').toLowerCase().trim();
  if (!hostname || !normalizedPattern) return false;
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === normalizedPattern;
}

export function createEngineRuleSet(rules = DEFAULT_RUNTIME_RULES) {
  const normalizedRules = Array.isArray(rules) ? rules : [];
  return {
    resolve(url) {
      const hostname = normalizeHostname(url);
      for (const rule of normalizedRules) {
        const hosts = Array.isArray(rule?.hosts) ? rule.hosts : [];
        if (hosts.some((pattern) => matchesHostPattern(hostname, pattern))) {
          return rule.engine ?? 'data';
        }
      }
      return 'data';
    },
    rules: normalizedRules,
  };
}

export { DEFAULT_RUNTIME_RULES, normalizeHostname, matchesHostPattern };
