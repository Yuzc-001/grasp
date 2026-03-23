# Gateway Smoke Paths

These are manual Phase 1 smoke checks for the gateway and form-task flow. They describe expected signals, not guarantees.

## 1. Public Form

- URL: a public form page with visible fields and no login requirement
- Tools to call: `form_inspect` -> `fill_form` -> `safe_submit(mode=preview)`

Expected:

| Tool | Expected status | Expected result | Expected continuation |
|---|---|---|---|
| `form_inspect` | `direct` | `task_kind: form`, sections and fields are present | `can_continue: true`, `suggested_next_action: verify_form` |
| `fill_form` | `direct` | safe fields are written, review/sensitive stay visible | `can_continue: true`, `suggested_next_action: verify_form` |
| `safe_submit(mode=preview)` | `direct` | preview blockers are returned, submit is not clicked | `can_continue: true`, `suggested_next_action: verify_form` |

## 2. Authenticated Recruitment Form

- URL: a logged-in recruitment or application form
- Tools to call: `entry` -> `continue` -> `form_inspect` -> `fill_form` -> `set_option` -> `set_date` -> `verify_form` -> `safe_submit(mode=preview)`

Expected:

| Tool | Expected status | Expected result | Expected continuation |
|---|---|---|---|
| `entry` | `direct` or `warmup` | session-aware entry result | trust-aware next step |
| `continue` | direct or gated depending on page | route into the form-task flow | when the page is a form, `suggested_next_action: form_inspect` |
| `form_inspect` | `direct` | `task_kind: form`, risky fields visible in the result | `can_continue: true`, `suggested_next_action: verify_form` |
| `fill_form` | `direct` | only safe fields are filled | `can_continue: true`, `suggested_next_action: verify_form` |
| `set_option` / `set_date` | `direct` | review-tier fields are updated, sensitive fields stay blocked | `can_continue: true`, `suggested_next_action: verify_form` |
| `verify_form` | `direct` | returns completion status, verification summary, sections, fields, and submit controls | `can_continue: true`, `suggested_next_action` points to the next remaining action |
| `safe_submit(mode=preview)` | `direct` | preview blockers are returned; no submit click happens | `can_continue: true`, `suggested_next_action: verify_form` |

Phase 1 conservative points:

- file upload is not supported yet
- tree-style department picker may resolve to `unresolved`

## 3. Handoff + Resume

- URL: a form page reached after a handoff or human step
- Tools to call: `entry` -> `continue` -> `request_handoff` -> `mark_handoff_done` -> `resume_after_handoff` -> `form_inspect`

Expected:

| Tool | Expected status | Expected result | Expected continuation |
|---|---|---|---|
| `entry` | `gated` or `handoff_required` | no `result` payload | `can_continue: false`, `suggested_next_action: request_handoff` |
| `continue` | `handoff_required` or `direct` after resume | route back into the current page state | when the page is a form, `suggested_next_action: form_inspect` |
| `resume_after_handoff` | `resumed_verified` or `resumed_unverified` | continuation evidence is returned | the page should remain usable without restarting the browser session |
| `form_inspect` | `direct` | form sections and fields are visible again | `can_continue: true`, `suggested_next_action: verify_form` |

Expected handoff primitive output:

- `request_handoff` confirms `State: handoff_required` and records the human step that needs to happen next
- `mark_handoff_done` confirms `State: awaiting_reacquisition` and indicates the handoff is complete and ready to resume
- `resume_after_handoff` returns continuation evidence in its output, including a clear next action instead of blind success

## 4. Authenticated Workspace Thread

- URL: a logged-in dynamic workspace such as a chat thread or inbox
- Tools to call: `entry` -> `continue` -> `workspace_inspect` -> `select_live_item` -> `workspace_inspect` -> `draft_action` -> `workspace_inspect` -> `execute_action(mode=preview|confirm)` -> `verify_outcome`

Expected:

| Tool | Expected status | Expected result | Expected continuation |
|---|---|---|---|
| `entry` | `direct` or `warmup` | session-aware entry result | trust-aware next step |
| `continue` | direct or gated depending on page | route into the workspace-task flow | when the page is a workspace, `suggested_next_action: workspace_inspect` |
| `workspace_inspect` | `direct` | `task_kind: workspace`, live items, composer state, and blockers are present | `can_continue: true`, `suggested_next_action: select_live_item` or `draft_action` depending on state |
| `select_live_item` | `direct` | the active item changes by semantic label | `can_continue: true`, `suggested_next_action: workspace_inspect` |
| `draft_action` | `direct` | draft text is written without sending | `can_continue: true`, `suggested_next_action: workspace_inspect` |
| `execute_action(mode=preview)` | `direct` | preview is returned, send is not clicked | `can_continue: true`, `suggested_next_action: verify_outcome` |
| `execute_action(mode=confirm)` | `direct` | the send action only runs after explicit confirmation | `can_continue: true`, `suggested_next_action: verify_outcome` |
| `verify_outcome` | `direct` | delivery or the next stable post-send state is reported | `can_continue: true`, `suggested_next_action` points to the next remaining action |

Core path:

`entry -> continue -> workspace_inspect -> select_live_item -> workspace_inspect -> draft_action -> workspace_inspect -> execute_action(mode=preview|confirm) -> verify_outcome`

Phase 1 conservative points:

- selection prefers semantic item labels instead of coordinate clicks
- loading shells return `unresolved` instead of guessing a stable surface
- detail mismatches return `unresolved` with a recovery hint instead of trusting the selected row
- virtualized or off-window items return `not_in_visible_window` or `virtualized_window_changed` instead of coordinate fallback guessing
- irreversible actions require explicit confirmation
- Phase 1 `execute_action` only covers `send`

## 5. Resumed Workspace Thread

- URL: the same logged-in workspace after a human step or handoff
- Tools to call: `entry` -> `continue` -> `resume_after_handoff` -> `workspace_inspect`

Expected:

| Tool | Expected status | Expected result | Expected continuation |
|---|---|---|---|
| `entry` | `gated` or `handoff_required` | no `result` payload | `can_continue: false`, `suggested_next_action: request_handoff` |
| `continue` | `handoff_required` or `resumed` after resume | continuation evidence is returned | when the page is a workspace, `suggested_next_action: workspace_inspect` |
| `resume_after_handoff` | `resumed_verified` or `resumed_unverified` | the resumed page stays usable without restarting the browser session | the next step should be explicit |
| `workspace_inspect` | `direct` | workspace state is visible again | `can_continue: true`, `suggested_next_action` matches the current workspace state |
