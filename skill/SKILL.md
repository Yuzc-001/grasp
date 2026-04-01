---
name: grasp
description: Use when an agent needs the visible local Grasp browser runtime for multi-step web tasks or public-web extraction through one interface: confirm the runtime instance, enter URLs, inspect/extract/share page content, switch visible tabs, interact with live pages, fill forms, operate authenticated workspaces, capture screenshots, and recover through handoff after login or CAPTCHA checkpoints.
---

# Grasp

## When to use

- The task needs a real browser session, not a one-shot headless script
- The work depends on persistent login state, a visible browser window, or human handoff/recovery
- The agent needs one interface for page entry, extraction, share/export, forms, workspace actions, screenshots, and low-level browser control
- The agent must know which runtime instance it is acting on, or it needs to switch between user-visible tabs safely

## Safe defaults

- Treat Grasp as the browser runtime surface. Use MCP tools for page actions instead of recreating interactions in shell scripts.
- Start with `get_status`. Before page-changing actions, prefer `confirm_runtime_instance(display="windowed")` or confirm the mode you actually expect.
- If a tool returns `INSTANCE_CONFIRMATION_REQUIRED`, confirm the instance and retry the same action.
- For first arrival to a URL, prefer `entry(url, intent)`. Use `navigate(url)` only when you intentionally want to move the current page directly.
- Prefer the high-level surfaces first: runtime loop, form tools, and workspace tools. Drop to hint map, tabs, cookies, dialogs, or `evaluate` only when the higher-level path is not enough.
- Prefer `list_visible_tabs` / `select_visible_tab` before raw tab primitives such as `get_tabs` or `switch_tab`.
- Refresh `get_hint_map` after navigation, a page-changing click, a visible DOM change, or scroll-loaded content. Old hint IDs are not safe to reuse after the page changes.
- Use the handoff flow when the task is blocked by login, CAPTCHA, checkpoints, or other human-only steps.
- If local CDP is unreachable, Grasp may auto-launch local Chrome or Edge now. If that still does not recover the runtime, ask the user to run `npx grasp`, `grasp connect`, or `start-chrome.bat` on Windows.

## Recommended workflow

1. `get_status`
2. `confirm_runtime_instance` when the task needs a confirmed live instance
3. `entry(url, intent)`
4. `inspect`
5. Follow the task surface that matches the job:
   - `extract` / `extract_structured` / `extract_batch` / `share_page` / `continue`
   - `form_inspect`
   - `workspace_inspect`
6. Use `explain_route` when the route choice needs explanation
7. If blocked, use handoff and then resume with `continue`

## Task surfaces

### Public web and extraction

Use `entry(..., intent="extract" | "read")`, then stay on `inspect`, `extract`, `extract_structured`, `extract_batch`, `share_page`, `explain_share_card`, and `continue` as long as the runtime surface is enough.

### Forms

Use `form_inspect -> fill_form / set_option / set_date -> verify_form -> safe_submit`.

### Authenticated workspaces

Use `workspace_inspect -> select_live_item -> draft_action -> execute_action -> verify_outcome`.

### Lower-level control

Only when the higher-level surface is not enough, use `get_hint_map`, `click`, `type`, `hover`, `scroll`, `scroll_into_view`, `screenshot`, `wait_for`, raw tab tools, cookies, dialogs, file upload, drag-and-drop, and `evaluate`.

## Additional resources

- Detailed tool selection, examples, troubleshooting, and compatibility notes: [references/tools.md](references/tools.md)
- Product framing for the runtime model: [Browser Runtime for Agents](../docs/product/browser-runtime-for-agents.md)
