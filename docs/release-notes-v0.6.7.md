# Grasp v0.6.7

This release turns the recent runtime hardening work into a more complete product surface.

The center of gravity is still the runtime:

- route-aware entry
- verification-backed continuation
- explicit handoff and recovery
- stable runtime state at the response layer

But v0.6.7 adds a stronger outer product loop so the runtime is easier to use, inspect, and trust.

## What Shipped

### 1. Runtime Hardening

- same-host redirects no longer break pinned runtime targets during real browser entry
- transient `page.title()` execution-context failures no longer crash high-level runtime responses
- entry now reports the resolved landing URL instead of echoing the requested URL when they differ
- `runtime_confirmation` no longer crashes when the browser instance is temporarily unavailable

### 2. Better Real-Business Routing

- `https://mp.weixin.qq.com/` home no longer collapses into `form_runtime`
- large public landing pages such as BOSS home no longer classify as form pages just because they expose many controls
- isolated real-browser QA now verifies:
  - WeChat home -> `live_session`
  - BOSS home -> `live_session`
  - solved Cloudflare challenge page -> `public_read`

### 3. Task Runner Surface

New task-management tools:

- `create_task`
- `get_task`
- `cancel_task`
- richer `list_tasks`

Tracked tasks now carry:

- goal
- target URL
- current status
- latest tool/result
- artifact references

This makes Grasp feel less like a one-shot runtime call and more like a task runner with recoverable state.

### 4. Visible Governance

New governance and audit surfaces:

- `get_governance_status`
- `get_activity_log`

These expose:

- safe mode
- current runtime boundary
- permission mode
- preferred tool pack
- high-risk action policy
- audit log path

### 5. Better CLI Workflow

The CLI now includes:

- `grasp tasks`
- `grasp artifacts`
- a clearer first-run bootstrap path around `grasp connect`
- doctor-style diagnostics coverage for setup and runtime checks

This gives a lightweight product loop without requiring a dashboard:

- connect runtime
- run tasks through the MCP server
- inspect recent task activity
- find exported artifacts for download or reuse

### 6. Runtime Compatibility & Detection Hardening

- Edge endpoints are now classified correctly as visible or headless browser instances instead of falling back to `unknown`
- common non-standard interactive elements now enter the HintMap through practical heuristics such as `tabindex`, click handlers, pointer cursor, and action-oriented ARIA attributes
- CSS display / visibility changes now count as real page-state changes instead of being ignored when text and node counts stay stable
- the public support surface now explicitly covers Claude Code, Codex, Cursor-style MCP clients, and Alma

### 7. Isolated Business QA

New script:

- `npm run qa:business`

This script:

- resets visible test tabs per scenario
- uses a fresh server state per site
- verifies `entry -> inspect -> active_page -> snapshot`
- writes a report to a temp directory

That makes real-business regression checks more repeatable and less vulnerable to tab pollution.

## Design Direction

v0.6.7 sharpens the product shape:

- runtime core first
- instant value tools as the front door
- task runner as the outer loop
- governance as visible trust, not hidden implementation detail

Grasp should feel like a truthful agent web runtime, not a bag of browser tricks.
