# Changelog

All notable changes to Grasp are documented here.

---

## v0.2.0 — 2026-03-19

### Added
- Native `node:test` harness plus fake browser/page helpers, so runtime behavior can be verified without a live Chrome session
- CDP connection watchdog with persisted runtime status, allowing `grasp status` to distinguish `connected`, `disconnected`, and `CDP_UNREACHABLE`
- Same-URL DOM revision tracking and stale-hint self-healing for dynamic overlays and remount-heavy pages
- Post-action verifiers, structured error envelopes, and failure audit events for `click`, `type`, `hover`, `press_key`, and higher-level task tools
- `wait_until_stable`, `extract_main_content`, and `search_affordances` for more reliable reading and task planning
- `search_task`, a thin search scheduler that applies bounded recovery (`alternate_submit`, `wait_then_reverify`, `reobserve`) and exposes benchmark-ready metrics
- Local benchmark runner and scenario docs for comparing success rate, tool calls, retries, and recovery success across scheduler iterations

### Changed
- `grasp status` now reports the effective runtime safe-mode value and the latest watchdog state instead of only static config
- Search-style automation is now documented as a verified workflow rather than an ad-hoc sequence of raw low-level tool calls

---

## v0.1.1 — 2026-03-18

### Added
- Claude Code skill (`grasp.skill`) — install once, Claude automatically knows when and how to use every Grasp tool
- `skill/` directory with skill source (`SKILL.md` + `references/tools.md`) for transparency
- GitHub Action to auto-update star history chart every 6 hours

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
