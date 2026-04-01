# Grasp Reference

## 1. Bootstrap and instance confirmation

Recommended default order:

1. `get_status`
2. Check whether the runtime instance matches the browser session you expect
3. Before page-changing actions, call `confirm_runtime_instance`

Typical confirmation flow:

```text
get_status()
confirm_runtime_instance(display="windowed")
```

If `get_status` or another tool reports that CDP is unreachable:

- Grasp may now auto-launch local Chrome or Edge when the endpoint is local
- If the runtime still does not recover, ask the user to run:
  - `npx grasp`
  - `grasp connect`
  - `start-chrome.bat` on Windows

If tab identity is ambiguous:

- Use `list_visible_tabs`
- Then use `select_visible_tab`

Only drop to raw tab indices when you truly need them:

- `get_tabs`
- `switch_tab`
- `new_tab`
- `close_tab`

## 2. Intent selection

| intent | When to use it |
|---|---|
| `read` | Read-only browsing without page-changing actions |
| `extract` | Public-web reading, summary, or structured extraction |
| `act` | General interaction such as clicking, typing, switching, or selecting |
| `submit` | Filling and submitting forms |
| `workspace` | Operating authenticated dashboards, inboxes, chat panes, or back-office surfaces |
| `collect` | Visiting multiple URLs and extracting the same fields repeatedly |

## 3. Default workflows

### 3.1 Runtime loop

```text
get_status
confirm_runtime_instance   (when live actions need confirmation)
entry(url, intent)
inspect
extract / extract_structured / extract_batch / share_page / continue
explain_route              (when route choice matters)
```

### 3.2 Structured extraction

When the task is "turn this page into named fields", prefer:

```text
entry(url, intent="extract")
inspect
extract_structured(fields=[...])
```

For repeated extraction across multiple URLs:

```text
extract_batch(urls=[...], fields=[...])
```

### 3.3 Share and export

When the result should be handed to a human as an artifact rather than just returning raw page text:

```text
share_page(format="markdown" | "screenshot" | "pdf")
explain_share_card(width=640)
```

### 3.4 Forms

```text
form_inspect
fill_form(values={...})
set_option(field="Country", value="Germany")
set_date(field="Start date", value="2026-04-01")
verify_form
safe_submit(mode="preview")
safe_submit(mode="confirm", confirmation="SUBMIT")
```

### 3.5 Workspaces

```text
workspace_inspect
select_live_item(item="Conversation A")
draft_action(text="Hello, I have a question...")
execute_action(mode="preview")
execute_action(mode="confirm", confirmation="EXECUTE")
verify_outcome
```

### 3.6 Handoff and recovery

```text
inspect or continue
request_handoff(reason="captcha_required", note="Need human verification")
mark_handoff_done()
resume_after_handoff(verify=true)
continue()
```

## 4. Tool selection guide

| Need | Preferred tools | Notes |
|---|---|---|
| First arrival to a URL | `entry(url, intent)` | Default entry point; do not start with `navigate` unless you intentionally want a direct page jump |
| Directly change the current page URL | `navigate(url)` | Lower-level navigation path |
| Inspect current runtime status | `inspect` | Returns route, page state, and continuation hints |
| Quick current-page summary | `get_page_summary` | Lightweight read |
| Extract a concise page result | `extract` | Stay on the runtime path |
| Extract named fields from one page | `extract_structured` | Returns structured output and exports |
| Extract the same fields from many URLs | `extract_batch` | Writes CSV and JSON artifacts, plus optional Markdown |
| Export something shareable | `share_page` | `markdown`, `screenshot`, or `pdf` |
| Explain how a shared artifact would look | `explain_share_card` | Useful before exporting |
| Explain why the runtime chose a route | `explain_route` | Good for gated or surprising route choices |
| Decide what should happen next without acting | `continue` | Best after inspection or recovery |
| Read visible tabs from the active runtime | `list_visible_tabs` / `select_visible_tab` | Prefer these over raw indices |
| Raw tab control | `get_tabs` / `switch_tab` / `new_tab` / `close_tab` | Use when index-level control is required |
| Inspect a form | `form_inspect` | Starting point for the form surface |
| Fill text-like form fields | `fill_form` | Uses a label-to-value map |
| Set selects, radios, and other option controls | `set_option` | Use after `form_inspect` when control type matters |
| Set date controls | `set_date` | Use ISO-like values |
| Re-check missing or risky form fields | `verify_form` | Best before submit |
| Preview or confirm form submission | `safe_submit` | `preview` first, `confirm` only when ready |
| Inspect an authenticated workspace | `workspace_inspect` | Starting point for the workspace surface |
| Switch active workspace item | `select_live_item` | Select by visible label |
| Draft text into the composer | `draft_action` | Writes without sending |
| Preview or execute a workspace send | `execute_action` | Use `preview` before `confirm` |
| Verify the workspace result after send | `verify_outcome` | Confirms what changed and what is next |
| Handle login or CAPTCHA checkpoints | `request_handoff` / `mark_handoff_done` / `resume_after_handoff` / `continue` | Keep continuity instead of restarting |
| Find interactable targets | `get_hint_map` | Refresh after page changes |
| Click, type, or hover | `click` / `type` / `hover` | Preferred low-level interactions |
| Scroll a known target into view | `scroll_into_view` | Better than guessing pixels |
| Scroll the page or a nested container | `scroll` | Supports `up`, `down`, `left`, `right`, and `hint_id` targeting |
| Wait for text, hidden text, or URL changes | `wait_for` | Uses one condition at a time |
| Wait for DOM selector changes | `watch_element` | Use when you know a CSS selector |
| Visual verification | `screenshot` | Full page, element clip, or annotated viewport |
| Keyboard actions | `press_key`, `key_down`, `key_up` | Use `key_down` / `key_up` for combos |
| Checkbox or radio state | `check` | Idempotent checked/unchecked control |
| Double-click | `double_click` | Lower-level pointer action |
| Handle browser dialogs | `handle_dialog` | For alert, confirm, or prompt |
| Upload files | `upload_file` | Uses an absolute file path array |
| Drag and drop | `drag` | Lower-level pointer flow |
| Read browser console output | `get_console_logs` | Great for debugging live pages |
| Run custom page JavaScript | `evaluate` | Escape hatch; prefer specialized tools first |
| Read or mutate cookies | `get_cookies` / `set_cookie` / `clear_cookies` | Useful for debugging session state |

## 5. Hint Map rules

- `B*`: buttons
- `I*`: inputs
- `L*`: links
- `S*`: selects

Old hint IDs may be invalid after:

- navigation
- a click that changes the page
- a visible DOM update
- a tab switch
- scroll-loaded content
- form submission or workspace state changes

Practical rule:

- Get a hint map before interaction
- Rebuild the hint map after any visible page change
- If you only need visual confirmation, prefer `screenshot` instead of forcing a new hint map

## 6. Common scenarios

### 6.1 Read a public page

```text
entry("https://example.com/article", "extract")
inspect()
extract()
```

### 6.2 Act inside a logged-in page

```text
get_status()
confirm_runtime_instance(display="windowed")
entry("https://app.example.com/dashboard", "act")
inspect()
screenshot(annotate=true)
click(hint_id="B3")
get_hint_map()
```

### 6.3 Fill a form

```text
entry("https://example.com/apply", "submit")
form_inspect()
fill_form(values={"Full name":"Taylor Doe","Email":"taylor@example.com"})
set_option(field="Country", value="Germany")
set_date(field="Start date", value="2026-04-01")
verify_form()
safe_submit(mode="preview")
```

### 6.4 Operate a workspace

```text
entry("https://app.example.com/inbox", "workspace")
workspace_inspect()
select_live_item(item="Priority thread")
draft_action(text="Hello, following up on this request...")
execute_action(mode="preview")
verify_outcome()
```

### 6.5 Recover after login or CAPTCHA

```text
entry("https://protected-site.example", "act")
inspect()
request_handoff(reason="captcha_required", note="Need human verification")
mark_handoff_done()
resume_after_handoff(verify=true)
continue()
```

### 6.6 Work across multiple tabs

```text
list_visible_tabs()
select_visible_tab(query="docs")
extract()
new_tab(url="https://docs.example.com")
get_tabs()
switch_tab(index=0)
close_tab(index=1)
```

### 6.7 Scroll inside a nested container

```text
get_hint_map()
scroll_into_view(hint_id="L15")

# or step through the scrollable ancestor
scroll(direction="down", hint_id="L15", amount=200)
get_hint_map()
```

## 7. Compatibility and legacy tools

These tools still exist for older flows or edge cases, but they are not the preferred path for new tasks:

| Tool | Use it only when |
|---|---|
| `confirm_click` | You are intentionally using the older safe-mode click flow and need to bypass its confirmation gate |
| `get_form_fields` | You are working with an older hint-first form workflow rather than the newer form surface |
| `get_logs` | You need the Grasp audit log rather than browser console output |
| `call_webmcp_tool` | The current page exposes a native WebMCP API and that lower-level integration is truly needed |

If you are not sure, prefer the route-aware runtime surface plus the current form/workspace tools described above.

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| `connected: false` or `CDP_UNREACHABLE` | Retry `get_status`; Grasp may auto-launch local Chrome or Edge; if not, ask the user to run `npx grasp`, `grasp connect`, or `start-chrome.bat` |
| `INSTANCE_CONFIRMATION_REQUIRED` | Call `get_status`, then `confirm_runtime_instance(display="windowed")` or confirm the actual expected mode |
| `INSTANCE_CONFIRMATION_MISMATCH` | Stop and switch to the correct runtime instance before acting |
| `TAB_AMBIGUOUS` or `TAB_NOT_FOUND` | Use `list_visible_tabs` and refine `select_visible_tab(query=..., title_contains=..., url_contains=...)` |
| `get_hint_map` returns nothing useful | The page may still be loading, blocked, or not yet in an interaction-ready state; use `inspect` or `get_page_summary` |
| Click target disappeared after action | The page changed; call `get_hint_map` again |
| The target is inside a scrollable pane | Prefer `scroll_into_view`, then `scroll(..., hint_id=...)` if needed |
| A dialog blocks progress | Use `handle_dialog` |
| `wait_for` times out | Check the condition text or URL fragment and retry with a larger timeout only if the condition is really expected |
| `evaluate` returns `undefined` | The expression produced no return value; rewrite it as an expression that returns something |
| Cookie changes do not stick | Check `domain`, `path`, and whether they match the current page context |
