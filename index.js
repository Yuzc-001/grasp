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

const [cmd, ...rest] = process.argv.slice(2);

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

} else if (cmd === '--version' || cmd === '-v') {
  const { SERVER_INFO } = await import('./src/server/index.js');
  console.log(SERVER_INFO.version);

} else if (cmd === '--help' || cmd === '-h') {
  printHelp();

}

function printHelp() {
  console.log(`
  Grasp — Your browser. AI's hands.

  Usage:
    grasp                  First-time setup wizard (detect Chrome, print AI client config)
    grasp connect          Same as above
    grasp status           Show Chrome connection and recent activity
    grasp logs             Show recent audit log
      --lines N            Number of lines to show (default: 50)
      --follow, -f         Stream new entries in real-time
    grasp --version        Print version
    grasp --help           Print this help

  Quick start:
    npx grasp              Run setup wizard, get your AI client config
`);
}
