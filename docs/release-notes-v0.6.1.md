# Grasp v0.6.1 — Parallelism Foundations

Grasp `v0.6.1` is a targeted maintenance release that formalizes the "Parallelism Foundations" promised in the `v0.6` vision. It moves task context management from a hidden internal state to an explicit, verifiable, and isolated runtime capability.

## What is new?

### Task-Aware Auditing
The `audit` mechanism is no longer just a flat file-append logger. It now recognizes the `activeTaskId` from the runtime state and synchronously pushes action history into the corresponding task frame. This ensures that every task has its own verifiable audit trail that persists for the duration of the runtime session.

### Explicit Task Management
Two new tools have been added to the public MCP surface:
- `list_tasks`: Allows agents to see all currently tracked task contexts, their kinds, and which one is active.
- `switch_task`: Allows agents to create new task frames or switch the active context, enabling clean handoffs between different workflows without state pollution.

### Physical History Isolation
We have added a new integration suite (`tests/server/integrated-task-isolation.test.js`) that verifies physical isolation. It confirms that operations performed under Task A never appear in the history of Task B, even when interleaved.

### Improved Testability
The `registerActionTools` refactor now supports dependency injection for `navigateTo` and `syncPageState`, allowing the runtime to be tested in deep isolation without requiring a live browser for core logic verification.

## Why it matters

A true Agent Web Runtime must be able to handle more than one task at a time without collapsing into a single-site automation assumption. By isolating history and providing explicit task-switching tools, Grasp `v0.6.1` establishes the engineering foundations for parallel agentic workflows.

## How to use it

1. Call `list_tasks` to see current tasks.
2. Use `switch_task(taskId="my-new-task")` to start a new context.
3. Every subsequent `navigate`, `click`, or `type` will be recorded specifically into that task's history.
4. Call `list_tasks` again to verify the audit count for that specific frame.
