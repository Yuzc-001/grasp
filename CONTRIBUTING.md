# Contributing to Grasp

Thank you for your interest in contributing.

---

## Before you start

- Read [README.md](README.md) to understand what Grasp is and what it is not
- Check [ROADMAP.md](ROADMAP.md) to see what is planned and what is out of scope
- Search [Issues](https://github.com/Yuzc-001/grasp/issues) before opening a new one

---

## Local development

### Prerequisites

- Node.js 18+
- Chrome installed (any channel)
- A running Chrome instance with remote debugging enabled

### Setup

```bash
git clone https://github.com/Yuzc-001/grasp.git
cd grasp
npm install
npm link        # makes `grasp` available globally from this clone
```

### Start Chrome for development

**Windows:**
```bat
start-chrome.bat
```

**macOS / Linux:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-grasp"
```

### Run the MCP server locally

```bash
node index.js   # starts MCP server (stdin must be a pipe, or use an MCP client)
grasp status    # verify Chrome connection
grasp logs      # view recent audit entries
```

### Debug mode

Set `DEBUG=grasp:*` to see verbose output (when implemented in v1.3):

```bash
DEBUG=grasp:* node index.js
```

---

## Project structure

```
index.js                    CLI entry + MCP server bootstrap
src/
  server/
    index.js                MCP server factory, tool registration
    tools.js                All 18 tool handlers
    state.js                Shared server state (hintRegistry, safeMode)
    audit.js                Fire-and-forget audit logger
    responses.js            Response formatting helpers
  layer1-bridge/
    chrome.js               CDP connection, reconnect logic
    webmcp.js               WebMCP protocol detection and proxy
  layer2-perception/
    hints.js                Hint Map builder, fingerprint registry, getLabel()
  layer3-action/
    actions.js              Mouse curves, wheel scroll, keyboard events
  cli/
    cmd-connect.js          grasp connect wizard
    cmd-status.js           grasp status
    cmd-logs.js             grasp logs
    auto-configure.js       AI client detection and config writing
    config.js               ~/.grasp/config.json read/write
    detect-chrome.js        Platform Chrome path detection
```

---

## Contribution guidelines

### What to contribute

- Bug fixes with a clear reproduction case
- Performance improvements to Hint Map building or action execution
- New tool implementations from the ROADMAP
- Documentation improvements
- Platform support (Firefox, Edge, Linux Chrome paths)

### What not to contribute

- Features not in the roadmap without prior discussion
- Breaking changes to tool names or parameter shapes (AI agents depend on these)
- Cloud, telemetry, or analytics integrations — Grasp is local-first
- Persona or roleplay wrappers

### Code style

- ESM modules throughout (`"type": "module"` in `package.json`)
- No TypeScript yet — plain JS until v1.3 type definitions are added
- No build step — all source runs directly with Node.js
- Error handling at system boundaries; trust internal guarantees elsewhere
- No copy-paste duplication — find the existing helper or add one

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(hints): add aria-labelledby as highest-priority label source
fix(cli): replace \r overwrites with console.log to fix Windows display
refactor(tools): extract HIGH_RISK_KEYWORDS into a named constant
docs: update README quick start to reflect grasp connect wizard
```

---

## Reporting bugs

Open an [Issue](https://github.com/Yuzc-001/grasp/issues) with:

1. Grasp version (`grasp --version`)
2. OS and Chrome version
3. Steps to reproduce
4. What you expected vs. what happened
5. Relevant output from `grasp logs` or the MCP client console

---

## Questions

- Feature discussion and bug reports: [Issues](https://github.com/Yuzc-001/grasp/issues)
- Private or licensing questions: `zxyu24@outlook.com`
