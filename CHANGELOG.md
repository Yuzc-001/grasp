# Changelog

All notable changes to Grasp are documented here.

---

## v0.6.7 — 2026-04-04

### Added
- First-run runtime bootstrap now consistently launches the dedicated `chrome-grasp` browser profile and verifies the visible browser runtime before reporting ready.
- Added `grasp doctor` style diagnostics coverage around CLI output and runtime setup behavior.
- Added workspace response/view builder layers so workspace tools expose a cleaner orchestrator → view → response pipeline.
- Added regression coverage for Edge browser instance detection, non-standard HintMap targets, and CSS visibility-driven page-state changes.

### Changed
- README, docs index, examples, and release references now consistently identify the current release as `v0.6.7`.
- Public support surface now explicitly includes Alma alongside Claude Code, Codex, and Cursor.
- Browser instance detection now recognizes visible and headless Edge endpoints correctly.
- HintMap discovery now covers common non-standard interactive elements such as tabindex/pointer-cursor/custom click targets.
- Page-state syncing now treats CSS visibility/display changes as real page-state changes instead of relying only on text/node deltas.

### Validated
- CLI/version consistency checks pass, including help/status/doctor and release surface references.
- Focused regressions pass for Edge detection, non-standard HintMap discovery, and CSS visibility-driven `domRevision` updates.
- Real-browser QA passes for WeChat home, BOSS home, and the Cloudflare challenge page on the dedicated visible runtime.

---

## v0.6.6 — 2026-04-01

### Added
- High-level runtime responses now include an `agent_prompt` package in metadata, with a fully assembled `system_prompt`, prompt segments, boundary key, surface key, and selected prompt packs.
- Added a shared prompt assembly layer so route boundary and visible surface evidence can be turned into a stable system prompt contract instead of only lightweight boundary guidance.
- Added dedicated surface prompt packs for public read, live session, warmup, handoff, form review, and workspace thread/list/detail/composer/loading surfaces.

### Changed
- `buildGatewayResponse` now assembles prompt context dynamically from `route` and `surface` evidence without changing the visible response contract.
- Verified direct `entry` results now override stale persisted handoff state when the current page is already reacquired and non-gated, fixing the first-hop over-handoff path.
- Public, form, and workspace runtime flows now expose both `agent_boundary` and `agent_prompt`, so agents can see not only the active boundary but also the exact prompt contract for the current surface.

### Validated
- Full automated suite passes fresh: `284 / 284`.
- Live smoke on the visible `chrome-grasp` runtime passes for `https://example.com/`, `https://httpbin.org/forms/post`, and the WeChat Official Accounts message workspace.
- Wrong-surface actions still return `BOUNDARY_MISMATCH` while route/surface-aware prompt assembly is enabled.

---

## v0.6.5 — 2026-04-01

### Added
- High-level runtime responses now inject a surface-specific `agent_boundary` package so agents can see the current operating boundary directly from gateway, form, and workspace results.
- Added explicit boundary guidance coverage for `public_read`, `live_session`, `session_warmup`, `form_runtime`, `workspace_runtime`, and `handoff`.
- Added a shared boundary guard so high-level form and workspace tools can stop early when the current surface does not match the requested runtime contract.

### Changed
- `buildGatewayResponse` now appends concise boundary text to the visible tool output instead of leaving route/surface discipline only in docs and skills.
- Gateway, form, and workspace flows now expose the same boundary contract through both response text and structured metadata.
- `form_*` and `workspace_*` tools now refuse wrong-surface calls with a structured `BOUNDARY_MISMATCH` recovery response instead of trying to act on the wrong page.

### Validated
- New route-boundary unit coverage passes for the six boundary modes.
- Gateway, form, and workspace integration coverage stays green with boundary injection enabled.
- Wrong-surface boundary guard coverage now passes for both form and workspace action paths.

---

## v0.6.4 — 2026-04-01

### Added
- Windows Edge 探测与自启动能力，在 Windows 设备上能识别 Edge 进程并同步启动运行时，确保可见引擎自动复活。
- 支持嵌套与横向滚动 / scroll_into_view，解决复杂布局中嵌套容器和水平滚动时的定位体验。
- 增强 screenshot，提升截图稳定性与精度，覆盖更动态的页面状态。
- 新增 tabs、evaluate、dialog、upload、drag、navigation、console、cookies、wait_for、double_click、check、key_down、key_up 等工具，让 agent 能更直接操作分离的页面/窗口/输入层。
- 引入 `.github/workflows/npm-publish.yml`，为未来的 npm 自动发布流程提供标准化工作流（此次只在仓库中登记，未实际发布）。

## v0.6.3 — 2026-03-31

The release that makes Grasp legible as a visible AI browser runtime and ships the first structured extraction path on top of the same runtime.

### Added
- **Structured Extraction Tool**: Added `extract_structured(fields=[...])` to the gateway surface so agents can turn the current page into a field-based record with JSON and optional Markdown exports.
- **Structured Matching Layer**: Added deterministic field matching for common label/value page patterns such as definition lists, table rows, and inline `Label: Value` text pairs.
- **Batch Scraper Surface**: Added `extract_batch(urls=[...], fields=[...])` so the same structured extraction contract can run across multiple URLs and emit CSV / JSON / optional Markdown artifacts.
- **Share Layer**: Added `share_page(format)` and `explain_share_card()` so current-page results can be exported as Markdown, screenshot, or PDF artifacts with a human-facing explanation layer.

### Changed
- **Visible Runtime Boundary**: Page-changing actions now require a confirmed runtime instance when the active browser instance can be identified, making the visible browser boundary a first-class runtime rule instead of a convention.
- **Plugin-based Fast-path Adapters**: The built-in BOSS fast path now runs through an adapter router, and local `.js` adapters or lightweight `.skill` manifests can extend site-specific fast reads from `~/.grasp/site-adapters` without changing core code.
- **Visible Browser Standard Flow**: Runtime tabs can now be enumerated and selected explicitly through `list_visible_tabs` and `select_visible_tab`, instead of relying on implicit tab guesses.
- **Pretext-backed Explain Layer**: Share-card layout explanation now uses Pretext when available so title / summary density can be estimated without touching the current page DOM.
- **Product Positioning**: README, docs index, landing page, MCP tool reference, and CLI help now describe Grasp as a route-aware AI browser runtime with a visible runtime boundary.
- **Release Surface**: Public docs now introduce structured extraction as the first flagship AI Scraper path built on top of the same runtime loop.

### Validated
- New structured extraction coverage passes for gateway integration and field matching.
- Previously-added runtime confirmation coverage remains green across action, gateway, form, and workspace flows.
- Full automated test suite passes before release.

---

## v0.6.1 — 2026-03-29

The release that solidifies the "Parallelism Foundations" by integrating task-aware auditing and explicit task management into the core runtime.

### Added
- **Task Management Tools**: Introduced `list_tasks` and `switch_task` to the MCP surface, allowing agents to explicitly manage and switch between multiple concurrent task contexts.
- **Integrated Isolation Testing**: Added `tests/server/integrated-task-isolation.test.js` to verify that history and state remain strictly isolated between different task IDs.

### Changed
- **Task-Aware Auditing**: Overhauled the `audit` mechanism to be task-aware. Action history is now synchronously pushed to the active task frame, ensuring that each task maintains its own verifiable audit trail.
- **Dependency-Injected Actions**: Refactored `registerActionTools` to support dependency injection for `navigateTo` and `syncPageState`, significantly improving the testability and robustness of the action pipeline.
- **Foundation Verification**: Completed and verified the "Parallelism Foundations" as promised in the v0.6 vision, moving them from protected baseline behavior to active, tested features.
- **Improved Test Fakes**: Enhanced `tests/helpers/fake-page.js` with better `window` and `document` mocks to support complex runtime evaluations in isolated test environments.

### Validated
- New integrated isolation suite passes: `2 / 2` (Verifying physical history isolation between concurrent tasks).
- Task frame and surface foundations pass: `6 / 6`.
- Full regression pass of the server runtime and action tools ensures zero regressions in existing authenticated and workspace flows.

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
