# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.2.0-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.md#install)
[![npm](https://img.shields.io/badge/npm-grasp-CB3837?style=flat-square)](https://www.npmjs.com/package/grasp)

> **Give AI its own browser.**
>
> Log in once. Every session persists. Your Chrome stays yours.

Grasp is an open-source MCP server for browser automation. It runs entirely on your machine, connects to a dedicated `chrome-grasp` profile, and gives AI agents full browser control — navigation, interaction, and observation — with no cloud dependency and no interference with your personal browsing.

**Current release:** `v0.2.0`

---

## Design

The agent should have its own browser. Not a borrowed session, not a fresh blank tab — a persistent profile it owns, with credentials that accumulate over time.

`chrome-grasp` is that profile. The agent logs in to the services it needs. Those sessions outlast every run. Your tabs and history are never touched.

Three principles shape how Grasp works:

**Local and open.** The entire codebase is MIT-licensed and runs on your hardware. No cloud backend. No telemetry. No account. What the agent does is visible only to you.

**Semantic perception, not raw HTML.** Grasp scans the live viewport and produces a compact Hint Map — a stable, minimal representation of what is interactable on screen:

```
[B1] Submit order      (button, pos:450,320)
[I1] Coupon code       (input,  pos:450,280)
[L2] Back to cart      (link,   pos:200,400)
```

IDs are fingerprint-stable across calls. Token cost drops 90%+ versus passing raw HTML. The agent reasons about UI the way it reasons about everything else — through structured, meaningful data.

**Real input, not scripted automation.** Every click traces a curved path across the screen. Every scroll arrives as a sequence of wheel events. Every keystroke carries its own timing. This is input dispatched through Chrome DevTools Protocol — not `element.click()`.

On pages that expose `window.__webmcp__`, Grasp bypasses the DOM entirely and calls native tool APIs directly. On every other page, Hint Map and real events handle the interaction. The agent does not need to know which path was taken.

---

## Install

### One command

```bash
npx grasp
```

Detects Chrome, launches it with the `chrome-grasp` profile, and auto-configures your AI client. First run opens the browser — log in to any services your agent will use. Sessions are saved permanently.

### Claude Code

```bash
claude mcp add grasp -- npx -y grasp
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "grasp": {
      "command": "npx",
      "args": ["-y", "grasp"]
    }
  }
}
```

### Codex CLI

```toml
[mcp_servers.grasp]
type    = "stdio"
command = "npx"
args    = ["-y", "grasp"]
```

---

## CLI

| Command | Description |
|:---|:---|
| `grasp` / `grasp connect` | Setup wizard — detect Chrome, launch, configure AI clients |
| `grasp status` | Connection state, current tab, recent activity |
| `grasp logs` | View audit log (`~/.grasp/audit.log`) |
| `grasp logs --lines 20` | Last 20 entries |
| `grasp logs --follow` | Stream in real time |

---

## MCP tools

### Navigation

| Tool | Description |
|:---|:---|
| `navigate` | Navigate to URL, auto-detect WebMCP |
| `get_status` | Connection state, current page, execution mode |
| `get_page_summary` | Title, URL, visible text (first 2000 chars) |
| `wait_until_stable` | Wait for repeated page snapshots to stop changing |
| `extract_main_content` | Extract focused main/article text from the current page |
| `screenshot` | Capture current viewport (base64) |

### Interaction

| Tool | Description |
|:---|:---|
| `get_hint_map` | Scan viewport, return semantic map |
| `get_form_fields` | Identify form fields, aligned with hint map IDs |
| `search_affordances` | Rank the current page's search-friendly inputs and submit controls |
| `click` | Click by hint ID; high-risk actions intercepted |
| `confirm_click` | Force-click a high-risk element |
| `type` | Type text keystroke-by-keystroke |
| `hover` | Hover to trigger dropdowns or tooltips |
| `scroll` | Scroll up or down with real wheel events |
| `press_key` | Send keyboard shortcuts |
| `watch_element` | Watch a CSS selector for DOM changes |

### Task Schedulers

| Tool | Description |
|:---|:---|
| `search_task` | Run a verified search workflow with bounded recovery and stable metrics (`attempts`, `toolCalls`, `retries`, `recovered`) |

### Tabs

| Tool | Description |
|:---|:---|
| `get_tabs` | List all open tabs |
| `switch_tab` | Switch to tab by index |
| `new_tab` | Open URL in a new tab |
| `close_tab` | Close tab by index |

### Audit

| Tool | Description |
|:---|:---|
| `get_logs` | Last N operations from `~/.grasp/audit.log` |
| `call_webmcp_tool` | Call a native WebMCP tool (WebMCP mode only) |

---

## Configuration

| Variable | Default | Description |
|:---|:---|:---|
| `CHROME_CDP_URL` | `http://localhost:9222` | Chrome remote debugging address |
| `GRASP_SAFE_MODE` | `true` | Intercept high-risk actions before execution |

Persistent config at `~/.grasp/config.json`.

## Recovery Semantics

Interactive tools now surface structured failures through response metadata:

- `error_code` identifies the failure class (`CDP_UNREACHABLE`, `STALE_HINT`, `ACTION_NOT_VERIFIED`, and friends)
- `retryable` tells the caller whether bounded recovery is safe
- `suggested_next_step` points to the next move (`retry`, `reobserve`, `wait_then_reverify`)
- `evidence` includes the page-level details used by the verifier

The `search_task` scheduler builds on the same contract and returns stable benchmark fields directly in the tool result. `toolCalls` counts scheduler action steps (`type`, `click`, `press_key`) rather than state-sync internals, while `recovered` indicates that a bounded recovery path was needed.

Benchmark smoke scenarios and reporting rules live in [docs/benchmarks/search-benchmark.md](./docs/benchmarks/search-benchmark.md).

---

## Repository

```
index.js                    CLI entry, MCP server bootstrap
src/
  server/                   Tool registry, state, audit, responses
  layer1-bridge/            Chrome CDP connection, WebMCP detection
  layer2-perception/        Hint Map, fingerprint registry
  layer3-action/            Mouse curves, wheel scroll, keyboard events
  cli/                      connect · status · logs · auto-configure
examples/                   Client config samples
start-chrome.bat            Windows Chrome launcher
```

---

## License

MIT — see [LICENSE](./LICENSE).

## Contact

- Issues: https://github.com/Yuzc-001/grasp/issues
- Email: `zxyu24@outlook.com`

## Claude Code Skill

Install the bundled skill to give Claude structured knowledge of every Grasp tool — workflows, hint map usage, safety mode, and WebMCP detection.

**OpenClaw:** Search for `grasp` and install in one click.

**Manual install:**

```bash
curl -L https://github.com/Yuzc-001/grasp/raw/main/grasp.skill -o ~/.claude/skills/grasp.skill
```

Once installed, Claude automatically knows when and how to use Grasp — no manual prompting needed.

---

## Star history

[![Star History Chart](./star-history.svg)](https://star-history.com/#Yuzc-001/grasp&Date)

---

[README.zh-CN.md](README.zh-CN.md) · [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
