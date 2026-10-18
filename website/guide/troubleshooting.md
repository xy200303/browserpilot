---
title: 常见失败与数据位置
description: BrowserPilot 常见失败怎么定位：选择器匹配多个、等待超时、MCP 401、端口冲突、登录失效、页面崩溃、验证码、下载与 ffmpeg；附运行记录、截图、HAR 的具体路径。
---

# 常见失败与数据位置

先看运行记录，再看现场截图，最后才看日志文件。大多数问题在这三步里就能定位。

## 选择器问题

### 「匹配到 N 个元素」

点击、输入、选择、粘贴必须恰好匹配一个。匹配多个时 BrowserPilot 直接失败，不取第一条。

定位：

```text
page_query { "selector": "button.submit" }
```

返回每一项的 `index`、文字、`hittable` 和 `rect`。把选择器收窄到唯一，例如加 `[name=...]`、父级作用域或 `:nth-of-type()`。

### 「超时还没出现」

`page_wait` 默认 10 秒、最长 60 秒。先确认页面真的加载了：

```text
page_snapshot {}
page_source   { "kind": "dom" }
```

如果目标在 iframe 或 Shadow DOM 里，加 `pierce: true`；跨域 iframe 顶层查不到时会自动走 OOPIF。

### 「Script failed to execute」

`page_script` 的 `source` 是**表达式**，不是函数体。不要写：

```text
return { title: document.title }
```

要写：

```text
(() => ({ title: document.title }))()
```

多条语句用 IIFE：

```text
(() => { const cards = document.querySelectorAll('article'); return { count: cards.length }; })()
```

工作流里的「页面脚本」节点不同：它会被包进 async 函数，可以直接写 `return`。

## MCP 连不上

### 端点不存在

先确认应用开着，且 **设置 → 通用 → MCP** 是开的。端点文件：

```text
Windows: %APPDATA%\BrowserPilot\mcp.json
macOS:   ~/Library/Application Support/BrowserPilot/mcp.json
Linux:   ~/.config/BrowserPilot/mcp.json
```

文件里是 `url` 和 `token`。应用关掉后端点就没了。

### 401 unauthorized

请求头必须是 `Authorization: Bearer <token>`，token 来自 `mcp.json`。不要自己改 token；需要换就重启应用让服务重写。

### 端口被占用

默认 `39221`。改 **设置 → 通用 → 端口**，应用会重开服务并重写 `mcp.json`。客户端里同步改 URL。

### 只能本机访问

MCP 只监听 `127.0.0.1`，没有对外网开放的开关。远程机器请用远程桌面，不要把端口映射出去。

## 标签与环境

### 「没有这个标签」

`tabId` 已经关了，或编号不属于任何窗口。先：

```text
tab_list {}
```

不要复用旧编号，也不要在没找到时另开一个同名标签。

### 登录失效

打开对应环境的窗口，人重新登录。登录态在：

```text
%APPDATA%\BrowserPilot\Partitions\<env-id>\
```

关窗口不清；只有 `env_delete` 会清 Cookie 并删除分区。默认环境不能删。

### 换机器

```text
env_export { "env": "env-..." }
env_import { "path": "C:\path\env-....json" }
```

导出文件是**明文 Cookie**，只在本机传递。

### 「无头窗口已到上限」

**设置 → 通用 → 无头窗口上限** 默认 3。超出时这次打开失败，已经在跑的不打断。有头窗口不占这个数量。

## 工作流

### 失败停在哪

打开工作流详情 →「运行记录」，或在 `runs.json` 里看：

- `node`：停在哪个节点
- `error`：错误文本
- `screenshot`：现场截图路径
- `files`：已经产出的文件

存储上限 200 条；界面列表最多 50 条。Agent 逐步调用工具不写运行记录，只有工作流运行会写。

### 开了抓包但失败没 HAR

只有**失败当时**抓包还开着，才会把 HAR 写进 `runs\`。先 `net_start`，再跑工作流；跑完再 `net_stop`。

### 页面崩溃

v0.13.12 起，`webContents.isDestroyed()` 时会自动重建视图并恢复页面。仍然失败就重开标签，或重启应用；不要在原标签上继续调用。

## 下载与媒体

### 下载在哪

```text
%APPDATA%\BrowserPilot\downloads
```

下载管理器支持暂停、继续、取消、重试、复制链接。网页触发的下载都会进这里；`page_save_media` 保存的文件进 `media`（或你给的 `savePath`）。

### 视频保存失败

- 直链 / DASH / m3u8 走 `page_save_media`；需要 ffmpeg。首次会从镜像下载到：

```text
%APPDATA%\BrowserPilot\tools
```

- 抓不到轨的流媒体（Worker 拉流、加密流）用 `page_record_video` 录渲染画面，代价是要实时播完。
- m3u8 清单和抓不到轨的情况，工具会在返回里说明。

## 验证码

- 自动支持：极验 v4 滑块（`captcha_solve`，cv → ddddocr → onnx）。
- 文字验证码：`captcha_read`，需要本机 Python 与 `pip install ddddocr`。
- 其它类型：`captcha_panel` 截图交给会看图的 Agent；成功率取决于题型与模型。
- 图标点选、五子棋、交换消除：没有内置识别器，建议 `page_handoff` 交给人。

## CLI

### 找不到命令

CLI 默认不在 PATH：

```text
%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe
```

要么写全路径，要么把这个目录加进 PATH。

### 应用没起来

CLI 会尝试启动应用。安装版需要告诉它 exe 在哪：

```bat
set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
```

然后 CLI 最多等 45 秒读 `mcp.json`。

### 中文参数

不要把中文直接写进 `--json`。写进 UTF-8 的 JSON 文件，用 `--json-file`。

## 数据位置总表

| 内容 | 路径（Windows） |
| ---- | ---- |
| 环境 / 分组 / 工作流 / 设置 | `%APPDATA%\BrowserPilot\envs.json`、`groups.json`、`workflows.json`、`settings.json` |
| 运行记录 | `%APPDATA%\BrowserPilot\runs.json` |
| 现场截图 | `%APPDATA%\BrowserPilot\screenshots\` |
| 失败截图与 HAR | `%APPDATA%\BrowserPilot\runs\` |
| 导出的 CSV | `%APPDATA%\BrowserPilot\exports\` |
| 网页下载 | `%APPDATA%\BrowserPilot\downloads\` |
| 媒体保存 | `%APPDATA%\BrowserPilot\media\` |
| 窗口录屏 | `%APPDATA%\BrowserPilot\videos\` |
| ffmpeg | `%APPDATA%\BrowserPilot\tools\` |
| 环境登录分区 | `%APPDATA%\BrowserPilot\Partitions\<env-id>\` |
| MCP 端点 | `%APPDATA%\BrowserPilot\mcp.json` |

macOS 把 `%APPDATA%` 换成 `~/Library/Application Support`；Linux 换成 `~/.config`。

备份就是整个目录拷走。卸载程序不会删这个目录。
