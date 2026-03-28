# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.6.0-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.md#quickstart)
> **Grasp is a route-aware Agent Web Runtime. One URL, one best path.**

Grasp runs locally, keeps a dedicated `chrome-grasp` profile, and gives agents a persistent, recoverable web runtime instead of disposable tabs and one-off scripts. The product promise in `v0.6.0` is simple: given a URL and an intent, Grasp should choose the best path first, keep that decision explainable, and continue on the same runtime path.

- Current package release: `v0.6.0`
- Start here: [Browser Runtime Landing](./docs/browser-runtime-landing.html)
- Public docs for the runtime surface: [docs/README.md](./docs/README.md)
- Release notes: [docs/release-notes-v0.6.0.md](./docs/release-notes-v0.6.0.md)

---

## Where the moat comes from

Anyone can open a page. Very few systems can keep real web work continuous, verifiable, and recoverable.

Grasp compounds around the parts that are hard to fake:

- `Continuity`: tasks survive login state, checkpoint pages, and context switching instead of restarting from scratch
- `Verification`: actions are checked against actual page changes instead of being treated as success by default
- `Recovery`: humans can step in and agents can resume in the same browser context with evidence

That is why Grasp is not just a browser automation wrapper. Over time, that is how a browser runtime becomes the operating layer agents rely on for real web work.

## Route by Evidence

Users should not need to remember whether this URL belongs on a public reader, a live authenticated session, a workspace flow, a real form flow, or a handoff path.

That route choice is the product.

Public modes:

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Provider choice stays internal. Users and agents should reason about modes and evidence, not about which package or adapter happens to run underneath.

## Proof of the runtime

```text
entry(url, intent)
inspect()
request_handoff(...)
mark_handoff_done()
resume_after_handoff()
continue()
```

If the same task can survive a human step, return to the same browser context, and continue from evidence instead of replaying from scratch, the product has crossed from browser wrapper into runtime.

What it does not claim:

- universal CAPTCHA bypass
- guaranteed full autonomy on every gated site
- evidence-free recovery
- that any one workflow defines the whole product

---

## Quickstart

### 1. Bootstrap Grasp locally

```bash
npx grasp
```

This detects Chrome, launches the dedicated `chrome-grasp` profile, and helps you connect your AI client.

If you already have the CLI installed, `grasp connect` does the same local bootstrap step.

Bootstrap also establishes the remote-debugging/CDP connection Grasp needs. In the normal local path, users do not need to prepare that separately.

### 2. Connect your client

Claude Code:

```bash
claude mcp add grasp -- npx -y grasp
```

Claude Desktop / Cursor:

```json
{
  "mcpServers": {
    "grasp": {
      "command": "npx",
      "args": ["-y", "grasp"]
    }
  }
}
```

Codex CLI:

```toml
[mcp_servers.grasp]
type = "stdio"
command = "npx"
args = ["-y", "grasp"]
```

### 3. Get your first win

Tell your AI to:

1. call `get_status`
2. use `entry` on a real page with an intent such as `extract` or `workspace`
3. call `inspect`, then `extract` or `continue`
4. call `explain_route` or run `grasp explain`

The first win is not just that Grasp opens a page. It is that the agent can choose a route, explain why, and stay inside the same runtime when the task gets real.

Reference: [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
Manual smoke playbook: [docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

---

## Runtime Workflows

### Real browsing first

Start from the real page and the real session whenever possible. Grasp should read and act on the current browser state before falling back to heavier observation or search-like shortcuts.

### Public read

Use `entry(url, intent="extract")` -> `inspect` -> `extract` when the page is public and already readable.

What you get:

- route decision
- current page status
- readable content
- a suggested next action

### Live session

Use `entry(url, intent="act")` or `entry(url, intent="workspace")` when the task depends on the current browser session.

`entry` can now surface route evidence such as:

- selected mode
- confidence
- fallback chain
- whether a human is required

### Handoff and resume

When a human step is required, keep the workflow continuous instead of pretending it is fully autonomous:

1. `entry` or `continue` shows the page is gated
2. `request_handoff` records the required human step
3. `mark_handoff_done` marks the step complete
4. `resume_after_handoff` reacquires the page with continuation evidence
5. `continue` decides what should happen next

Runtime story: [docs/product/browser-runtime-for-agents.md](./docs/product/browser-runtime-for-agents.md)

---

## Product Model

### How the layers fit

The product is the route-aware Agent Web Runtime itself. `npx grasp` / `grasp connect` bootstrap it locally, MCP tools expose the public runtime surface, and the skill is the recommended task-facing layer on top of the same runtime.

For the canonical delivery-surface mapping, see [Browser Runtime for Agents](./docs/product/browser-runtime-for-agents.md).

### Modes, not providers

Grasp keeps a single agent-facing interface. The core promise is not a collection of site integrations; it is that any real webpage can be entered, routed, and worked through the same task model.

The public surface should expose modes, not provider names:

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Provider and adapter choice stays internal. In this slice, `Runtime Engine` remains first-class and `Data Engine` remains a thin read seam for public-web extraction without claiming a fully delivered separate backend.

---

## Real Forms

When the page is a real form, use the specialized form surface:

`form_inspect` -> `fill_form` / `set_option` / `set_date` -> `verify_form` -> `safe_submit`

The default behavior is conservative:

- `fill_form` only writes safe fields
- `review` and `sensitive` fields stay visible so you can inspect them explicitly
- `safe_submit` starts with preview, so you can check blockers before any real submit

Form surface reference: [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## Authenticated Workspaces

Use `workspace_inspect` to inspect a dynamic authenticated workspace and let it suggest the
next step. A typical loop is `workspace_inspect -> select_live_item -> workspace_inspect ->
draft_action -> workspace_inspect -> execute_action -> verify_outcome`. By default Grasp drafts
first, requires explicit confirmation for irreversible actions, and verifies that the workspace
really moved to the next state.

Workspace surface reference: [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

These workspace flows are examples of the browser runtime in use. BOSS is one example, and the same runtime direction also covers surfaces such as WeChat Official Accounts and Xiaohongshu without collapsing the whole product into any one workflow.

### Basic parallel task state

Grasp does not promise a large scheduler today, but it is moving toward handling more than one task/session context without collapsing everything into one active browser assumption.

---

## Advanced Runtime Primitives

The runtime surface is the public default. The lower-level runtime is still available when you need tighter control.

Common advanced primitives:

- navigation and state: `navigate`, `get_status`, `get_page_summary`
- interaction map: `get_hint_map`
- verified actions: `click`, `type`, `hover`, `press_key`, `scroll`
- observation: `watch_element`
- session strategy and handoff helpers: `preheat_session`, `navigate_with_strategy`, `session_trust_preflight`, `suggest_handoff`, `request_handoff_from_checkpoint`, `request_handoff`, `mark_handoff_in_progress`, `mark_handoff_done`, `resume_after_handoff`, `clear_handoff`

Full reference: [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## CLI

| Command | Description |
|:---|:---|
| `grasp` / `grasp connect` | Set up the local browser runtime |
| `grasp status` | Show connection state, current tab, and recent activity |
| `grasp explain` | Explain the latest route decision |
| `grasp logs` | View audit log (`~/.grasp/audit.log`) |
| `grasp logs --lines 20` | Show the last 20 log lines |
| `grasp logs --follow` | Stream the audit log |

## Docs

- [docs/README.md](./docs/README.md)
- [Browser Runtime Story](./docs/product/browser-runtime-for-agents.md)
- [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
- [docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

## Releases

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/release-notes-v0.6.0.md](./docs/release-notes-v0.6.0.md)
- [docs/release-notes-v0.55.0.md](./docs/release-notes-v0.55.0.md)

## License

MIT — see [LICENSE](./LICENSE).

## Star History

[![Star History Chart](./star-history.svg)](https://star-history.com/#Yuzc-001/grasp&Date)
