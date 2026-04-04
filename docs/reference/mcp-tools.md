# MCP Tools

Grasp exposes one runtime surface. Read it in this order:

- runtime loop for entry, reading, and deciding the next step
- verification and recovery for real-page evidence, handoff, and resume
- task-specialized surfaces for forms and authenticated workspaces
- lower-level primitives when the default runtime path is not enough

---

## Runtime Loop

Public route modes:

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

| Tool | What it is for |
|:---|:---|
| `entry` | Enter a target URL with an intent and return the route decision: selected mode, evidence, fallback chain, risk, and next step. |
| `inspect` | Inspect the current page as runtime state and report the current route metadata for the active task. |
| `extract` | Extract the current page into a usable content payload while staying on the current route. |
| `extract_structured` | Extract the current page into a field-based record and return JSON / optional Markdown exports while staying on the current route. |
| `extract_batch` | Visit multiple URLs through the same runtime path, extract structured records, and write CSV / JSON / optional Markdown artifacts. |
| `share_page` | Export the current page into a shareable Markdown, screenshot, or PDF artifact built from the current page projection. |
| `explain_share_card` | Explain how Grasp would lay out the current page as a human-facing share card, using Pretext-backed layout estimates when available. |
| `continue` | Decide the next continuation step without triggering a browser action and report the current route metadata. |
| `explain_route` | Explain the latest route decision, including mode, fallback, and route evidence. |

Recommended default flow:

1. `entry`
2. `inspect`
3. `extract`, `extract_structured`, `extract_batch`, `share_page`, or `continue`
4. `explain_route` to read the selected route rationale
5. if needed, move into handoff and then `resume_after_handoff`

High-level runtime responses now include `agent_boundary` metadata plus a short `Boundary: ...` text block. They also expose `agent_prompt`, which contains the assembled `system_prompt`, prompt segments, and the chosen boundary/surface prompt packs. Treat that prompt package as the executable companion to the boundary contract. If a `form_*` or `workspace_*` tool is called on the wrong surface, Grasp returns `BOUNDARY_MISMATCH` with the correct recovery step instead of attempting the action anyway.

Manual smoke playbook: [docs/reference/smoke-paths.md](./smoke-paths.md)

Fast-path adapters:

- built-in site-specific fast reads now sit behind adapters instead of being hard-coded into the core route loop
- Grasp loads local adapters from `~/.grasp/site-adapters` by default
- set `GRASP_SITE_ADAPTER_DIR` when you want a different adapter directory
- supported entries are `.js` adapters and lightweight `.skill` manifests that point at a `.js` adapter via `entry:` or `adapter:`
- a `.js` adapter only needs `matches(url)` or `match(url)`, plus `read(page)`

---

## Verification and Recovery

### Runtime state and evidence

| Tool | What it is for |
|:---|:---|
| `get_status` | Read raw runtime status, page grasp, and handoff state. |
| `get_page_summary` | Get a quick page summary when you need evidence outside the default loop. |

### Session strategy and handoff

| Tool | What it is for |
|:---|:---|
| `preheat_session` | Warm up a host before direct entry. |
| `navigate_with_strategy` | Use session-trust strategy when you intentionally bypass `entry`. |
| `session_trust_preflight` | Inspect trust level and recommended entry strategy. |
| `suggest_handoff` | Build a handoff suggestion from the current checkpoint page. |
| `request_handoff_from_checkpoint` | Persist a handoff directly from checkpoint state. |
| `request_handoff` | Mark that a human step is required. |
| `mark_handoff_in_progress` | Mark that the human step is underway. |
| `mark_handoff_done` | Mark that the human step is complete and ready for reacquisition. |
| `resume_after_handoff` | Reacquire page state after a human step and evaluate continuation evidence. |
| `clear_handoff` | Clear handoff state and return to idle. |

Recommended recovery flow:

1. `inspect` or `continue`
2. `request_handoff`
3. `mark_handoff_done`
4. `resume_after_handoff`
5. `continue`

---

## Task-Specialized Surfaces

### Form Surface

| Tool | What it is for |
|:---|:---|
| `form_inspect` | Inspect the visible form, return fields, sections, summary, and ambiguity evidence. |
| `fill_form` | Fill safe text-like fields and return refreshed form state. |
| `set_option` | Set review-tier option fields such as selects and comparable controls. |
| `set_date` | Set review-tier date fields. |
| `verify_form` | Re-read the form and report completion status and remaining blockers. |
| `safe_submit` | Preview or confirm form submission with blocker reporting. |

Recommended form flow:

1. `form_inspect`
2. `fill_form` / `set_option` / `set_date`
3. `verify_form`
4. `safe_submit`

### Workspace Surface

| Tool | What it is for |
|:---|:---|
| `workspace_inspect` | Inspect the current authenticated workspace surface, live items, composer state, and blockers. |
| `select_live_item` | Select a visible workspace item by semantic label and return the refreshed workspace state. |
| `draft_action` | Draft text into the current workspace composer without sending it. |
| `execute_action` | Preview or confirm the guarded workspace send action. |
| `verify_outcome` | Re-read the workspace and report the current outcome signals and next step. |

Recommended workspace flow:

1. `workspace_inspect`
2. `select_live_item`
3. `workspace_inspect`
4. `draft_action`
5. `workspace_inspect`
6. `execute_action`
7. `verify_outcome`

---

## Lower-Level Runtime Primitives

### Direct navigation

| Tool | What it is for |
|:---|:---|
| `navigate` | Direct navigation without the default runtime loop. |
| `list_visible_tabs` | Enumerate user-visible runtime tabs and mark which one is currently active. |
| `select_visible_tab` | Bring a runtime tab to the front by matching a title fragment or URL fragment. |

### Interaction and observation

| Tool | What it is for |
|:---|:---|
| `get_hint_map` | Return the current interaction map for the visible page. |
| `click` | Click by hint ID and verify the result. |
| `type` | Type by hint ID and verify the result. |
| `hover` | Hover by hint ID and refresh page state. |
| `press_key` | Send keyboard input and refresh page state. |
| `scroll` | Scroll the current page and refresh page state. |
| `watch_element` | Watch a selector for appear, disappear, or change events. |
