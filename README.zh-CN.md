# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.5.2-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.zh-CN.md#快速开始)
[![npm](https://img.shields.io/badge/npm-grasp-CB3837?style=flat-square)](https://www.npmjs.com/package/grasp)

> **Grasp 是一个 AI 浏览网关：它能进入网页、读取内容、执行操作、发起接力，并带着证据恢复真实网页任务。**

Grasp 完全本地运行，使用专属的 `chrome-grasp` 浏览器配置目录，让智能体拥有可以复用的浏览器会话，而不是每次都从空白标签页重新开始。

当前包版本：`v0.5.2`  
对外文档入口：[docs/README.md](./docs/README.md)

---

## 为什么重要

很多浏览器自动化真正断掉的地方，不是在“不会点”，而是在登录之后、风控出现之后，或者人工介入一次之后就再也接不上。

Grasp 要解决的是这些真实流程里的连续性问题：

- 持久浏览器会话，而不是一次性标签页
- 可验证动作，而不是盲点成功
- 紧凑页面理解，而不是直接塞原始 HTML
- 可恢复接力，而不是人工介入后整段重来

当前主线强调的是：

- `AI 浏览网关`
- `会话连续性`
- `可恢复接力`

它不承诺：

- 通用验证码绕过
- 所有高风控站点都能全自动完成
- 没有页面证据也能判断恢复成功

---

## 快速开始

### 1. 启动 Grasp

```bash
npx grasp
```

它会检测 Chrome，启动专属 `chrome-grasp` 浏览器配置目录，并帮助你把网关接到 AI 客户端上。

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

### 3. 按网关工作流调用

先用高层工具面：

- `entry`：带着会话策略进入目标 URL
- `inspect`：判断当前页面是否可读、受阻，还是正在等待接力恢复
- `extract`：读取页面内容
- `continue`：在不触发浏览器动作的前提下决定下一步

工具说明见：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
手工 smoke 路径见：[docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

---

## 网关工作流

### 直接读取

页面已经可读时，用 `entry` -> `inspect` -> `extract`。

你会拿到：

- 当前页面状态
- 可读取内容
- 建议的下一步动作

### 带会话感知的进入

就算你认为直接打开就够了，也建议先走 `entry`。

`entry` 会返回进入策略的证据，例如：

- 可以直接进入
- 建议先用 `preheat_session` 预热
- 当前更适合先转入接力

### 接力与恢复

当流程必须有人来接一下时，不要假装系统已经全自动，而是把它纳入连续工作流：

1. `entry` 或 `continue` 发现页面受阻
2. `request_handoff` 记录人工步骤
3. `mark_handoff_done` 标记人工步骤完成
4. `resume_after_handoff` 带着延续性证据重新接回页面
5. `continue` 判断接下来该继续、等待，还是再次接力

产品说明见：[docs/product/ai-browser-gateway.md](./docs/product/ai-browser-gateway.md)

---

## 安全真实表单任务

当页面是真实表单时，优先使用表单任务流程：

`form_inspect` -> `fill_form` / `set_option` / `set_date` -> `verify_form` -> `safe_submit`

默认行为是保守的：

- `fill_form` 只写 `safe` 字段
- `review` 和 `sensitive` 字段会保留出来，便于显式查看
- `safe_submit` 默认先走 preview，先看阻塞项再决定是否真正提交

表单任务参考：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## 动态认证任务流

当当前页面是动态认证 workspace 时，先用 `workspace_inspect` 查看当前状态和下一步建议。
典型循环是 `workspace_inspect -> select_live_item -> workspace_inspect -> draft_action ->
workspace_inspect -> execute_action -> verify_outcome`。默认情况下，Grasp 会先草拟内容，
对不可逆操作要求显式确认，并验证 workspace 是否真的进入了下一状态。

Workspace 任务参考：[docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)

---

## 高级运行时原语

高层网关工具是默认入口；需要更细粒度控制时，底层运行时原语仍然保留。

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
| `grasp` / `grasp connect` | 初始化本地浏览网关 |
| `grasp status` | 查看连接状态、当前标签页和最近活动 |
| `grasp logs` | 查看审计日志（`~/.grasp/audit.log`） |
| `grasp logs --lines 20` | 查看最近 20 行日志 |
| `grasp logs --follow` | 实时跟随日志 |

## 文档

- [docs/README.md](./docs/README.md)
- [docs/product/ai-browser-gateway.md](./docs/product/ai-browser-gateway.md)
- [docs/reference/mcp-tools.md](./docs/reference/mcp-tools.md)
- [docs/reference/smoke-paths.md](./docs/reference/smoke-paths.md)

## 发布

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/release-notes-v0.5.2.md](./docs/release-notes-v0.5.2.md)

## 许可证

MIT — 见 [LICENSE](./LICENSE)。

## Star 历史

[![Star History Chart](./star-history.svg)](https://star-history.com/#Yuzc-001/grasp&Date)
