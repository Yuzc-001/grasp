# Grasp v0.5.2 Release Notes

日期：2026-03-23  
版本：`v0.5.2`

---

## Summary

`v0.5.2` is the release where Grasp stops looking like a pile of browser primitives and starts presenting itself as an AI browser gateway.

This release centers on three public task layers:
- gateway workflows for entering, reading, and continuing real web tasks
- safe real form tasks for filling and verifying visible forms conservatively
- dynamic authenticated workspace tasks for inspecting, drafting, guarded sending, and verifying outcomes

In short:

# Grasp v0.5.2 is about guided real web tasks, not raw browser control.

---

## What is new in v0.5.2

### 1. Gateway tools are now the public default
Grasp now leads with a gateway-first flow:
- `entry`
- `inspect`
- `extract`
- `continue`

The task starts from the target page and next-step decision, not from low-level element control.

### 2. Safe real form tasks are now first-class
Grasp now exposes a conservative form-task layer:
- `form_inspect`
- `fill_form`
- `set_option`
- `set_date`
- `verify_form`
- `safe_submit`

The defaults are intentionally careful:
- write only safe fields automatically
- keep review and sensitive fields visible
- preview submission before any real submit

### 3. Dynamic authenticated workspaces are now part of the product surface
Grasp now exposes a workspace-task layer for live authenticated interfaces:
- `workspace_inspect`
- `select_live_item`
- `draft_action`
- `execute_action`
- `verify_outcome`

This makes the product legible on real list-detail-composer style applications, not only on static pages.

### 4. Guardrails now sit closer to the task layer
The task layers now default to safer behavior:
- draft first
- preview first
- explicit confirmation for irreversible actions
- post-action verification instead of trusting the first signal

### 5. Public docs and package metadata now match the shipped product
The package, README surface, public docs index, and release links now point to `v0.5.2`.
Internal and obsolete planning docs were removed from the public docs surface.

---

## Real validation in v0.5.2

### Gateway flow validated
The gateway surface is now the default public path for:
- entering a URL
- checking whether the page is direct, gated, or waiting on recovery
- extracting content
- deciding the next step without firing a browser action

### Safe form-task flow validated
On real recruitment-style forms, Grasp now supports a guarded flow through:
1. `form_inspect`
2. `fill_form` / `set_option` / `set_date`
3. `verify_form`
4. `safe_submit`

This validates that Grasp can progress a real form task up to the pre-submit decision point without pretending every field or every submit should be automatic.

### Dynamic workspace flow validated
On authenticated workspace-style surfaces, Grasp now supports:
1. `workspace_inspect`
2. `select_live_item`
3. `draft_action`
4. `execute_action`
5. `verify_outcome`

This validates that Grasp can move through a real list-detail-composer loop with guarded send behavior and post-action outcome checks.

### Test status
Current automated test status:

# `174 / 174` passing

---

## What v0.5.2 does claim

Grasp v0.5.2 claims that:
- the agent can work through a persistent browser profile instead of throwaway sessions
- the default public surface starts from the task, not from raw browser primitives
- real forms can be filled and verified conservatively before submit
- authenticated workspace tasks can be inspected, drafted, guarded, and verified
- handoff and resume still remain part of the same continuous browser workflow

---

## What v0.5.2 does not claim

Grasp v0.5.2 does **not** claim:
- universal bypass of strong verification, CAPTCHA, or every checkpoint flow
- fully autonomous completion of every form or every messaging workflow
- perfect semantic understanding of every dynamic web application

The current state is better described as:

# guided, verified task progression on real web surfaces

not yet:

# universal full-autonomy browser execution

---

## Release significance

This release matters because it changes the shape of the product.

Before, Grasp was strongest as a browser runtime with real continuity.
Now it is presented as a product surface that can:
- guide the next step on real pages
- handle safe form progress instead of only raw element control
- operate inside authenticated workspaces with guarded actions
- keep continuity, evidence, and recovery attached to the task

That is the beginning of a real AI browser gateway.

---

## Recommended reading

For the current product position:
- `README.md`
- `docs/product/ai-browser-gateway.md`

For the current implementation milestone:
- `docs/reference/mcp-tools.md`
- `docs/reference/smoke-paths.md`
