# Agent Web Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved Agent Web Runtime product direction into the next `v0.6` implementation slice without collapsing back into a single-site tool or a scrape-only product.

**Architecture:** Keep the current runtime foundation, task/session metadata, and BOSS fast path. Add only the missing pieces needed to make the product feel broad and principled: a shared projection contract, a generic entry orchestrator, and a thin engine-selection seam on the read surface. Keep the slices independent and avoid adding new product surfaces that the approved spec did not require.

**Tech Stack:** Node.js, Playwright over CDP, MCP SDK, existing Grasp server/runtime modules, Markdown docs, Node test runner.

---

## Scope Note

The approved spec includes `basic parallel task foundations`. That capability is already present in the current codebase through task frames, task metadata, and the runtime task surface. This plan does not add a new scheduler or new parallel APIs. Instead, it treats those foundations as protected baseline behavior and keeps them covered in the final regression pass through:

- [x] `tests/server/task-frame-runtime.test.js`
- [x] `tests/server/tools.task-surface.test.js`
- [x] `tests/server/integrated-task-isolation.test.js`
- [x] `tests/server/workspace-runtime.test.js`
- [x] `tests/server/workspace-tasks.test.js`

## File Structure

### Product positioning

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/README.md`
- Modify: `docs/product/browser-runtime-for-agents.md`
- Modify: `skill/SKILL.md`

### Shared projection contract

- Create: `src/server/page-projection.js`
- Create: `src/server/engine-selection.js`
- Modify: `src/server/content.js`
- Modify: `src/server/fast-path-router.js`
- Modify: `src/server/tools.gateway.js`
- Modify: `src/server/tools.actions.js`
- Create: `src/server/tools.task-surface.js`
- Create: `tests/server/page-projection.test.js`
- Create: `tests/server/engine-selection.test.js`
- Modify: `tests/server/tools.gateway.test.js`
- Modify: `tests/server/tools.actions.test.js`
- Create: `tests/server/task-frame-runtime.test.js`
- Create: `tests/server/tools.task-surface.test.js`
- Create: `tests/server/handoff-task-metadata.test.js`

### Generic entry orchestration

- Create: `src/server/entry-orchestrator.js`
- Modify: `src/server/tools.strategy.js`
- Modify: `src/layer1-bridge/chrome.js`
- Create: `tests/server/entry-orchestrator.test.js`

## Task 1: Publish the Agent Web Runtime product story

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/README.md`
- Modify: `docs/product/browser-runtime-for-agents.md`
- Modify: `skill/SKILL.md`

- [ ] **Step 1: Write the failing doc checklist**

Lock the checklist in the task notes:

- product is described as `Agent Web Runtime`
- the story does not collapse into BOSS
- the story does not collapse into scraping
- docs explain `Runtime Engine` and `Data Engine` as one interface, two backends
- CLI/MCP/Skill are framed as delivery surfaces, not product identity

- [ ] **Step 2: Verify the current docs fail the full checklist**

Run:

```bash
Select-String -Path README.md,README.zh-CN.md,docs/README.md,docs/product/browser-runtime-for-agents.md,skill/SKILL.md -Pattern "BOSS is one example|browser runtime|runtime engine|data engine|scrap"
```

Expected: some of the desired phrases are missing, especially the dual-engine framing.

- [ ] **Step 3: Rewrite the docs with the smallest possible scope**

Make the docs say:

- Grasp is an Agent Web Runtime
- Runtime Engine handles authenticated browser work
- Data Engine handles public-web discovery and extraction
- BOSS, WeChat Official Accounts, and Xiaohongshu are examples, not product boundaries

- [ ] **Step 4: Re-run the doc check**

Run:

```bash
Select-String -Path README.md,README.zh-CN.md,docs/README.md,docs/product/browser-runtime-for-agents.md,skill/SKILL.md -Pattern "Agent Web Runtime|Runtime Engine|Data Engine"
```

Expected: matches exist in all product-facing entry docs.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-CN.md docs/README.md docs/product/browser-runtime-for-agents.md skill/SKILL.md
git commit -m "docs: publish agent web runtime story"
```

## Task 2: Normalize the read surface with projection and engine metadata

**Files:**
- Create: `src/server/page-projection.js`
- Create: `src/server/engine-selection.js`
- Modify: `src/server/content.js`
- Modify: `src/server/fast-path-router.js`
- Modify: `src/server/tools.gateway.js`
- Modify: `src/server/tools.actions.js`
- Create: `tests/server/page-projection.test.js`
- Create: `tests/server/engine-selection.test.js`
- Modify: `tests/server/tools.gateway.test.js`
- Modify: `tests/server/tools.actions.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests that lock a single projection shape for the two read tools we already expose:

- `engine`
- `surface`
- `title`
- `url`
- `summary`
- `main_text`
- optional `markdown`

```js
assert.deepEqual(
  buildPageProjection({
    engine: 'runtime',
    surface: 'detail',
    title: 'Example',
    url: 'https://example.com',
    mainText: 'Hello world.',
  }),
  {
    engine: 'runtime',
    surface: 'detail',
    title: 'Example',
    url: 'https://example.com',
    summary: 'Hello world',
    main_text: 'Hello world.',
  }
);

assert.equal(
  selectEngine({ tool: 'extract', url: 'https://example.com/blog' }).engine,
  'data'
);

assert.equal(
  selectEngine({ tool: 'extract', url: 'https://mp.weixin.qq.com/' }).engine,
  'runtime'
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/server/page-projection.test.js tests/server/engine-selection.test.js tests/server/tools.gateway.test.js tests/server/tools.actions.test.js
```

Expected: FAIL because the projection and engine-selection helpers do not exist yet and the read tools are not aligned.

- [ ] **Step 3: Write the minimal implementation**

Create one projection helper and one engine-selection helper, then use them only in:

- `extract`
- `get_page_summary`

Keep the exact new metadata surface narrow:

- `result.engine`
- `result.surface`
- `result.title`
- `result.url`
- `result.summary`
- `result.main_text`
- optional `result.markdown`

Keep `get_page_summary` in `src/server/tools.actions.js` as the second and last consumer in this slice because it proves the projection contract is shared across both the gateway read path and the older action-facing summary path. Do not change unrelated workspace tools in this slice.

- [ ] **Step 4: Re-run the tests**

Run:

```bash
node --test tests/server/page-projection.test.js tests/server/engine-selection.test.js tests/server/tools.gateway.test.js tests/server/tools.actions.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/page-projection.js src/server/engine-selection.js src/server/content.js src/server/fast-path-router.js src/server/tools.gateway.js src/server/tools.actions.js tests/server/page-projection.test.js tests/server/engine-selection.test.js tests/server/tools.gateway.test.js tests/server/tools.actions.test.js
git commit -m "feat: normalize runtime read surface"
```

## Task 3: Add a generic entry orchestrator

**Files:**
- Create: `src/server/entry-orchestrator.js`
- Modify: `src/server/tools.strategy.js`
- Modify: `src/layer1-bridge/chrome.js`
- Create: `tests/server/entry-orchestrator.test.js`

- [ ] **Step 1: Write the failing tests**

Lock the generic strategy chain, without creating a site-specific public API:

- try `direct_goto` first when trust is high
- allow a second strategy such as `trusted_context_open` when direct entry is known to be unsafe
- stop after a verified success
- return evidence about `entry_method`, `final_url`, and `verified`

```js
assert.equal(result.entry_method, 'trusted_context_open');
assert.equal(result.verified, true);
assert.equal(result.final_url, 'https://example.com/app');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/server/entry-orchestrator.test.js
```

Expected: FAIL because the orchestrator module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create one small orchestrator that:

- accepts a target URL
- accepts a short ordered strategy list
- runs one strategy at a time
- verifies success by URL and page availability
- returns structured evidence

For `v0.6`, only implement the strategies needed now:

- `direct_goto`
- `trusted_context_open`

Do not build a full plugin system.

- [ ] **Step 4: Wire the orchestrator into the strategy tools**

Update `navigate_with_strategy` and `enterWithStrategy()` to use the orchestrator output while preserving current handoff/preheat logic. Keep the public result shape stable so `tools.gateway.js` does not need to change in this task.

- [ ] **Step 5: Re-run the tests**

Run:

```bash
node --test tests/server/entry-orchestrator.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/entry-orchestrator.js src/server/tools.strategy.js src/layer1-bridge/chrome.js tests/server/entry-orchestrator.test.js
git commit -m "feat: add generic entry orchestrator"
```

## Task 4: Final regression pass

**Files:**
- Test: `tests/server/page-projection.test.js`
- Test: `tests/server/entry-orchestrator.test.js`
- Test: `tests/server/engine-selection.test.js`
- Test: `tests/server/tools.gateway.test.js`
- Test: `tests/server/tools.actions.test.js`
- Test: `tests/cli/help.test.js`
- Test: `tests/server/handoff-task-metadata.test.js`
- Test: `tests/server/task-frame-runtime.test.js`
- Test: `tests/server/tools.task-surface.test.js`
- Test: `tests/layer1-bridge/chrome.reconnect.test.js`
- Test: `tests/server/state.sync-page.test.js`
- Test: `tests/server/workspace-runtime.test.js`
- Test: `tests/server/workspace-tasks.test.js`

- [ ] **Step 1: Run the focused server and script suite**

Run:

```bash
node --test tests/server/page-projection.test.js tests/server/entry-orchestrator.test.js tests/server/engine-selection.test.js tests/server/tools.gateway.test.js tests/server/tools.actions.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the intentionally broader runtime stability regression**

This second pass is intentionally wider than the changed-file list. Its purpose is to catch regressions in the existing runtime foundations that Task 2 and Task 3 sit on top of, especially task/session metadata, pinned target reuse, and handoff continuity.

Run:

```bash
node --test tests/cli/help.test.js tests/server/task-frame-runtime.test.js tests/server/handoff-task-metadata.test.js tests/server/tools.task-surface.test.js tests/layer1-bridge/chrome.reconnect.test.js tests/server/state.sync-page.test.js tests/server/workspace-runtime.test.js tests/server/workspace-tasks.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify agent web runtime slice"
```
