---
name: grasp
description: Use when an agent needs the Grasp route-aware Agent Web Runtime for real browser work or public-web extraction through one interface with public modes over the Runtime Engine and a thin Data Engine read seam. Requires the Grasp MCP server to be reachable; `npx grasp` or `grasp connect` can bootstrap the local runtime when needed.
---

# Grasp — Route-Aware Agent Web Runtime

Grasp gives the AI a route-aware web runtime backed by a persistent Chrome profile (`chrome-grasp`). Log in once; sessions survive every run, route decisions stay explainable, and work can be recovered after handoff.

## Bootstrap

Before any action, verify Chrome is reachable:

```
get_status  →  check "connected: true"
```

If not connected, ask the user to run:
```bash
npx grasp
# or: grasp connect
```

`npx grasp` / `grasp connect` only bootstrap the local runtime. MCP tools are the public runtime surface. This skill is the recommended task-facing layer on top of the same runtime.

That bootstrap step also establishes the local Chrome/CDP connection Grasp needs. Treat that as bootstrap plumbing, not as a separate manual prerequisite in the normal local path.

For the canonical product-layer mapping, see [Browser Runtime for Agents](../docs/product/browser-runtime-for-agents.md).

## Preferred Path

Use Grasp as a runtime, not a bag of tools.

```
1. entry(url, intent)      → choose the route and enter with evidence
2. inspect()               → see whether the page is readable or gated on that route
3. extract() or continue() → read content or choose the next step
4. explain_route()         → explain why that route was selected
5. if blocked              → handoff, resume, and continue in the same session
```

Repeat the loop until the task is done. Use `get_page_summary` or `screenshot` to verify results.

**Re-scan rule:** Call `get_hint_map` again after every navigation, click that loads a new page, or DOM change. Old hint IDs are invalid after any page update.

## Runtime Surface

The same interface keeps `Runtime Engine` first-class. In this slice, `Data Engine` is only a thin read seam and selection direction for public-web reads, while the current implementation still reads through the browser path and shared projection contract:

- `Runtime Engine` for authenticated browser work, live sessions, handoff, and recovery
- `Data Engine` for public-web discovery and extraction

That keeps the product from collapsing into either a single BOSS-style workflow or a scraping-only story, without overstating `Data Engine` as a fully delivered separate backend.

Public route modes:

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Use the public MCP tools first:

- `entry` enters a URL with intent and route evidence
- `inspect` reports whether the page is readable, gated, or still waiting on recovery
- `extract` returns the page content in a usable form
- `continue` decides the next step without firing a browser action
- `explain_route` explains why the runtime chose the current route

Prefer real browsing and the current live page/session before falling back to heavier observation or search-like shortcuts.

If the public runtime surface is enough, stay there. Do not drop to lower-level primitives just because they exist. The sections below are only for advanced control when the default runtime path is not enough.

## Lower-Level Primitives

The sections below describe lower-level runtime primitives and mode details. They sit beneath the public runtime surface above.

## Hint Map vs Screenshot

| Use `get_hint_map` | Use `screenshot` |
|---|---|
| Finding what to click/type | Verifying visual result |
| Navigation and interaction | CAPTCHA / visual-only content |
| Token-efficient perception | Confirming layout after action |

Hint Map costs 90%+ fewer tokens than raw HTML or screenshot OCR.

## Execution Modes

**Standard mode** (most pages): Hint Map + real input events via CDP.

**WebMCP mode** (pages exposing `window.__webmcp__`): `navigate` auto-detects it. Use `call_webmcp_tool` for native API calls. `get_status` shows current mode.

## Recovery

When a human step is required, keep the workflow continuous instead of restarting:

1. `request_handoff` records the required human step
2. `mark_handoff_done` marks the step complete
3. `resume_after_handoff` reacquires the page with continuation evidence
4. `continue` decides what should happen next

## Safety Mode

High-risk clicks (destructive buttons, payment confirms) are intercepted automatically when `GRASP_SAFE_MODE=true` (default). Use `confirm_click(hintId)` to proceed after reviewing.

## When Things Go Wrong

| Symptom | Fix |
|---|---|
| `get_hint_map` returns empty | Page still loading — call `get_page_summary` first, then retry |
| Element not found after click | Page navigated — call `get_hint_map` again to re-scan |
| Element exists but not clickable | It may be off-screen — `scroll("down")` then re-scan |
| `watch_element` times out | Action didn't trigger DOM change — check with `screenshot` |

## Full Tool Reference

For the public runtime surface and the lower-level runtime primitives that sit beneath it, see [docs/reference/mcp-tools.md](../docs/reference/mcp-tools.md).
