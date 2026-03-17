# Grasp Roadmap

> Give AI its own browser.
> A dedicated Chrome profile for AI agents. Log in once, automate forever.

---

## Current release: v0.1.0

Core MCP server, Hint Map, real-event execution, CLI, and AI client auto-configuration.

---

## `v0.1 Core` — shipped

- MCP server with 18 tools across navigation, interaction, tab management, audit, and WebMCP protocol
- Chrome CDP bridge with WebMCP auto-detection (< 50ms probe per navigation)
- Hint Map with fingerprint-stable IDs, reset on URL change
- Real OS-level mouse curves, keyboard events, and wheel scroll
- Safe mode: high-risk action interception, `confirm_click` bypass
- Audit logging to `~/.grasp/audit.log`
- `get_form_fields` aligned with hint map via `data-grasp-id`
- Token efficiency reporting on every `get_hint_map` response
- `grasp connect` wizard: detect Chrome, launch dedicated profile, auto-configure AI clients
- `grasp status` and `grasp logs` CLI commands
- Auto-configuration for Claude Code, Codex CLI, and Cursor
- Persistent config at `~/.grasp/config.json`

---

## `v1.1 Multi-browser`

> Goal: not locked to Chrome — Firefox and Edge with equal support.

- [ ] Abstract `BrowserAdapter` interface to isolate browser-specific differences
- [ ] Firefox support via Chrome DevTools Protocol over WebDriver BiDi
- [ ] Edge support (Chromium base, minimal connection parameter change)
- [ ] `--browser chrome|firefox|edge` launch flag
- [ ] Hint Map regression tests across all three browsers

---

## `v1.2 Robustness`

> Goal: long-running sessions that recover from failures without human intervention.

- [ ] Auto-reconnect after Chrome crash or disconnect; restore `hintRegistry` on reconnect
- [ ] `watchElement` timeout recovery: suggest next steps instead of silent failure
- [ ] `click` / `type` failure distinguishes "element gone" from "element obscured"
- [ ] Keepalive heartbeat to prevent idle tab closure
- [ ] `get_hint_map` auto-truncation for pages with 500+ elements, with filter hint

---

## `v1.3 Developer experience`

> Goal: easy to extend, debug, and contribute to.

- [ ] `--debug` mode: print CDP call log and hint map diff per operation
- [ ] `grasp replay <log-file>`: replay audit log in read-only verification mode
- [ ] TypeScript type definitions published to npm
- [ ] Unit tests for Hint Map fingerprint, `getLabel()`, and `buildHintMap()`
- [ ] CONTRIBUTING.md: local dev, debug, and PR guide

---

## Execution order

```
Shipped  v1.0 Core
Next  →  v1.1 Multi-browser
         v1.2 Robustness  (parallel with v1.1)
         v1.3 Developer experience
```
