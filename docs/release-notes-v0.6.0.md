# Grasp v0.6.0 — Route by Evidence

**Theme:** `Route by Evidence / 证据选路`

**Product line:** `One URL, one best path.`

## What shipped

`v0.6.0` makes route selection a first-class part of the product surface instead of leaving it as an internal browser decision.

Delivered in this slice:

- `entry(url, intent)` now returns a structured route decision
- public route modes are now explicit:
  - `public_read`
  - `live_session`
  - `workspace_runtime`
  - `form_runtime`
  - `handoff`
- route policy templates now distinguish:
  - `public_content`
  - `authenticated_content`
  - `dynamic_workspace`
  - `real_form`
  - `gated_handoff`
- route traces are now written to the audit log in a structured form
- `explain_route` and `grasp explain` now expose the latest route rationale
- `inspect`, `extract`, and `continue` now carry route metadata instead of only page/continuation state
- after a human completes a Cloudflare challenge, Grasp can resume into content instead of staying stuck in `checkpoint`

## What this release is trying to prove

This release is not about adding more raw browser tools.

It is trying to prove that Grasp can answer this question itself:

> given a URL and a task goal, which path should the agent take first?

That is the product boundary for this slice.

## What did not ship

`v0.6.0` does not claim:

- universal CAPTCHA bypass
- cloud browser infrastructure
- a provider marketplace
- a general scheduler or planner
- benchmark results that have not yet been measured on live runs

## Validation completed in this repo snapshot

- focused route-aware and explainability suite passes: `34 / 34`
- route policy selection is covered by unit tests
- route trace persistence is covered by unit tests
- `grasp explain` and `explain_route` are covered by tests
- gateway flow keeps route metadata across the main loop
- all five benchmark classes now have live runs recorded against the local `chrome-grasp` profile:
  - `https://example.com/` -> `public_read`
  - `https://httpbin.org/forms/post` -> `form_runtime`
  - `https://mp.weixin.qq.com/` -> `live_session`
  - `https://mp.weixin.qq.com/cgi-bin/message?...` -> `workspace_runtime`
  - `https://www.scrapingcourse.com/cloudflare-challenge` -> `handoff -> mark_handoff_done -> resume_after_handoff -> public_read`

## Publication Follow-Up

The release proof in this repo snapshot is complete. Remaining publication polish, if we want a richer external package:

- screenshots or GIFs for the recorded routes
- final release artifact pass across README, landing page, and examples together
