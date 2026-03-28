# Changelog

All notable changes to Grasp are documented here.

---

## v0.6.0 — 2026-03-28

The release that makes route selection a first-class product boundary instead of just another internal browser decision.

### Added
- `entry(url, intent)` now returns a structured route decision with `selected_mode`, `confidence`, `evidence`, `fallback_chain`, `requires_human`, `risk_level`, and `next_step`
- Route policy templates now distinguish `public_content`, `authenticated_content`, `dynamic_workspace`, `real_form`, and `gated_handoff`
- Route explainability is now first-class through structured route traces, `explain_route`, and `grasp explain`

### Changed
- Public positioning now centers on `Route by Evidence / 证据选路` and `One URL, one best path`
- `inspect`, `extract`, and `continue` now return the current route metadata instead of only page/continuation state
- Route traces are now written to the audit log in a structured form so route choice and fallback boundaries can be inspected later
- Package metadata, docs entry points, release docs, and examples now describe Grasp as a route-aware Agent Web Runtime instead of only a browser runtime

### Validated
- Focused route-aware and explainability suite passes: `34 / 34`
- The verified slice covers route policy selection, route trace persistence, `grasp explain`, `explain_route`, and the route-aware gateway flow

---

## v0.55.0 — 2026-03-26

The release that closes the last workspace consistency gaps for navigation-first authenticated surfaces.

### Changed
- Workspace navigation selection now treats the current navigation item as selected even when the page only exposes that state through class tokens such as `*_current`
- `select_live_item` now accepts already-selected navigation items as a successful no-op instead of surfacing `virtualized_window_changed`
- Workspace snapshots now reconcile merged hint-derived navigation items back into `active_item`, `active_item_label`, `selection_window`, and related verification fields
- `workspace_inspect` and related workspace tool summaries now prefer the selected live item label on list surfaces instead of falling back to `no active item`
- Package metadata, lockfile metadata, README badges, docs index, and release links now point to `v0.55.0`

### Validated
- Real workspace smoke on WeChat Official Accounts now reports `workspace_inspect -> Workspace list • 首页` and treats repeated selection of `首页` as `selected`
- Full automated test suite passes: `209 / 209`

---

## v0.5.2 — 2026-03-23

The release where Grasp becomes an AI browser gateway with safe real form tasks and dynamic authenticated task flows.

### Added
- Gateway-first product surface centered on `entry`, `inspect`, `extract`, and `continue`
- Safe form-task layer with `form_inspect`, `fill_form`, `set_option`, `set_date`, `verify_form`, and `safe_submit`
- Dynamic authenticated workspace-task layer with `workspace_inspect`, `select_live_item`, `draft_action`, `execute_action`, and `verify_outcome`
- Guarded preview-first submit and send paths, with explicit confirmation required for irreversible actions

### Changed
- README, CLI help, and public docs now describe Grasp as an AI browser gateway instead of a browser runtime-first toolset
- Public docs were reduced to the current release surface, with internal and obsolete planning documents removed from the visible docs set
- Package metadata, release links, and versioned docs now point to `v0.5.2`

### Validated
- Safe real form tasks were exercised on real recruitment flows up to pre-submit verification
- Dynamic authenticated workspace flows were exercised on live messaging-style surfaces with inspection, draft, guarded send, and outcome verification
- Full automated test suite passes: `174 / 174`

---

## v0.4.0 — 2026-03-21

The release where Grasp becomes a browser runtime centered on continuity: runtime truth, page grasp, verified actions, persisted handoff, and false-verified rejection.


### Added
- Runtime Truth mainline integration for browser/runtime status normalization, including unified truth read/write flow and legacy compatibility bridge
- Explicit Handoff / Resume state model with persisted runtime-scoped handoff state at `~/.grasp/handoff-state.json`
- Task continuation anchors for handoff recovery: `expected_url_contains`, `expected_page_role`, and `expected_selector`
- Persisted-anchor inheritance in `resume_after_handoff`, so continuation checks can survive across calls without re-supplying anchors
- False-verified defense for handoff recovery: resumed sessions now fall to `resumed_unverified` when continuation anchors do not match
- Additional handoff regression coverage for persisted anchors and continuation mismatch handling

### Changed
- `src/server/tools.js` was rewritten into a cleaner `v0.4` mainline surface centered on navigation, grasp status, verified actions, and handoff continuity
- Mainline interaction surface now includes verified / runtime-aligned support for `hover`, `press_key`, `watch_element`, and `scroll`
- `resume_after_handoff` now evaluates continuation evidence instead of relying on page reacquisition alone
- Documentation surface was reduced and cleaned: current-state docs stay at the top level, while older design/test materials were archived

### Validated
- Full test suite passes: `49 / 49`
- Cross-call handoff persistence closes from `handoff_required` to `resumed_verified`
- High-friction GitHub login page now has both:
  - positive continuation evidence (`resumed_verified` with matching anchors)
  - false-verified rejection (`resumed_unverified` with mismatched anchors)

---

## v0.3.0 — 2026-03-19

### Added
- OpenClaw-oriented launcher/wrapper at `scripts/grasp_openclaw_ctl.sh` for browser bootstrap, CDP startup, health checks, and lifecycle control
- `PLAN.md` to define Grasp `v0.3.0` as an OpenClaw-ready agent browser runtime release
- OpenClaw integration docs:
  - `docs/openclaw-quickstart-v0.3.md`
  - `docs/openclaw-agent-entry-v0.3.md`
  - `docs/openclaw-smoke-test-v0.3.md`
  - `docs/release-notes-v0.3.0.md`

### Changed
- README and README.zh-CN now make the product boundary explicit for strongly verified / high-friction environments
- OpenClaw runtime path now centers on a dedicated browser profile and local launcher flow instead of asking users to reason about CDP details directly

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
