---
title: 快速上手
description: 从安装到跑通第一个任务：打开 BrowserPilot、确认 MCP、把端点交给 Agent、在已登录的窗口里执行一次网页操作，并知道结果和截图落在哪里。
---

# 快速上手

先把应用装好，把 MCP 接给 Agent，然后在已经登录的窗口里跑一次网页操作。全程在本机。

## 第一步：安装并打开

去 [下载页](/download)取对应平台的包。Windows 安装包未签名，SmartScreen 提示时点「更多信息」→「仍要运行」。

第一次启动会打开「默认」环境的一扇窗口。这套环境不能删除；关掉窗口不会清登录。

## 第二步：确认 MCP 开着

打开 **设置 → 通用**，确认：

- MCP 开关是开的
- 监听地址是 `127.0.0.1`
- 端口默认 `39221`
- 端点显示 `http://127.0.0.1:39221/mcp`

端点和令牌同时写到本机：

```text
Windows: %APPDATA%\BrowserPilot\mcp.json
macOS:   ~/Library/Application Support/BrowserPilot/mcp.json
Linux:   ~/.config/BrowserPilot/mcp.json
```

`mcp.json` 里是 `url` 和 `token`。令牌是随机生成的，应用不把它写进仓库；也不要贴到对话里。

## 第三步：接上 Agent

BrowserPilot 自带 MCP 服务，不自带模型。你需要一个会调用 MCP 工具的客户端，例如 Claude Code、Kimi Code、Codex、Cursor、WorkBuddy 或 CodeBuddy。

最省事的方式是把下面这段话发给客户端：

```text
请安装 BrowserPilot 配套 skill：读取 https://raw.githubusercontent.com/xy200303/browserpilot/main/skills/browserpilot/SKILL.md 并安装到你的用户级 skills 目录，再读取本机 BrowserPilot 的 mcp.json（Windows 是 %APPDATA%\BrowserPilot\mcp.json），只把名为 browserpilot 的 MCP 注册到你自己的配置里，其它服务器不要动；完成后用这个 skill 操作 BrowserPilot。
```

也可以手动注册。客户端要求 streamable HTTP 时，配置形态是：

```json
{
  "mcpServers": {
    "browserpilot": {
      "type": "http",
      "url": "http://127.0.0.1:39221/mcp",
      "headers": { "Authorization": "Bearer 从 mcp.json 读取的 token" }
    }
  }
}
```

应用要开着。关掉应用，这个端点就没了。

## 第四步：跑通第一个任务

### 方式 A：让 Agent 直接做

在客户端里说：

```text
打开 https://github.com/topics/browser-automation，
等仓库卡片出现，取前 5 个仓库名和 Star 数，告诉我结果。
```

Agent 会依次调用类似这样的工具：

```text
tab_open      { "url": "https://github.com/topics/browser-automation" }
page_wait     { "selector": "article", "timeout": 20 }
page_query    { "selector": "article" }
page_script   { "source": "(() => ({ title: document.title, count: document.querySelectorAll('article').length }))()" }
```

`page_script` 的 source 是**一段表达式**，不是函数体。要写多条语句，用 IIFE 包起来：`(() => { ...; return ... })()`。

### 方式 B：在界面里跑一个已装工作流

1. 地址栏右侧点「工作流」。
2. 在「目录」里找到「打开网页」，点加号安装。
3. 切到「已安装」，点卡片，填「要打开的网址」。
4. 点「执行」。

页面会切到目标网址，运行结束后看「运行记录」：成功/失败、输出、文件都会列出来。

## 你会看到什么

- **遮罩**：Agent 操作时，页面盖一层「Agent 正在操作浏览器」，中央是「接管」。点一下就把控制权拿回来；任务不暂停，控制状态变成 `shared`。
- **交接**：需要你输密码或做人脸/短信核验时，Agent 调 `page_handoff` 或工作流走到「交接」节点。遮罩去掉，页面顶部留一句提示；下一步目标出现时重新上锁。工作流交接最多等 10 分钟（下一个节点有定位时）；没有定位会立即重新上锁。
- **运行记录**：只有**工作流运行**会写 `runs.json`，成功失败各一条，最多 200 条（界面列表最多显示 50 条）。Agent 逐步调用工具不写运行记录；工具失败会附一张 `errorShot`。
- **截图位置**：`%APPDATA%\BrowserPilot\screenshots`。

## 第一条 CLI 命令（可选）

CLI 在安装目录的 `resources\cli` 下，默认不在 PATH：

```bat
set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" tools
```

`tools` 会列出全部 67 个工具。看参数：

```bat
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" schema page_click
```

调用时中文参数写进 UTF-8 的 JSON 文件，用 `--json-file`，不要在命令行里手写中文 JSON：

```bat
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" call workflow_run --name "打开网页" --json-file C:\tasks\open.json
```

```json
{ "地址": "https://github.com/topics/browser-automation" }
```

## 收尾

- 做完调用 `page_unlock`，不要把遮罩留着。
- 关窗口不清登录；要清一套环境的 Cookie，用 `env_delete`（默认环境不能删）。
- 下一步读[核心概念](/guide/concepts)，或直接看[可复制用例](/guide/recipes)。
