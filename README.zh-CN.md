# Grasp

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/Yuzc-001/grasp) · [Issues](https://github.com/Yuzc-001/grasp/issues)

[![Version](https://img.shields.io/badge/version-v0.1.0-0B1738?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-23C993?style=flat-square)](./LICENSE)
[![Validated](https://img.shields.io/badge/validated-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-5B6CFF?style=flat-square)](./README.zh-CN.md#安装)
[![npm](https://img.shields.io/badge/npm-grasp-CB3837?style=flat-square)](https://www.npmjs.com/package/grasp)

> **给 AI 一个专属浏览器。**
>
> 独立的 Chrome profile，登录一次永久有效。
> 与你的主浏览器并行运行，互不干扰。

Grasp 是一个本地 MCP Server，通过 Chrome DevTools Protocol 给 AI Agent 完整的浏览器控制权。它为 AI 创建一个专属的 `chrome-grasp` profile——Agent 在那里登录各种服务，会话永久保留，与你自己的 Chrome 完全隔离。

**当前版本：** `v0.1.0`

---

## Grasp 的定位

面向 AI 的浏览器自动化有三个根本性的问题：会话无法持久、HTML 太贵传不起、JS 注入会被检测拦截。

Grasp 把这三个问题都解决了——并从头为 MCP 时代设计了整套架构。

**三个原创贡献：**

**1. 专属浏览器。** Grasp 首创了给 AI 分配专属 Chrome profile 的理念。Agent 登录一次，所有会话永久保存在 `chrome-grasp` 中。没有其他工具做到这一点。云端无头浏览器一关就丢 Cookie，本地 Playwright 每次从空白开始。Grasp 启动时就已经登录——永远如此。

**2. Hint Map。** 不把原始 HTML 倒进上下文窗口，而是扫描实时视口，生成极简语义地图：

```
[B1] 提交订单      (button, pos:450,320)
[I1] 优惠码输入框   (input,  pos:450,280)
[L2] 返回购物车    (link,   pos:200,400)
```

ID 通过指纹注册表跨调用保持稳定。Token 消耗比原始 HTML 节省 90%+。这是 Grasp 独创的感知层——专为模型理解 UI 的方式而设计。

**3. 真实事件，不是注入。** 每次点击都是一条鼠标曲线，带有随机化的时序和落点偏移。每次滚动是一组 CDP wheel 事件序列。每次输入都有逐字符延迟。这不是 `element.click()`，是 OS 级别的输入，与人手操作无法区分。

对于暴露 `window.__webmcp__` 的页面，Grasp 直接调用其原生工具接口，完全跳过 DOM 解析。对其他所有页面——互联网的绝大多数——Hint Map 和真实事件自动接管。Agent 无需关心底层走的是哪条路。

## 为什么需要 Grasp

今天让 AI 控制浏览器，你只有三条路，每条都有致命问题：

| 方案 | 问题 |
|:---|:---|
| 云端无头浏览器（Browserbase、Steel） | 数据上云，没有 Cookie，内网不可达 |
| 本地 Playwright 新开浏览器 | 每次全新 profile，登录状态全无，SSO/2FA 全部失效 |
| 页面阅读工具 | 只能读，不能动 |

Grasp 是第四条路：一个持久的、本地的、属于 Agent 的浏览器，每次任务开始时就已经处于登录状态。

## 这个仓库包含什么

Grasp `v0.1.0` 包含：
- `src/server/` 中注册了 18 个工具的 MCP Server
- `src/layer1-bridge/` 中的 Chrome 桥接层和自适应执行引擎
- `src/layer2-perception/` 中的 Hint Map 感知层
- `src/layer3-action/` 中的真实事件动作层
- `src/cli/` 中包含 `connect`、`status`、`logs` 命令的 CLI
- 写入 `~/.grasp/audit.log` 的操作审计日志
- 拦截高危操作的 Safe Mode
- 对 Claude Code、Codex、Cursor 的一键自动配置
- 从零引导所有流程的连接向导 `grasp connect`

## 工作原理

```
你的 chrome-grasp profile（已登录，会话完整）
         |
         | Chrome DevTools Protocol (CDP)
         |
    Grasp MCP Server
         |
         | MCP stdio
         |
    你的 AI Agent（Claude / Codex / Cursor）
```

**自适应执行引擎** — 每次导航时，Grasp 在 50ms 内探测页面是否支持 WebMCP。支持 `window.__webmcp__` 的页面走原生结构化工具通道，零 DOM 解析，Token 消耗最低。其他页面走 Hint Map + 真实事件通道，兼容所有存量网页。

**Hint Map** — 不把 HTML 源码传给 AI，而是扫描视口内的可交互元素，返回极简语义地图：

```
[B1] 提交订单      (button, pos:450,320)
[I1] 优惠码输入框   (input,  pos:450,280)
[L2] 返回购物车    (link,   pos:200,400)
```

Token 消耗比原始 HTML 节省 90%+。ID 通过指纹注册表跨调用保持稳定。

**真实事件，不是 JS 注入** — 每次点击都是一条鼠标曲线（15 步，随机落点偏移）。每次滚动是 5 个 CDP wheel 事件，步间随机间隔 20–60ms。每次输入是逐键事件，字符间随机延迟 30–80ms。

## 安装

### 一行命令（推荐）

```bash
npx grasp
```

这会运行 `grasp connect` 向导：检测 Chrome，以专属 `chrome-grasp` profile 启动，自动配置 AI 客户端。

> 首次启动：向导会打开 `chrome-grasp`。在里面登录你的 Agent 需要操作的服务，会话会永久保存在该 profile 中。

### 手动添加到 AI 客户端

#### Claude Code CLI

```bash
claude mcp add grasp -- npx -y grasp
```

#### Claude Desktop / Cursor

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

#### Codex CLI

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.grasp]
type    = "stdio"
command = "npx"
args    = ["-y", "grasp"]
```

### 全局安装

```bash
npm install -g grasp
grasp connect
```

## CLI 命令

| 命令 | 说明 |
|:---|:---|
| `grasp` / `grasp connect` | 连接向导——检测 Chrome、启动、配置 AI 客户端 |
| `grasp status` | Chrome 连接状态、当前标签页、最近操作 |
| `grasp logs` | 查看审计日志（`~/.grasp/audit.log`） |
| `grasp logs --lines 20` | 显示最近 20 条 |
| `grasp logs --follow` | 实时跟随新操作 |
| `grasp --version` | 打印版本号 |
| `grasp --help` | 打印帮助 |

## MCP 工具完整列表

### 导航与状态

| 工具 | 说明 |
|:---|:---|
| `navigate` | 导航到 URL，自动探测 WebMCP，返回标题和模式 |
| `get_status` | Chrome 连接状态、当前页面、执行模式 |
| `get_page_summary` | 页面标题、URL、可见文字（前 2000 字） |
| `screenshot` | 截取当前视口（返回 base64） |

### 交互操作

| 工具 | 说明 |
|:---|:---|
| `get_hint_map` | 扫描视口可交互元素，返回 `[B1]` `[I1]` `[L1]` 语义地图 |
| `get_form_fields` | 识别表单字段，按 `<form>` 分组，ID 与 hint map 对齐 |
| `click` | 自然鼠标曲线点击 Hint ID；高危操作自动拦截 |
| `confirm_click` | 强制点击高危元素（绕过 safe mode） |
| `type` | 逐键盘事件输入文字，支持 `press_enter` |
| `hover` | 悬停元素触发下拉菜单或 Tooltip |
| `scroll` | 真实 wheel 事件滚动（`up` / `down`） |
| `press_key` | 发送键盘快捷键（`Enter`、`Escape`、`Control+Enter`） |
| `watch_element` | 监听 CSS 选择器对应元素的 `appears` / `disappears` / `changes` |

### 标签页管理

| 工具 | 说明 |
|:---|:---|
| `get_tabs` | 列出所有标签页（序号、标题、URL） |
| `switch_tab` | 切换到指定序号的标签页 |
| `new_tab` | 在新标签页打开 URL |
| `close_tab` | 关闭指定序号的标签页 |

### 日志与审计

| 工具 | 说明 |
|:---|:---|
| `get_logs` | 查看最近 N 条操作日志（默认 50），文件在 `~/.grasp/audit.log` |

### WebMCP 协议

| 工具 | 说明 |
|:---|:---|
| `call_webmcp_tool` | 调用页面原生暴露的 WebMCP 工具（仅 WebMCP 模式可用） |

## 配置

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `CHROME_CDP_URL` | `http://localhost:9222` | Chrome 远程调试地址 |
| `GRASP_SAFE_MODE` | `true` | 设为 `false` 关闭高危操作拦截 |

持久化配置存储在 `~/.grasp/config.json`。

## 仓库结构

- `README.md` / `README.zh-CN.md` — 英文和中文入口
- `CHANGELOG.md` — 发布历史
- `CONTRIBUTING.md` — 贡献指南
- `LICENSE` — MIT
- `index.js` — CLI 入口和 MCP Server 引导
- `src/server/` — MCP 工具注册表、状态、审计日志、响应工具
- `src/layer1-bridge/` — Chrome CDP 连接、WebMCP 探测
- `src/layer2-perception/` — Hint Map 构建器、指纹注册表
- `src/layer3-action/` — 真实鼠标/键盘/滚动事件执行
- `src/cli/` — connect、status、logs 命令；Chrome 检测；AI 客户端自动配置
- `examples/` — 示例 MCP 客户端配置
- `start-chrome.bat` — Windows 一键 Chrome 启动脚本

## 许可证

MIT — 完全开源，欢迎 PR。详见 [LICENSE](./LICENSE)。

## 联系与协作

- Issues：https://github.com/Yuzc-001/grasp/issues
- 邮件：`zxyu24@outlook.com`

Bug、安装问题、文档缺失、功能建议请提 Issue。
私密合作或不适合公开讨论的问题请发邮件。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Yuzc-001/grasp&type=Date)](https://star-history.com/#Yuzc-001/grasp&Date)

## 延伸阅读

- [README.md](README.md)
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
