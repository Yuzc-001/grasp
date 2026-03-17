# Changelog

All notable changes to Grasp are documented here.

---

## v0.1.0 — 2025-03-17

First public release.

### Added
- MCP server with 18 registered tools across navigation, interaction, tab management, audit, and WebMCP protocol
- Chrome CDP bridge via `playwright-core` `chromium.connectOverCDP()`
- Adaptive execution engine: auto-detects WebMCP (`window.__webmcp__` / `/.well-known/mcp`) on every navigation, falls back to Hint Map + CDP events
- Hint Map perception layer with fingerprint-stable IDs (`tag|label8|gridX|gridY`) persisted across calls, reset on URL change
- `aria-labelledby` support as highest-priority label source in `getLabel()`
- Real OS-level event execution: mouse curves (15 steps, random offset), wheel scroll (5 steps, 20–60ms gaps), keystroke input (30–80ms per-character delay)
- `click` navigation feedback: reports whether a new URL was loaded after the click
- Safe mode: `HIGH_RISK_KEYWORDS` interception on `click`, bypassed by `confirm_click`
- Audit logging to `~/.grasp/audit.log` with fire-and-forget writes
- `get_form_fields`: scans `<form>` elements, groups fields, aligns IDs with hint map via `data-grasp-id`
- Token efficiency: `get_hint_map` appends `~X% saved vs raw HTML` to every response
- `grasp connect` wizard: detect Chrome, launch with dedicated `chrome-grasp` profile, auto-configure AI clients
- `grasp status`: HTTP ping to CDP, show Chrome version, active tab, and recent log
- `grasp logs`: view audit log with `--lines N` and `--follow` (500ms polling)
- Auto-configuration for Claude Code (`claude mcp add`), Codex CLI (TOML), and Cursor (JSON)
- Persistent config at `~/.grasp/config.json`
- `start-chrome.bat` for Windows one-click Chrome launch with remote debugging
- CLI entry at `index.js` with MCP mode auto-detection via `process.stdin.isTTY`
