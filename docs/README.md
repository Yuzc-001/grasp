# Grasp Docs

Public docs for the Grasp route-aware Agent Web Runtime.

Current package release: `v0.6.7`

---

## Showcase

- [Browser Runtime Landing](./browser-runtime-landing.html)

If you want the fastest visual overview of the product, start there.

## Quickstart

- [Project README](../README.md)
- [中文 README](../README.zh-CN.md)

## Product Overview

- [Browser Runtime for Agents](./product/browser-runtime-for-agents.md)
- [Design Philosophy](./product/design-philosophy.md)

Core runtime story:

- one URL, one best path
- any real webpage can enter the same runtime
- continuity across login, handoff, and recovery
- visible runtime boundaries over a confirmed browser instance
- verified actions against real page state
- first structured extraction path on top of the same browser runtime
- batch structured extraction with CSV / JSON exports
- share artifacts and explainable share cards for human handoff
- resumed work in the same browser context
- one interface with public modes over `Runtime Engine` and a thin `Data Engine` read seam

The moat starts where most browser automation breaks: continuity, verification, recovery, and now route selection on real pages. BOSS is one example on top of the runtime, while the `Data Engine` wording here marks the public-web read direction without claiming a fully delivered separate backend in this slice.

Canonical proof loop:

- `entry` → `inspect` → `request_handoff` → `mark_handoff_done` → `resume_after_handoff` → `continue`

## Agent Surface

Read in this order:

1. bootstrap the local runtime
2. use MCP tools as the public runtime surface
3. use the skill when you want the recommended task-facing layer

For the canonical product-layer mapping, see [Browser Runtime for Agents](./product/browser-runtime-for-agents.md).

- [MCP Tools](./reference/mcp-tools.md)
- [Agent Skill](../skill/SKILL.md)

Supported agent clients in the current release surface:

- Claude Code
- Codex CLI
- Cursor / Claude Desktop style MCP clients
- Alma

## Reference

- [CHANGELOG](../CHANGELOG.md)
- [CONTRIBUTING](../CONTRIBUTING.md)

## Releases



- [CHANGELOG](../CHANGELOG.md)

- [v0.6.7 release notes](./release-notes-v0.6.7.md)

- [v0.6.3 release notes](./release-notes-v0.6.3.md)

- [v0.6.1 release notes](./release-notes-v0.6.1.md)
- [v0.6.0 release notes](./release-notes-v0.6.0.md)
- [v0.55.0 release notes](./release-notes-v0.55.0.md)
- [v0.5.2 release notes](./release-notes-v0.5.2.md)
