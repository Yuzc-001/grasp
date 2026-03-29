# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.6.1-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.zh-CN.md#快速开始)
> **Grasp 是一个会先选路的 Agent Web Runtime。One URL, one best path.**

Grasp 完全本地运行，使用专属的 `chrome-grasp` browser 配置目录，让智能体拥有持久、可恢复的网页运行时，而不是一次性标签页和单站点脚本。`v0.6.1` 的核心承诺很简单：给它一个 URL 和任务意图，它先选出最合适的路径，让这个决定可解释，并沿着同一条 runtime 路径继续执行。

- 当前包版本：`v0.6.1`
- 先看展示单页：[docs/browser-runtime-landing.html](./docs/browser-runtime-landing.html)
- 对外文档入口：[docs/README.md](./docs/README.md)
- 发布说明：[docs/release-notes-v0.6.1.md](./docs/release-notes-v0.6.1.md)

---

## 护城河从哪里来

打开网页不难。难的是让真实网页任务保持连续、可验证、可恢复。

Grasp 把能力积累在最难伪造的三个点上：

- `连续性`：任务跨登录态、检查点和上下文切换后仍能继续，而不是整段重来
- `可验证性`：动作要以真实页面状态变化为准，而不是默认“已经成功”
- `接力恢复`：人工可以中途接力，智能体也能带着证据回到同一浏览器上下文继续推进

这也是 Grasp 不只是浏览器自动化封装的原因。长期看，这正是 browser runtime 进一步长成 agents 在真实网页上的 operating layer 的路径。

## 证据选路

用户和 agent 不应该自己记住“这个 URL 应该走哪个 provider”。这件事应该由产品本身负责。

对外只暴露 mode，不暴露 provider：

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Provider 选择留在内部。用户看到的应该是路径、证据、风险和 fallback。

## 运行时已经成立的证明

```text
entry(url, intent)
inspect()
request_handoff(...)
mark_handoff_done()
resume_after_handoff()
continue()
```

如果同一个任务可以跨过人工步骤、回到同一浏览器上下文，并且基于证据继续推进，而不是从头重放，那它就已经不是浏览器封装，而是运行时。

它不承诺：

- 通用验证码绕过
- 所有高风控站点都能全自动完成
- 没有页面证据也能判断恢复成功
- 某一个 workflow 就等于整个产品

---

## 快速开始

### 1. 本地启动 Grasp

```bash
npx grasp
```

它会检测 Chrome，启动专属 `chrome-grasp` 浏览器配置目录，并帮助你把运行时接到 AI 客户端上。

如果你已经安装了 CLI，`grasp connect` 也可以完成同样的本地启动步骤。

Bootstrap 也会建立 Grasp 需要的 remote debugging / CDP 连接；在正常本地路径里，用户不需要额外手动准备这一层。

### 2. 接入客户端

Claude Code：

```bash
claude mcp add grasp -- npx -y grasp
```

Claude Desktop / Cursor：

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

Codex CLI：

```toml
[mcp_servers.grasp]
type = "stdio"
command = "npx"
args = ["-y", "grasp"]
```

### 3. 拿到第一次真实成功

让你的 AI 先做这四步：

1. 调用 `get_status`
2. 在一个真实页面上带着 `intent` 调用 `entry`
3. 调用 `inspect`，然后走 `extract` 或 `continue`
4. 调用 `explain_route` 或运行 `grasp explain`

第一次成功不只是“它能打开网页”，而是智能体已经能先选路、解释原因，并在任务变真实时留在同一个 runtime 里继续推进。

工具说明见：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
手工 smoke 路径见：[docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

---

## 运行时工作流

### 真实浏览优先

只要能进入真实页面和真实会话，就优先从当前浏览器状态读取和操作，而不是先退化成更重的观察链路或搜索式替代路径。

### 公开读取

页面已公开可读时，用 `entry(url, intent="extract")` -> `inspect` -> `extract`。

你会拿到：

- route decision
- 当前页面状态
- 可读取内容
- 建议的下一步动作

### 实时会话

当任务依赖当前登录态、真实工作台或表单流程时，用 `entry(url, intent="act" | "workspace" | "submit")` 先判路。

`entry` 现在会返回这类证据：

- 选中了哪个 mode
- 置信度是多少
- fallback 链路是什么
- 是否需要人工接力

### 接力与恢复

当流程必须有人来接一下时，不要假装系统已经全自动，而是把它纳入连续工作流：

1. `entry` 或 `continue` 发现页面受阻
2. `request_handoff` 记录人工步骤
3. `mark_handoff_done` 标记人工步骤完成
4. `resume_after_handoff` 带着延续性证据重新接回页面
5. `continue` 判断接下来该继续、等待，还是再次接力

运行时说明见：[docs/product/browser-runtime-for-agents.md](./docs/product/browser-runtime-for-agents.md)

---

## 产品模型

### 三层关系

产品本身是 route-aware Agent Web Runtime。`npx grasp` / `grasp connect` 负责在本地把它启动起来，MCP 工具是它的公共运行时接口，skill 是建立在同一运行时之上的推荐任务层。

CLI、MCP、skill 都只是同一运行时的交付面，不是彼此独立的产品定义。

### 看 mode，不看 provider

Grasp 面向智能体保持同一接口。它的核心承诺不是“对很多网站做了很多适配”，而是“任意真实网页都能进入同一套路由与任务模型”。

对外公开的是 mode，而不是 provider 名字：

- `public_read`
- `live_session`
- `workspace_runtime`
- `form_runtime`
- `handoff`

Provider 和 adapter 选择留在内部。就这个 slice 而言，`Runtime Engine` 仍然是一等能力，`Data Engine` 仍然只是公开网页读取的一条薄读侧，不夸大成已完整交付的独立后端。

---

## 真实表单

当页面是真实表单时，优先使用专门的表单运行时表面：

`form_inspect` -> `fill_form` / `set_option` / `set_date` -> `verify_form` -> `safe_submit`

默认行为是保守的：

- `fill_form` 只写 `safe` 字段
- `review` 和 `sensitive` 字段会保留出来，便于显式查看
- `safe_submit` 默认先走 preview，先看阻塞项再决定是否真正提交

表单表面参考：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## 认证工作台

当当前页面是动态认证 workspace 时，先用 `workspace_inspect` 查看当前状态和下一步建议。
典型循环是 `workspace_inspect -> select_live_item -> workspace_inspect -> draft_action ->
workspace_inspect -> execute_action -> verify_outcome`。默认情况下，Grasp 会先草拟内容，
对不可逆操作要求显式确认，并验证 workspace 是否真的进入了下一状态。

Workspace 表面参考：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

这些 workspace 流程只是这个 browser runtime 的例子。BOSS 是一个例子，微信公众号和小红书也是同类例子，但都不构成产品边界。

### 基础多任务状态

Grasp 当前不会承诺复杂调度器，但会继续往“能同时持有多个任务/会话上下文”的方向推进，而不是把所有流程压成一个活动浏览器假设。

---

## 高级运行时原语

高层运行时表面是默认入口；需要更细粒度控制时，底层运行时原语仍然保留。

常用高级原语：

- 导航与状态：`navigate`、`get_status`、`get_page_summary`
- 交互地图：`get_hint_map`
- 可验证动作：`click`、`type`、`hover`、`press_key`、`scroll`
- 观察：`watch_element`
- 会话策略与接力辅助：`preheat_session`、`navigate_with_strategy`、`session_trust_preflight`、`suggest_handoff`、`request_handoff_from_checkpoint`、`request_handoff`、`mark_handoff_in_progress`、`mark_handoff_done`、`resume_after_handoff`、`clear_handoff`

完整说明见：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## CLI

| 命令 | 说明 |
|:---|:---|
| `grasp` / `grasp connect` | 初始化本地浏览运行时 |
| `grasp status` | 查看连接状态、当前标签页和最近活动 |
| `grasp explain` | 解释最近一次 route decision |
| `grasp logs` | 查看审计日志（`~/.grasp/audit.log`） |
| `grasp logs --lines 20` | 查看最近 20 行日志 |
| `grasp logs --follow` | 实时跟随日志 |

## 文档

- [docs/README.md](./docs/README.md)
- [浏览器运行时说明](./docs/product/browser-runtime-for-agents.md)
- [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
- [docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

## 发布

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/release-notes-v0.6.0.md](./docs/release-notes-v0.6.0.md)
- [docs/release-notes-v0.55.0.md](./docs/release-notes-v0.55.0.md)

## 许可证

MIT — 见 [LICENSE](./LICENSE)。

## Star 历史

[![Star History Chart](./star-history.svg)](https://star-history.com/#Yuzc-001/grasp&Date)
