## Example Client Configs

Use these examples when you want to connect an AI client to the local Grasp runtime:

- `claude-desktop.json` for Claude Desktop / Cursor style JSON MCP config
- `codex-config.toml` for Codex CLI TOML MCP config

All examples point to the same local runtime entry:

```text
command = npx
args    = -y grasp
```

Set up the runtime first with:

```bash
npx grasp
```

## Hero Demo Intent Mapping

These examples are not only config snippets. They map to the current Route by Evidence live smoke routes:

- public URL (`https://example.com/`) -> `public_read`
- public form (`https://httpbin.org/forms/post`) -> `form_runtime`
- logged-in task page (`https://mp.weixin.qq.com/`) -> `live_session`
- authenticated workspace (`https://mp.weixin.qq.com/cgi-bin/message?...`) -> `workspace_runtime`
- blocked challenge page (`https://www.scrapingcourse.com/cloudflare-challenge`) -> `handoff`, then `resume_after_handoff`

The demo goal is not “show more tools.” It is “show that one URL gets one best path first.”
