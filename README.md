# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.1.0-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.md#install)
[![npm](https://img.shields.io/badge/npm-grasp-CB3837?style=flat-square)](https://www.npmjs.com/package/grasp)

> **Give AI its own browser.**
>
> A dedicated Chrome profile for AI agents. Log in once, automate forever.
> Runs parallel to your real Chrome — no conflicts, no interference.

Grasp is a local MCP server that gives AI agents full browser control through Chrome DevTools Protocol. It creates a dedicated `chrome-grasp` profile where your agent logs in to services once and retains every session permanently — completely separate from your personal browsing.

**Current release:** `v0.1.0`

---

## What Grasp stands for

Browser automation for AI was broken in three ways: sessions never persisted, HTML was too expensive to send to a model, and JS injection got blocked.

Grasp fixed all three — and built the architecture from the ground up for the MCP era.

**Three original contributions:**

**1. The dedicated browser.** Grasp introduced the idea of giving AI its own Chrome profile. The agent logs in once; every session is saved permanently in `chrome-grasp`. No other tool does this. Cloud browsers lose every cookie on shutdown. Local Playwright starts blank every time. Grasp starts logged in — always.

**2. Hint Map.** Instead of dumping raw HTML into the context window, Grasp scans the live viewport and produces a compact semantic map:

```
[B1] Submit order      (button, pos:450,320)
[I1] Coupon code       (input,  pos:450,280)
[L2] Back to cart      (link,   pos:200,400)
```

IDs are fingerprint-stable across calls. Token cost drops 90%+ versus raw HTML. This is Grasp's original perception layer — purpose-built for how models actually reason about UI.

**3. Real events, not injection.** Every click is a mouse curve with randomized timing and landing offset. Every scroll is a sequence of CDP wheel events. Every keystroke has per-character delay. This is not `element.click()`. It is OS-level input indistinguishable from a human hand.

On pages that expose `window.__webmcp__`, Grasp calls native tool APIs directly and skips DOM parsing entirely. On every other page — the vast majority of the web — Hint Map and real events take over automatically. The agent never needs to know which mode it is in.

## Why Grasp exists

Giving AI browser access today comes with three bad options:

| Option | Problem |
|:---|:---|
| Cloud headless browsers (Browserbase, Steel) | Data leaves your machine, no cookies, unreachable on private networks |
| Local Playwright with a new profile | Fresh profile every time, all logins gone, SSO and 2FA fail |
| Page-reading tools | Read-only, cannot interact |

Grasp is the fourth option: a persistent, local, agent-owned browser that starts every task already logged in.

## What ships in this repo

Grasp `v0.1.0` includes:
- an MCP server in `src/server/` with 18 registered tools
- a Chrome bridge and adaptive execution engine in `src/layer1-bridge/`
- a Hint Map perception layer in `src/layer2-perception/`
- a real-event action layer in `src/layer3-action/`
- a CLI in `src/cli/` with `connect`, `status`, and `logs` commands
- an audit log written to `~/.grasp/audit.log`
- a safe mode that intercepts high-risk actions before they fire
- one-click AI client auto-configuration for Claude Code, Codex, and Cursor
- a `grasp connect` wizard that bootstraps everything from scratch

## How it works

```
Your chrome-grasp profile (logged in, sessions intact)
         |
         | Chrome DevTools Protocol (CDP)
         |
    Grasp MCP Server
         |
         | MCP stdio
         |
    Your AI Agent (Claude / Codex / Cursor)
```

**Adaptive execution engine** — on every navigation, Grasp probes for WebMCP support in under 50ms. Pages that expose `window.__webmcp__` get native structured tools with zero DOM parsing. All other pages fall back to Hint Map + real event execution.

**Hint Map** — instead of sending raw HTML, Grasp scans the viewport and returns a compact semantic map:

```
[B1] Submit order      (button, pos:450,320)
[I1] Coupon code       (input,  pos:450,280)
[L2] Back to cart      (link,   pos:200,400)
```

Token consumption drops 90%+ compared to raw HTML. IDs are fingerprint-stable across calls.

**Real events, not JS injection** — every click is a mouse curve (15 steps, random landing offset). Every scroll is 5 CDP wheel events with 20–60ms random gaps. Every keystroke has 30–80ms per-character delay.

## Install

### One-click (recommended)

```bash
npx grasp
```

This runs the `grasp connect` wizard: detects Chrome, launches it with a dedicated `chrome-grasp` profile, and auto-configures your AI client.

> First launch: the wizard opens `chrome-grasp`. Log in to any services your agent will use. Sessions are saved permanently in that profile.

### Add to AI client manually

#### Claude Code CLI

```bash
claude mcp add grasp -- npx -y grasp
```

#### Claude Desktop / Cursor

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

#### Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.grasp]
type    = "stdio"
command = "npx"
args    = ["-y", "grasp"]
```

### Global install

```bash
npm install -g grasp
grasp connect
```

## CLI commands

| Command | Description |
|:---|:---|
| `grasp` / `grasp connect` | Setup wizard — detect Chrome, launch, configure AI clients |
| `grasp status` | Chrome connection state, current tab, recent activity |
| `grasp logs` | View audit log (`~/.grasp/audit.log`) |
| `grasp logs --lines 20` | Show last 20 entries |
| `grasp logs --follow` | Stream new entries in real time |
| `grasp --version` | Print version |
| `grasp --help` | Print help |

## MCP tools

### Navigation & state

| Tool | Description |
|:---|:---|
| `navigate` | Navigate to URL, auto-detect WebMCP, return title and mode |
| `get_status` | Chrome connection state, current page, execution mode |
| `get_page_summary` | Page title, URL, visible text (first 2000 chars) |
| `screenshot` | Capture current viewport (returns base64) |

### Interaction

| Tool | Description |
|:---|:---|
| `get_hint_map` | Scan viewport elements, return `[B1]` `[I1]` `[L1]` semantic map |
| `get_form_fields` | Identify form fields grouped by `<form>`, IDs aligned with hint map |
| `click` | Natural mouse curve click on hint ID; high-risk actions intercepted |
| `confirm_click` | Force-click a high-risk element (bypasses safe mode) |
| `type` | Type text keystroke-by-keystroke on hint ID, supports `press_enter` |
| `hover` | Hover element to trigger dropdowns or tooltips |
| `scroll` | Real wheel-event scroll (`up` / `down`) |
| `press_key` | Send keyboard shortcuts (`Enter`, `Escape`, `Control+Enter`) |
| `watch_element` | Watch a CSS selector for `appears` / `disappears` / `changes` |

### Tab management

| Tool | Description |
|:---|:---|
| `get_tabs` | List all open tabs (index, title, URL) |
| `switch_tab` | Switch to tab by index |
| `new_tab` | Open URL in a new tab |
| `close_tab` | Close tab by index |

### Logs & audit

| Tool | Description |
|:---|:---|
| `get_logs` | View last N operations (default 50), file at `~/.grasp/audit.log` |

### WebMCP protocol

| Tool | Description |
|:---|:---|
| `call_webmcp_tool` | Call a native WebMCP tool exposed by the current page |

## Configuration

| Variable | Default | Description |
|:---|:---|:---|
| `CHROME_CDP_URL` | `http://localhost:9222` | Chrome remote debugging address |
| `GRASP_SAFE_MODE` | `true` | Set to `false` to disable high-risk action interception |

Persistent config is stored in `~/.grasp/config.json`.

## Repository map

- `README.md` / `README.zh-CN.md` — public entry points in English and Chinese
- `CHANGELOG.md` — release history
- `CONTRIBUTING.md` — contribution guide
- `LICENSE` — MIT
- `index.js` — CLI entry point and MCP server bootstrap
- `src/server/` — MCP tool registry, state, audit logger, response helpers
- `src/layer1-bridge/` — Chrome CDP connection, WebMCP detection
- `src/layer2-perception/` — Hint Map builder, fingerprint registry
- `src/layer3-action/` — real mouse/keyboard/scroll event execution
- `src/cli/` — connect, status, logs commands; Chrome detection; AI client auto-configure
- `examples/` — sample MCP client configs
- `start-chrome.bat` — Windows one-click Chrome launcher

## License

MIT — see [LICENSE](./LICENSE).

## Collaboration & contact

- Issues: https://github.com/Yuzc-001/grasp/issues
- Email: `zxyu24@outlook.com`

Use Issues for bugs, install problems, documentation gaps, and feature requests.
Use email for private collaboration or questions that should not start in a public thread.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=Yuzc-001/grasp&type=Date)](https://star-history.com/#Yuzc-001/grasp&Date)

## Read next

- [README.zh-CN.md](README.zh-CN.md)
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
