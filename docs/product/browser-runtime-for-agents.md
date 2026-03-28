# Route-Aware Agent Web Runtime

Grasp is a route-aware Agent Web Runtime. It gives agents one interface for choosing the best path, entering the page, inspecting state, acting, verifying, and resuming work on real webpages without collapsing the product into a single site, a single workflow, or a scraping-only story.

Showcase artifact: [Browser Runtime Landing](../browser-runtime-landing.html)

## What the product provides

- real-page entry on any webpage the browser can open
- route selection before execution starts
- an isolated `chrome-grasp` profile
- persistent browser sessions the agent can come back to
- basic multi-task runtime state
- verified browser actions
- evidence-backed handoff and resume
- one task model across real browser work and a thin public-web read seam

## Proof of the runtime

The smallest loop that proves Grasp is a runtime is:

```text
entry(url, intent)
inspect()
request_handoff(...)
mark_handoff_done()
resume_after_handoff()
continue()
```

If the same task can survive a human step and continue from evidence in the same browser context, the product is no longer just opening pages.

## Modes, not providers

The core promise is not a growing list of site-specific integrations. It is that any real webpage can be brought into the same runtime, routed, and worked through the same task model.

Public modes:

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Provider names stay internal. The public surface should explain the selected mode, the evidence behind it, and the fallback boundary.

The read path is currently still through the browser path and shared projection contract more often than a finished dual-engine product would be. In this slice, `Data Engine` is a thin read seam and selection direction, not a fully delivered separate backend:

- `Runtime Engine`: authenticated browser work, live sessions, navigation, handoff, and recovery
- `Data Engine`: public-web discovery and extraction when live browser control is not the right tool

This is the current product direction: one interface, with `Runtime Engine` first-class and `Data Engine` indicating the intended read split without overstating delivery. The product is not a scraping-only tool with browser wording layered on top, and it is not a browser-only story that ignores public-web reads.

## Delivery surfaces, not product identity

- Bootstrap: `npx grasp` or `grasp connect`
- Public runtime surface: MCP tools such as `entry`, `inspect`, `extract`, `continue`, and `explain_route`
- Recommended task layer: [Grasp skill](../../skill/SKILL.md)

`npx grasp` / `grasp connect` only bootstrap the local runtime. MCP tools are the public runtime surface. The skill is the recommended task-facing layer on top of the same interface. CLI, MCP, and the skill are delivery surfaces for the browser runtime, not separate product identities.

Bootstrap also establishes the local Chrome/CDP connection Grasp needs. That is a bootstrap concern, not a separate product layer users normally manage by hand.

## Where the moat comes from

Opening a page is easy. Keeping real web work continuous, verifiable, and recoverable is the hard part.

Grasp compounds around four things:

- `Continuity`: real-page work survives login state, checkpoint pages, and more than one task/session context over time
- `Verification`: actions are checked against actual page changes, not assumed from tool calls
- `Recovery`: one-time human intervention and resumed work in the same browser session are first-class, not edge cases
- `Route choice`: the runtime chooses the best path first instead of asking the user or agent to remember provider-level decisions

That is why Grasp is more than a convenience wrapper around browser automation. Publicly, it is the browser runtime for agents. If that runtime keeps compounding across real tasks, it becomes the operating layer agents rely on for real web work.

At the same time, not every read needs a live browser session. The Data Engine covers public-web discovery and extraction without turning the whole product into scraping.

## BOSS is an example, not the boundary

BOSS is one example on top of the browser runtime. It proves the runtime on a concrete workflow, but it does not define the boundary. The same product story also covers flows such as WeChat Official Accounts and Xiaohongshu when they need persistent login, isolated browser state, and recovery.

## What Grasp is saying

- it is the route-aware Agent Web Runtime agents can reuse on any real page
- it emphasizes real browsing, persistent sessions, verification, and recovery
- it exposes one interface with public modes over `Runtime Engine` and a thin `Data Engine` read seam
- it reaches users through CLI bootstrap, MCP, and a skill surface

## What Grasp is not saying

- it is not just a browser gateway
- it is not just `npx grasp`
- it is not limited to BOSS
- it is not a scraping-only product
- it is not a provider chooser the user has to reason about manually

For the exact tool surface, see [MCP Tools](../reference/mcp-tools.md).
