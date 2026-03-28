# Route by Evidence Smoke Paths

These are the recorded live smoke workflows for the current Route by Evidence slice. The runs below were executed on 2026-03-28 against the local `chrome-grasp` profile with Chrome/CDP attached. They are smoke checks, not universal guarantees.

## Live Run Snapshot

| URL | Intent | Observed mode | Time to useful output | Key evidence | Outcome |
|---|---|---|---|---|---|
| `https://example.com/` | `extract` | `public_read` | `2075 ms` | `extract` returned a usable summary | pass |
| `https://httpbin.org/forms/post` | `submit` | `form_runtime` | `3389 ms` | `page_role=form`, `next=form_inspect` | pass |
| `https://mp.weixin.qq.com/` | `extract` | `live_session` | `5216 ms` | `inspect` resolved into `cgi-bin/home` inside the local profile | pass |
| `https://mp.weixin.qq.com/cgi-bin/message?...` | `workspace` | `workspace_runtime` | `4616 ms` | `continue` returned `workspace_inspect`, `workspace_inspect` summarized `Workspace list • no active item` | pass |
| `https://www.scrapingcourse.com/cloudflare-challenge` | `extract` | `handoff -> public_read` | `3344 ms` | `entry` gated into handoff, `resume_after_handoff` returned `resumed_verified`, `extract` succeeded | pass |

---

## 1. Public URL -> Useful Output Fast

**Goal**

Prove that Grasp does not force a live browser-heavy path when the page is already public and readable.

**Target route**

- `public_read`

**Suggested flow**

- `entry(url, intent="extract")`
- `inspect`
- `extract`
- `explain_route`

**Expected signals**

| Step | What to look for |
|---|---|
| `entry` | `meta.route.selected_mode = public_read` |
| `entry` | `meta.route.next_step = extract` |
| `extract` | usable content payload with `summary` and `main_text` |
| `explain_route` | explains that the selected mode was `public_read` and shows a bounded fallback such as `live_session` |

**What this proves**

- one URL gets a route decision before work starts
- public reads do not need to pretend they are workspace automation
- the fallback boundary is explicit instead of hidden trial and error

---

## 2. Public Form -> Route Into Form Runtime

**Goal**

Prove that Grasp does not collapse a real form into a generic content path.

**Live page used**

- `https://httpbin.org/forms/post`

**Target route**

- `form_runtime`

**Executed flow**

- `entry(url, intent="submit")`
- `inspect`
- `explain_route`

**Observed signals**

| Step | What appeared |
|---|---|
| `entry` | `meta.route.selected_mode = form_runtime` |
| `entry` | `meta.route.next_step = form_inspect` |
| `inspect` | `meta.page.page_role = form` |
| `explain_route` | explains `real_form` with bounded fallback `handoff` |

**What this proves**

- form intent is routed before any submit attempt
- the runtime can expose form-specific next steps without guessing
- `handoff` stays available as the bounded fallback for blocked or sensitive steps

---

## 3. Logged-In Page -> Reuse Live Session

**Goal**

Prove that Grasp can route a task into the current authenticated browser context instead of treating every page like a public extraction target.

**Target route**

- `live_session`

**Live page used**

- `https://mp.weixin.qq.com/`

**Executed flow**

- `entry(url, intent="extract")`
- `inspect`
- `explain_route`

**Expected signals**

| Step | What to look for |
|---|---|
| `entry` | `meta.route.selected_mode = live_session` |
| `inspect` | current page resolved to `https://mp.weixin.qq.com/cgi-bin/home?...` inside the local profile |
| `inspect` | current route metadata is still present |
| `explain_route` | explains why the route stayed in the live runtime instead of switching to `public_read` |

**What this proves**

- route choice respects authenticated browser state
- the runtime can keep route state across `entry`, `inspect`, and `explain_route`
- users do not have to reason about internal providers

---

## 4. Dynamic Workspace -> Route Into Workspace Runtime

**Goal**

Prove that Grasp can route a real authenticated workspace into the workspace runtime instead of treating it as generic logged-in content.

**Live page used**

- `https://mp.weixin.qq.com/cgi-bin/message?t=message/list&count=20&day=7&token=...&lang=zh_CN`

**Target route**

- `workspace_runtime`

**Executed flow**

- `entry(url, intent="workspace")`
- `continue`
- `workspace_inspect`
- `explain_route`

**Observed signals**

| Step | What to look for |
|---|---|
| `entry` | `meta.route.selected_mode = workspace_runtime` |
| `entry` | `meta.route.next_step = workspace_inspect` |
| `continue` | `suggested_next_action = workspace_inspect` |
| `workspace_inspect` | `Summary: Workspace list • no active item` |
| `workspace_inspect` | continuation advances to `select_live_item` |
| `explain_route` | explains `dynamic_workspace` with bounded fallback `handoff` |

**What this proves**

- workspace intent can be recognized on a real authenticated page
- Grasp can move from route selection into workspace-specific task flow
- workspace mode is separate from generic `live_session`

---

## 5. Handoff -> Resume Into Direct Continuation

**Goal**

Prove that handoff is a first-class route outcome and that the runtime can resume with evidence after a real human step.

**Live page used**

- `https://www.scrapingcourse.com/cloudflare-challenge`

**Target route**

- `handoff`, then resume into the next direct route

**Executed flow**

- `entry(url, intent="extract")`
- `request_handoff`
- human completes the challenge in the current `chrome-grasp` page
- `mark_handoff_done`
- `resume_after_handoff`
- `continue`
- `extract`
- `explain_route`

**Observed signals**

| Step | What to look for |
|---|---|
| `entry` | `meta.route.selected_mode = handoff` |
| `entry` | `meta.error_code = ROUTE_BLOCKED` |
| `request_handoff` | state moves to `handoff_required` |
| `mark_handoff_done` | state moves to `awaiting_reacquisition` |
| `resume_after_handoff` | `Resume state: resumed_verified` |
| `resume_after_handoff` | continuation checks pass for URL and `page_role = content` |
| `continue` | status becomes `resumed` with `can_continue = true` |
| `extract` | returns `Cloudflare Challenge You bypassed the Cloudflare challenge` |
| `explain_route` | the original route rationale still shows why handoff was required before the human step |

**What this proves**

- handoff is part of the product path, not a silent failure
- challenge pages can be blocked early with evidence instead of blind retries
- after the human step, resume stays evidence-backed instead of pretending success
