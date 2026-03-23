# AI Browser Gateway

Grasp's `v0.5.2` product position is to make the product feel like an AI browser gateway, not just a pile of browser primitives.

The core idea is simple:

- give the agent a persistent browser session it can come back to
- expose a public workflow that starts with the task, not with low-level element control
- keep evidence attached when the workflow has to pause, hand off, or resume

That is why the public surface now leads with four gateway tools:

- `entry` enters a URL with session-aware strategy
- `inspect` reports whether the page is readable, gated, or still waiting on recovery
- `extract` returns the page content in a form the caller can use
- `continue` decides the next step without firing a browser action

These tools sit on top of Grasp's existing runtime strengths:

- persistent `chrome-grasp` browser profile
- page-state sync and compact page understanding
- verified browser actions
- persisted handoff and resume flow

The product story matters because real web tasks are not only about clicking through a page once. They are about staying continuous across:

- login state
- checkpoint pages
- one-time human intervention
- resumed work in the same browser session

Phase 1 keeps the advanced runtime available, but it stops making those primitives the first thing users see. If you need lower-level control, it is still there. If you want the default path, start from the gateway workflow.

What Grasp is saying in this phase:

- it is an AI browser gateway for real web tasks
- it emphasizes session continuity, verified actions, and recoverable handoff
- it can guide the next step when a page is direct, warming up, gated, or waiting on resume

What Grasp is not saying:

- it bypasses every CAPTCHA or strong verification flow
- it guarantees autonomous completion on every site
- it replaces the need for evidence when deciding that a resumed task is safe to continue

For the exact tool surface, see [MCP Tools](../reference/mcp-tools.md).
