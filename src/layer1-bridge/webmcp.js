/**
 * Layer 1 WebMCP 适配层
 * 每次 navigate 后自动探测页面是否支持 WebMCP：
 *   - 命中 → 走原生工具通道（零 DOM 解析）
 *   - 未命中 → 静默降级到 CDP 模式
 */

/**
 * 探测页面是否支持 WebMCP。
 * 两步探测，总开销 < 50ms。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<WebMCPInfo>}
 *
 * @typedef {{ available: true, source: 'window' | 'well-known', endpoint: string, tools: any[] } | { available: false }} WebMCPInfo
 */
export async function probe(page) {
  // Step 1（~1ms）：检测 window 对象上的 WebMCP 标记
  try {
    const windowResult = await page.evaluate(() => {
      // 检测 window.__webmcp__
      if (typeof window.__webmcp__ !== 'undefined') {
        return {
          found: true,
          source: 'window',
          endpoint: window.__webmcp__?.endpoint ?? window.location.origin,
        };
      }
      // 检测 window.MCP
      if (typeof window.MCP !== 'undefined') {
        return {
          found: true,
          source: 'window',
          endpoint: window.MCP?.endpoint ?? window.location.origin,
        };
      }
      // 检测 <meta name="mcp-endpoint">
      const meta = document.querySelector('meta[name="mcp-endpoint"]');
      if (meta) {
        return {
          found: true,
          source: 'window',
          endpoint: meta.getAttribute('content') ?? window.location.origin,
        };
      }
      return { found: false };
    });

    if (windowResult.found) {
      return {
        available: true,
        source: 'window',
        endpoint: windowResult.endpoint,
        tools: [],
      };
    }
  } catch {
    // 静默捕获，继续 Step 2
  }

  // Step 2（~50ms 上限）：尝试 well-known 端点
  try {
    const wellKnownResult = await page.evaluate(async () => {
      const url = `${window.location.origin}/.well-known/mcp`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return { found: false };
      const data = await response.json();
      return { found: true, url, tools: data.tools ?? [] };
    });

    if (wellKnownResult.found) {
      return {
        available: true,
        source: 'well-known',
        endpoint: wellKnownResult.url,
        tools: wellKnownResult.tools,
      };
    }
  } catch {
    // 静默捕获
  }

  return { available: false };
}

/**
 * 列出当前页面可用的 WebMCP 工具。
 *
 * @param {import('playwright').Page} page
 * @param {WebMCPInfo} info
 * @returns {Promise<any[]>}
 */
export async function listTools(page, info) {
  if (!info.available) return [];

  try {
    if (info.source === 'window') {
      return await page.evaluate(() => {
        return window.__webmcp__?.tools ?? window.MCP?.tools ?? [];
      });
    }

    if (info.source === 'well-known') {
      return info.tools ?? [];
    }
  } catch {
    // 静默捕获
  }

  return [];
}

/**
 * 调用指定的 WebMCP 工具。
 *
 * @param {import('playwright').Page} page
 * @param {WebMCPInfo} info
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {Promise<any>}
 */
export async function callTool(page, info, toolName, args = {}) {
  if (!info.available) {
    throw new Error('WebMCP not available on this page');
  }

  if (info.source === 'well-known') {
    throw new Error('WebMCP call is not supported for well-known source. The page does not expose a window call function.');
  }

  const result = await page.evaluate(
    async ({ toolName, args }) => {
      const callFn = window.__webmcp__?.call ?? window.MCP?.call;
      if (!callFn) return { __error: 'WebMCP call function not found' };
      return callFn(toolName, args);
    },
    { toolName, args },
  );
  if (result?.__error) throw new Error(result.__error);
  return result;
}
