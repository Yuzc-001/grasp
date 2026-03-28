#!/usr/bin/env node
/**
 * Grasp CLI entry point
 *
 *   grasp              — start MCP server (for Claude Desktop / Cursor)
 *   grasp status       — show Chrome connection status
 *   grasp logs         — show audit log  (--lines N, --follow)
 *   grasp --version    — print version
 *   grasp --help       — print help
 */

import { pathToFileURL } from 'node:url';

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;

  if (cmd === 'connect' || cmd === undefined) {
    // 'connect' = explicit setup wizard
    // no args = also run connect when called by human (not piped to MCP)
    const isMcpMode = !process.stdin.isTTY && cmd === undefined;
    if (isMcpMode) {
      // stdin is a pipe — AI client is calling us, start MCP server
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      const { createGraspServer, SERVER_INFO } = await import('./src/server/index.js');
      try {
        const { server } = createGraspServer();
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error(`[Grasp] MCP Server v${SERVER_INFO.version} started.`);
      } catch (err) {
        console.error(`[Grasp] Failed to start MCP server: ${err.message}`);
        process.exit(1);
      }
    } else {
      const { runConnect } = await import('./src/cli/cmd-connect.js');
      await runConnect();
    }
  } else if (cmd === 'status') {
    const { runStatus } = await import('./src/cli/cmd-status.js');
    await runStatus();
  } else if (cmd === 'logs') {
    const { runLogs } = await import('./src/cli/cmd-logs.js');
    await runLogs(rest);
  } else if (cmd === 'explain') {
    const { runExplain } = await import('./src/cli/cmd-explain.js');
    await runExplain();
  } else if (cmd === '--version' || cmd === '-v') {
    const { SERVER_INFO } = await import('./src/server/index.js');
    console.log(SERVER_INFO.version);
  } else if (cmd === '--help' || cmd === '-h') {
    printHelp();
  }
}

export function renderHelpText() {
  return `
  Grasp — route-aware Agent Web Runtime
  Connect Chrome once. Let agents choose a route, verify, hand off, and resume real pages.

  Usage:
    grasp                  Bootstrap the runtime and connect Chrome for first use
    grasp connect          Same as above
    grasp status           Show runtime state, current page, and recent activity
    grasp logs             Show recent audit log
      --lines N            Number of lines to show (default: 50)
      --follow, -f         Stream new entries in real-time
    grasp explain          Explain the latest route decision
    grasp --version        Print version
    grasp --help           Print this help

  First runtime steps:
    1. npx grasp           Bootstrap the runtime and connect your AI client
    2. Open any real page  Keep using the dedicated chrome-grasp profile
    3. Ask your AI         Call get_status / entry(url, intent) / inspect / extract or continue / explain_route
`;
}

export function printHelp() {
  console.log(renderHelpText());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
