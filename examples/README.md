## Example Client Configs



### Run a real-business smoke check



If your local `chrome-grasp` runtime is already exposing CDP on `http://localhost:9222`, you can run:



```bash

node examples/business-qa.js

```



This exercises the current business smoke routes against:



- `https://mp.weixin.qq.com/`

- `https://www.zhipin.com/`

- `https://www.scrapingcourse.com/cloudflare-challenge`



If CDP is not available yet, Grasp will stop early and tell you the runtime instance is unavailable.




Use these examples when you want to connect an AI client to the local Grasp runtime:

- `claude-desktop.json` for Claude Desktop / Cursor style JSON MCP config
- `codex-config.toml` for Codex CLI TOML MCP config
- Alma uses the same local MCP runtime entry model and can connect to the same dedicated browser runtime

All examples point to the same local runtime entry:

```text
command = npx
args    = -y grasp
```

Set up the runtime first with:

```bash
npx -y @yuzc-001/grasp
```

## Hero Demo Intent Mapping

These examples are not only config snippets. They map to the current Route by Evidence live smoke routes:

- public URL (`https://example.com/`) -> `public_read`
- public form (`https://httpbin.org/forms/post`) -> `form_runtime`
- logged-in task page (`https://mp.weixin.qq.com/`) -> `live_session`
- authenticated workspace (`https://mp.weixin.qq.com/cgi-bin/message?...`) -> `workspace_runtime`
- blocked challenge page (`https://www.scrapingcourse.com/cloudflare-challenge`) -> `handoff`, then `resume_after_handoff`

The demo goal is not “show more tools.” It is “show that one URL gets one best path first.”
