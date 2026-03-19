# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.2.0-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.zh-CN.md#安装)
[![npm](https://img.shields.io/badge/npm-grasp-CB3837?style=flat-square)](https://www.npmjs.com/package/grasp)

> **给 AI 一个专属浏览器。**
>
> 登录一次，会话永久留存。你的 Chrome，原封不动。

Grasp 是一个开源 MCP Server，专为浏览器自动化而生。完全本地运行，连接专属的 `chrome-grasp` profile，赋予 AI Agent 完整的浏览器控制能力——导航、交互、感知——零云依赖，不干扰你的个人浏览。

**当前版本：** `v0.2.0`

---

## 设计理念

Agent 应该拥有自己的浏览器。不是借来的会话，不是每次重置的空白标签——而是一个属于它的持久 profile，凭据随使用积累，永不消失。

`chrome-grasp` 就是那个 profile。Agent 在里面完成登录，会话跨越每一次运行。你的标签页和历史从不被触碰。

三个原则贯穿 Grasp 的设计：

**本地，开源。** 全部代码以 MIT 协议开放，运行在你自己的硬件上。没有云后端，没有遥测，不需要账号。Agent 的行为只在你与浏览器之间。

**语义感知，而非原始 HTML。** Grasp 扫描实时视口，生成极简的 Hint Map——屏幕上所有可交互元素的稳定、精炼表示：

```
[B1] 提交订单      (button, pos:450,320)
[I1] 优惠码输入框   (input,  pos:450,280)
[L2] 返回购物车    (link,   pos:200,400)
```

ID 通过指纹注册表跨调用保持稳定。Token 消耗比原始 HTML 节省 90%+。Agent 像理解一切结构化数据那样理解 UI——通过有意义的语义，而非噪声。

**真实输入，而非脚本自动化。** 每次点击沿曲线路径划过屏幕。每次滚动以一组 wheel 事件序列抵达。每次按键携带独立的时序。这是通过 Chrome DevTools Protocol 分发的输入——不是 `element.click()`。

对于暴露 `window.__webmcp__` 的页面，Grasp 绕过 DOM，直接调用原生工具接口。对其余所有页面，Hint Map 与真实事件接管交互。Agent 无需知晓底层路径的选择。

---

## 安装

### 一行命令

```bash
npx grasp
```

检测 Chrome，以 `chrome-grasp` profile 启动，自动配置 AI 客户端。首次运行时打开浏览器——在里面登录 Agent 需要的服务，会话永久保存。

### Claude Code

```bash
claude mcp add grasp -- npx -y grasp
```

### Claude Desktop / Cursor

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

### Codex CLI

```toml
[mcp_servers.grasp]
type    = "stdio"
command = "npx"
args    = ["-y", "grasp"]
```

---

## CLI

| 命令 | 说明 |
|:---|:---|
| `grasp` / `grasp connect` | 连接向导——检测 Chrome、启动、配置 AI 客户端 |
| `grasp status` | 连接状态、当前标签页、最近操作 |
| `grasp logs` | 查看审计日志（`~/.grasp/audit.log`） |
| `grasp logs --lines 20` | 最近 20 条 |
| `grasp logs --follow` | 实时跟随 |

---

## MCP 工具

### 导航

| 工具 | 说明 |
|:---|:---|
| `navigate` | 导航到 URL，自动探测 WebMCP |
| `get_status` | 连接状态、当前页面、执行模式 |
| `get_page_summary` | 标题、URL、可见文字（前 2000 字） |
| `wait_until_stable` | 等待页面快照连续稳定后再继续读取 |
| `extract_main_content` | 提取当前页面更聚焦的主内容 / 正文 |
| `screenshot` | 截取当前视口（base64） |

### 交互

| 工具 | 说明 |
|:---|:---|
| `get_hint_map` | 扫描视口，返回语义地图 |
| `get_form_fields` | 识别表单字段，ID 与 hint map 对齐 |
| `search_affordances` | 对当前页面的搜索输入框和提交控件做排序 |
| `click` | 按 Hint ID 点击；高危操作自动拦截 |
| `confirm_click` | 强制点击高危元素 |
| `type` | 逐键盘事件输入文字 |
| `hover` | 悬停触发下拉菜单或 Tooltip |
| `scroll` | 真实 wheel 事件滚动 |
| `press_key` | 发送键盘快捷键 |
| `watch_element` | 监听 CSS 选择器对应元素的 DOM 变化 |

### 任务调度

| 工具 | 说明 |
|:---|:---|
| `search_task` | 运行带有有界恢复的搜索工作流，并稳定返回 `attempts`、`toolCalls`、`retries`、`recovered` 等指标 |

### 标签页

| 工具 | 说明 |
|:---|:---|
| `get_tabs` | 列出所有标签页 |
| `switch_tab` | 切换到指定标签页 |
| `new_tab` | 在新标签页打开 URL |
| `close_tab` | 关闭指定标签页 |

### 审计

| 工具 | 说明 |
|:---|:---|
| `get_logs` | 最近 N 条操作，来自 `~/.grasp/audit.log` |
| `call_webmcp_tool` | 调用页面原生 WebMCP 工具（仅 WebMCP 模式） |

---

## 配置

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `CHROME_CDP_URL` | `http://localhost:9222` | Chrome 远程调试地址 |
| `GRASP_SAFE_MODE` | `true` | 执行前拦截高危操作 |

持久化配置存储在 `~/.grasp/config.json`。

## 恢复语义

交互工具现在会通过结构化 `meta` 返回失败信息：

- `error_code`：失败类型，例如 `CDP_UNREACHABLE`、`STALE_HINT`、`ACTION_NOT_VERIFIED`
- `retryable`：调用方是否可以安全地做有界重试
- `suggested_next_step`：建议下一步动作，例如 `retry`、`reobserve`、`wait_then_reverify`
- `evidence`：验证器判断时使用的页面证据

`search_task` 调度器建立在同一套约定之上，并直接返回稳定的 benchmark 字段。其中 `toolCalls` 统计的是调度层实际触发的 `type` / `click` / `press_key` 动作步数，不包含状态同步；`recovered` 则表示流程中确实走到了有界恢复路径。

benchmark 的 smoke 场景和口径说明见 [docs/benchmarks/search-benchmark.md](./docs/benchmarks/search-benchmark.md)。

---

## 仓库结构

```
index.js                    CLI 入口，MCP Server 引导
src/
  server/                   工具注册表、状态、审计日志、响应
  layer1-bridge/            Chrome CDP 连接、WebMCP 探测
  layer2-perception/        Hint Map、指纹注册表
  layer3-action/            鼠标曲线、滚轮事件、键盘输入
  cli/                      connect · status · logs · 自动配置
examples/                   客户端配置示例
start-chrome.bat            Windows Chrome 启动脚本
```

---

## 许可证

MIT — 见 [LICENSE](./LICENSE)。

## 联系

- Issues：https://github.com/Yuzc-001/grasp/issues
- 邮件：`zxyu24@outlook.com`

## Claude Code Skill

安装随包附带的 skill，让 Claude 获得 Grasp 所有工具的结构化知识——工作流、Hint Map 用法、安全模式和 WebMCP 探测。

**OpenClaw：** 搜索 `grasp`，一键安装。

**手动安装：**

```bash
curl -L https://github.com/Yuzc-001/grasp/raw/main/grasp.skill -o ~/.claude/skills/grasp.skill
```

安装后，Claude 自动知道何时、如何使用 Grasp——无需手动提示。

---

## Star 历史

[![Star History Chart](./star-history.svg)](https://star-history.com/#Yuzc-001/grasp&Date)

---

[README.md](README.md) · [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
