# BrowserPilot SDK

用 Python、Node、Go 以编程方式驱动 BrowserPilot 桌面浏览器，接口照着 Playwright 的样子做。

SDK **不自带浏览器引擎**，它驱动的是你机器上那扇 BrowserPilot 窗口：登录态、书签、密码都还在，
Agent 和你的脚本操作的是同一套 cookie。

```python
from browserpilot import launch

with launch() as bp:
    page = bp.new_page()
    page.goto("https://example.com")
    page.get_by_role("button", name="登录").click()
```

```ts
import { launch } from 'browserpilot'

const bp = await launch()
const page = await bp.newPage()
await page.goto('https://example.com')
await page.getByRole('button', { name: '登录' }).click()
```

```go
bp, err := browserpilot.Launch(ctx)
defer bp.Close()
page, err := bp.NewPage(ctx)
err = page.Goto(ctx, "https://example.com")
```

---

## 1. 三层结构

```
spec/            三个 SDK 共享的契约：工具快照、版本映射、平台矩阵
python/          pip install browserpilot-sdk
node/            npm install browserpilot
go/              go get github.com/xy200303/browserpilot/sdk/go
```

每个 SDK 都由四块组成，行为必须一致：

| 模块 | 职责 |
| --- | --- |
| `install` | 找到可用的 BrowserPilot，找不到才下载 |
| `transport` | 读端点文件、带 Bearer 发 JSON-RPC |
| `client` | `launch()` 探活/拉起/等就绪，`close()` 只收拾自己开的 |
| `api` | Playwright 风格封装：环境 → 页面 → 定位器 |

## 2. 找 BrowserPilot 的顺序

**先找已经装好的，再考虑下载。** 用户机器上那份桌面版就是首选，因为登录态都在它那儿。

| 顺序 | 条件 | 说明 |
| --- | --- | --- |
| 1 | `BROWSERPILOT_EXE` 环境变量 | 指向可执行文件，优先级最高，CI 里常用 |
| 2 | 已经在跑的实例 | 端点文件存在且 `GET /mcp` 能通，直接连上，**不启动任何进程** |
| 3 | 桌面版安装位置 | Windows `%LOCALAPPDATA%\Programs\BrowserPilot\`、macOS `/Applications/BrowserPilot.app`、Linux `/opt/BrowserPilot/` |
| 4 | SDK 自己的缓存 | `~/.browserpilot/sdk/<version>/` |
| 5 | 下载 | 见下一节 |

第 3 步用「同目录下有没有 `resources/app.asar`」确认那真是应用本体，而不是 `cli/browserpilot` 那个命令行。

找路径用 `BROWSERPILOT_HOME` 可以改 `~/.browserpilot` 的位置。

## 3. 下载

只在**前四步都失败**时才发生，默认在第一次 `launch()` 里做：

- 从 GitHub Release 取 `v<version>` 的资产，**边下边算 SHA-256**，和 API 返回的 `digest` 比对，不一致就删掉重来
- 解压到 `~/.browserpilot/sdk/<version>/`，临时文件用 `.part` 后缀，中途失败不会留下半个可执行文件
- 下载进度通过 `onDownload` 回调 / 日志给出，`BROWSERPILOT_OFFLINE=1` 时直接报错不联网

平台矩阵来自实际发布产物，**没有的组合 SDK 会直接报错**，不会下到一半崩：

| 平台 | 架构 | 资产 | 状态 |
| --- | --- | --- | --- |
| Windows | x64 | `BrowserPilot-<v>-win.zip` | 支持 |
| macOS | arm64 | `BrowserPilot-<v>-arm64-mac.zip` | 支持 |
| Linux | x64 | `BrowserPilot-<v>.AppImage` | 支持 |
| Windows | arm64 | — | 不支持 |
| macOS | x64 | — | 不支持 |
| Linux | arm64 | — | 不支持 |

> 桌面安装包 `BrowserPilot.Setup.<v>.exe` / `.dmg` / `.deb` **不会**被 SDK 使用：
> 静默安装需要管理员权限，而且卸载不干净。SDK 只解压一份自己的副本，删目录就是卸载。

## 4. 传输

三个 SDK 都走程序面 `/api/*`，是朴素 JSON，不涉及 JSON-RPC：

```
POST {api}/call     {"tool": "page_click", "args": {...}}   → 工具载荷本身
GET  {api}/tools                                           → 全量工具目录
POST {api}/events   {"since": 1024, "wait": 25000}         → 事件
Authorization: Bearer <mcp.json 里的 token>
```

图片在载荷的同级 `image` 字段里（base64）。`mcp.json` 没有 `api` 字段说明装的是旧版 App，
SDK 会直接报错而不是回退到 `/mcp`。

契约细节见 [`docs/环境与事件方案.md`](../docs/环境与事件方案.md) 第 3.5–3.8 节和第 6 节。

```
POST http://127.0.0.1:39221/mcp
Authorization: Bearer <mcp.json 里的 token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"page_click","arguments":{...}}}
```

不需要先发 `initialize`。服务端对每个请求新建一个无状态 transport，`tools/list` 和 `tools/call` 直接可用。

三个必须处理的细节：

1. **端点文件位置**：`%APPDATA%\BrowserPilot\mcp.json`（Windows）、
   `~/Library/Application Support/BrowserPilot/mcp.json`（macOS）、
   `$XDG_CONFIG_HOME/BrowserPilot/mcp.json`（Linux）。里面有 `url` 和 `token`。
2. **响应可能是 SSE**：`content-type: text/event-stream` 时，要取第一个 `data:` 行的 JSON。
3. **工具失败不是 HTTP 失败**：任何工具错误——包括工具名不存在、参数拼错——都返回
   `200 OK`，错误在载荷里：`content[0].text` 是一段 JSON，`{"ok": false, "error": "..."}`。
   看状态码判断成败一定会错。

成功时的载荷长这样：

```jsonc
// content[0].text 解析后
{ "ok": true, "control": "agent", "tabId": "tab-1a2b", "url": "https://example.com" }
// content[1]，只有截图类工具才有
{ "type": "image", "mimeType": "image/jpeg", "data": "<base64>" }
```

`control` 是 `agent` / `shared` / `handoff`：用户点了「接管」就是 `shared`，脚本还能继续，但页面已经不归它独占。

## 5. 版本

**SDK 版本号和 App 版本号同号**：`browserpilot==0.19.*` 对应 `v0.19.0`。

- 已经装好的桌面版优先级更高：用户装的是 0.20，SDK 是 0.19，**用 0.20**，打一条版本不一致的警告
- `BROWSERPILOT_STRICT_VERSION=1` 时改为报错，适合要求可复现的 CI
- 连上正在运行的实例时拿不到结构化版本号，SDK 不猜

## 6. 进程模型

BrowserPilot 是**单实例**应用（`app.requestSingleInstanceLock()`，`userData` 固定为
`%APPDATA%\BrowserPilot`）。注意这里限制的是**进程数**，不是窗口数：

- 窗口可以有很多，**一个环境一扇窗口**，一扇窗口里可以有很多标签。`env_create` / `env_open`
  就是开窗口，想并行几套登录态就开几个环境
- 限制在于：一个 App 进程只有一个 MCP 端点、一份 token、一套全局设置。不能同时跑两份 App，
  也拿不到进程级隔离（Playwright 每 `launch()` 一次是一个独立进程，这里不是）
- 已经有一个实例在跑，SDK 就连上去，绝不拉起第二个（第二个会因为锁自己退出）
- SDK 启动的进程 **detached**，脚本崩了浏览器不会被带走——这是用户日常在用的浏览器
- `close()` 只关自己打开的环境；连的是别人的实例时什么都不做

写批量脚本时要知道的全局限制（`settings_set` 可以改）：

| 设置 | 默认 | 影响 |
| --- | --- | --- |
| `maxLiveTabs` | 4 | 每个窗口的活跃页面数，超出的按最久未用休眠 |
| `tabHibernateMinutes` | 15 | 非活动标签多久后休眠 |
| `headlessLimit` | 3 | 同时无头的窗口数 |

休眠会丢掉视图，唤醒时页面重载，脚本手里的 DOM 状态就没了。
一次开很多标签的脚本会撞上这条，先把它调大。另见「一个环境一扇窗口」带来的好处：
cookie 隔离不用开新进程，`env_create` 就够。

## 7. API

概念对照：

| Playwright | BrowserPilot |
| --- | --- |
| `browser.newPage()` | `tab_open`，返回全局唯一的 `tab-` |
| `browser.newContext()` | 环境（`env-`），一套 cookie / 登录态 |
| `page.goto(url)` | `page_navigate`（内部已经等到 load 完成） |
| `locator.click()` | `page_click`，按 text → role+name → xpath/selector 的顺序 |
| `locator.fill()` | 点击 → 全选 → `page_type {entry:"paste"}`（**三步**，见下） |
| `locator.pressSequentially()` | `page_type`，在光标处追加 |
| `expect(locator)` | `page_wait` 轮询，直到元素出现/消失 |
| `page.waitForLoadState()` | `page_wait_load` |
| `page.screenshot()` | `page_screenshot`，返回 `content[1]` 的图片字节 |
| `page.content()` | `page_source` |
| `page.evaluate()` | `page_script` |

`fill()` 为什么是三步：`page_type` 底层用 `Input.insertText`，**只在光标处插入、不清空**已有内容。
要 Playwright 的「覆盖」语义，必须先点进控件、全选、再插入。

## 8. 已知限制

| 限制 | 原因 | 现状 |
| --- | --- | --- |
| `goto()` 不知道「网络空闲」 | 只有 `did-stop-loading` | 用 `waitForLoadState()` 或 `locator.waitFor()`；也可以等 `tab.navigation` 事件 |
| 没有 `page.waitForResponse()` | 事件是长轮询拿到的批量流，没有按请求挂起的原语 | 用 `bp.events({types:['net.response']})` 自己筛 |
| Linux 无头仍需 `Xvfb` | Electron 起 BrowserWindow 需要 display | CI 里 `xvfb-run`；SDK 在 `DISPLAY` 缺失时给出明确提示 |
| 二进制没有代码签名 | 项目本身如此 | macOS 首次运行可能需要 `xattr -cr` |
| 一次只能有一个 App 实例 | 单实例锁 | 并发测试靠「环境」隔离，不靠进程隔离 |

## 9. 验证

单元测试对假服务端跑，三套都不需要真机（CI 的 `sdk` job 就是这三条命令）：

```bash
cd sdk/node   && node build.mjs && node test/sdk.test.mjs      # 19
cd sdk/python && python -m unittest discover -s tests          # 44
cd sdk/go     && go test ./...                                 # 50
```

真机冒烟对着正在运行的 BrowserPilot 跑，三个语言各一条：

```bash
node sdk/scripts/smoke.mjs
python sdk/python/scripts/smoke.py
cd sdk/go && go run ./cmd/smoke
```

默认读系统的 `mcp.json`；换端点用 `BROWSERPILOT_MCP_FILE` 指。每个脚本都做同一串动作：
连端点 → 开标签 → 导航到 example.com → 截图 → `waitForText('Example')` → `count('p')` → 收 3 秒事件。

最近一次三语言真机结果（App v0.19.0）：Node 759ms、Python 703ms、Go 502ms，
截图都是 101202 字节，事件都是 7 条（`tab.navigation` / `tab.title` / `tab.loading` / `tab.favicon` / `page.console`）。

工具目录快照用脚本生成，别手改：

```bash
node sdk/scripts/dump-tools.mjs     # → sdk/spec/tools.json（100 个工具）
```

发版前对齐三个语言的版本号（和根 `package.json` 同号）：

```bash
node sdk/scripts/sync-version.mjs   # → node/package.json、version.ts、pyproject.toml、install.py、go/version.go、spec/versions.json
```

## 10. 目录

```
sdk/
  spec/tools.json        工具快照（名字、描述、参数 schema），由 dump-tools.mjs 从运行中的 App 生成
  spec/versions.json     SDK 版本 → App 版本
  python/                pip 包
  node/                  npm 包
  go/                    Go module
  scripts/               smoke.mjs / dump-tools.mjs / sync-version.mjs
```
