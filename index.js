#!/usr/bin/env node

/**

 * Grasp CLI entry point

 *

 *   grasp              — start MCP server (for Claude Desktop / Cursor)

 *   grasp status       — show Chrome connection status

 *   grasp doctor       — diagnose the dedicated browser runtime

 *   grasp tasks        — summarize recent tracked task activity

 *   grasp artifacts    — list recent exported artifacts

 *   grasp logs         — show audit log  (--lines N, --follow)

 *   grasp --version    — print version

 *   grasp --help       — print help

 */



import { pathToFileURL } from 'node:url';

import { formatBanner, printBlock } from './src/cli/output.js';


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

  } else if (cmd === 'doctor') {

    const { runDoctor } = await import('./src/cli/cmd-doctor.js');

    await runDoctor();

  } else if (cmd === 'tasks') {

    const { runTasks } = await import('./src/cli/cmd-tasks.js');
    await runTasks(rest);
  } else if (cmd === 'artifacts') {
    const { runArtifacts } = await import('./src/cli/cmd-artifacts.js');
    await runArtifacts(rest);
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
  Connect Chrome once. Let agents work inside a visible browser runtime, extract structured results, and resume real pages.

  Usage:
    grasp                  Bootstrap the runtime and connect Chrome for first use
    grasp connect          Same as above
    grasp status           Show runtime state, current page, and recent activity
    grasp doctor           Diagnose the dedicated browser runtime and first-run setup
    grasp tasks            Summarize recent tracked task activity from the audit log
    grasp artifacts        List recent exported artifacts for download/reuse
    grasp logs             Show recent audit log
      --lines N            Number of lines to show (default: 50)
      --follow, -f         Stream new entries in real-time
    grasp explain          Explain the latest route decision
    grasp --version        Print version
    grasp --help           Print this help

  Runtime model:
    Grasp uses its own dedicated chrome-grasp profile for agent work.
    It is not a browser extension and does not take over arbitrary windows you already have open.
    Log in once inside that dedicated browser, then your agent can keep using the same runtime later.

  First runtime steps:
    1. npx -y @yuzc-001/grasp  Bootstrap the runtime and connect your AI client
    2. Open any real page      Keep using the dedicated chrome-grasp profile
                               This runtime profile is separate from arbitrary browser windows you may already have open
    3. Ask your AI             Call get_status / entry(url, intent) / inspect / extract or continue / explain_route
                               Use extract_structured(fields=[...]) or extract_batch(urls=[...], fields=[...]) for structured exports
                               Use share_page(format="markdown" | "screenshot" | "pdf") when the result needs a shareable artifact
    4. Review outputs          Use grasp doctor / grasp status / grasp tasks / grasp artifacts / grasp logs for setup checks, task state, downloads, and audit evidence
`;
}

export function printHelp() {
  printBlock(formatBanner('Grasp CLI Help', 'Connect once, then keep working in the dedicated browser runtime.'));
  console.log(renderHelpText());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
