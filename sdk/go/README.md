# BrowserPilot Go SDK

用 Go 以编程方式驱动 BrowserPilot 桌面浏览器，接口照着 Playwright 的样子做。

SDK **不自带浏览器引擎**，它驱动的是你机器上那扇 BrowserPilot 窗口：登录态、书签、密码都还在，
Agent 和你的脚本操作的是同一套 cookie。隔离单位是「环境」（`env-`），一套环境一套 cookie。

```bash
go get github.com/xy200303/browserpilot/sdk/go
```

## 快速开始

```go
package main

import (
	"context"
	"log"

	browserpilot "github.com/xy200303/browserpilot/sdk/go"
)

func main() {
	ctx := context.Background()

	bp, err := browserpilot.Launch(ctx, browserpilot.WithHeadless(true))
	if err != nil {
		log.Fatal(err)
	}
	defer bp.Close()

	page, err := bp.NewPage(ctx, "") // "" = 新标签页
	if err != nil {
		log.Fatal(err)
	}
	if err := page.Goto(ctx, "https://example.com"); err != nil {
		log.Fatal(err)
	}
	if err := page.GetByRole("button", browserpilot.Name("登录")).Click(ctx); err != nil {
		log.Fatal(err)
	}
	if err := page.GetByLabel("账号").Fill(ctx, "小明"); err != nil {
		log.Fatal(err)
	}
	image, err := page.Screenshot(ctx, browserpilot.WithPath("a.png"))
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("截图 %d 字节", len(image))
}
```

已经有一个实例在跑时，`Launch` 直接连上去，**不会拉起第二个**（App 是单实例的，第二个会自己退出）。
只想连、不想启动任何进程，用 `Connect`；`Close` 只关 SDK 自己开的环境，连别人的实例时什么都不做。

## 找 BrowserPilot 的顺序

先找已经装好的，再考虑下载——用户机器上那份桌面版就是首选，因为登录态都在它那儿。

| 顺序 | 条件 | 说明 |
| --- | --- | --- |
| 1 | `BROWSERPILOT_EXE` / `WithExe` | 指向可执行文件，优先级最高，CI 里常用 |
| 2 | 已经在跑的实例 | 读 `mcp.json` 并 `GET` 探活，通了直接连，**不启动进程** |
| 3 | 桌面版安装位置 | Windows `%LOCALAPPDATA%\Programs\BrowserPilot\`、macOS `/Applications/BrowserPilot.app`、Linux `/opt/BrowserPilot/` |
| 4 | SDK 自己的缓存 | `~/.browserpilot/sdk/<version>/` |
| 5 | 下载 | 从 GitHub Release 取 `v<version>` 的资产 |

第 3 步用「同目录下有没有 `resources/app.asar`」确认那真是应用本体，而不是同目录的 `cli/browserpilot`。
`BROWSERPILOT_HOME` 可以改 `~/.browserpilot` 的位置。

发布产物只有三个平台，别的组合直接报 `*Error`（`Code == CodeInstallError`），不会下到一半才崩：

| 平台 | 架构 | 资产 | 状态 |
| --- | --- | --- | --- |
| Windows | x64 | `BrowserPilot-<v>-win.zip` | 支持 |
| macOS | arm64 | `BrowserPilot-<v>-arm64-mac.zip` | 支持 |
| Linux | x64 | `BrowserPilot-<v>.AppImage` | 支持 |
| Windows | arm64 / macOS x64 / Linux arm64 | — | 不支持 |

下载边下边算 SHA-256，和 API 返回的 `digest` 比对；临时文件用 `.part` 后缀，失败不会留下半个可执行文件。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `BROWSERPILOT_EXE` | 指定 App 可执行文件，优先级最高 |
| `BROWSERPILOT_HOME` | 改 `~/.browserpilot`（下载缓存、便携副本）的位置 |
| `BROWSERPILOT_OFFLINE=1` | 只找不下载，找不到就报错 |
| `BROWSERPILOT_STRICT_VERSION=1` | 已装版本和 SDK 不同号时报错而不是警告 |
| `BROWSERPILOT_DEBUG=1` | 把过程日志打到 stderr |
| `GITHUB_TOKEN` | 查 Release 时带上，避免 GitHub API 限流 |

## 选项

`Launch` / `Connect` 都收 `Option`：

| 选项 | 作用 |
| --- | --- |
| `WithEnv(id)` | 用哪套环境，默认 `env-default` |
| `WithHeadless(bool)` | 把窗口切成无头（窗口仍然存在，只是不显示） |
| `WithTimeout(d)` | 等 App 起来的时长，默认 60 秒；第一次下载不占这个时间 |
| `WithExe(path)` | 显式指定可执行文件 |
| `WithVersion(v)` | 指定要装的 App 版本，默认跟 SDK 同号 |
| `WithEndpoint(Endpoint{URL, Token})` | 直接连已知端点，跳过发现流程 |
| `WithOffline(bool)` | 只找不下载 |
| `WithStrictVersion(bool)` | 版本不一致时报错 |
| `WithDownloadProgress(func(Progress))` | 收下载进度 |
| `WithLogger(func(string))` | 收过程日志 |

## 错误

所有错误都是 `*browserpilot.Error`，带 `Code`、`Tool`、`Payload`：

```go
err := page.GetByRole("button", browserpilot.Name("登录")).Click(ctx)
switch {
case browserpilot.IsToolError(err):      // 工具跑了但失败（HTTP 200 + ok:false）
	log.Printf("工具 %s 失败：%v，载荷 %#v", err.(*browserpilot.Error).Tool, err, err.(*browserpilot.Error).Payload)
case browserpilot.IsTransportError(err): // 连不上、超时、token 不对、响应不是 JSON
case browserpilot.IsInstallError(err):   // 找不到也装不上 BrowserPilot
case browserpilot.IsNotFoundError(err):  // 定位器没命中，或这个工具不支持这种定位方式
}
```

工具失败**不是** HTTP 失败：工具名不存在、参数拼错都返回 `200 OK`，错误在载荷里
（`content[0].text` 解析出的 `{"ok": false, "error": "..."}`）。SDK 已经替你区分好，别拿状态码判错。

## API

### BrowserPilot

```go
bp.EnvID()      // 默认环境
bp.SDKVersion() // 本 SDK 版本
bp.AppVersion() // App 版本；连别人实例时拿不到，返回空串
bp.NewPage(ctx, url)          // 标签
bp.Pages(ctx)                 // 所有标签
bp.Environments(ctx)          // 所有环境
bp.Environment(id)            // 环境句柄
bp.Call(ctx, tool, args)      // 原始工具调用，参数原样透传
bp.Close()
```

### Environment

```go
env := bp.Environment("env-default")
env.Open(ctx, true)  // true = 无头
env.NewPage(ctx, "https://example.com")
env.Pages(ctx)
env.Close(ctx)       // 关窗但保留登录态
```

### Page

```go
page.Goto(ctx, url); page.Reload(ctx); page.Back(ctx); page.Forward(ctx)
page.WaitForLoad(ctx)
page.URL(ctx); page.Title(ctx)

page.Click(ctx, "#submit")
page.Fill(ctx, "#name", "小明")
page.Type(ctx, "#name", "追加")
page.Press(ctx, "Control+Enter")
page.Hover(ctx, "#menu")
page.Select(ctx, "#city", "北京")
page.Scroll(ctx, browserpilot.WithScrollDirection("up"))
page.ScrollTo(ctx, "#bottom")

page.WaitFor(ctx, ".done")
page.WaitFor(ctx, ".loading", browserpilot.WithState("gone"))
page.WaitForText(ctx, "完成")   // Ctrl+F 原生查找，不走 DOM
page.ExpectText(ctx, "完成")    // 同上，读起来像断言

page.Count(ctx, "#item")
page.IsVisible(ctx, "#item")
page.TextContent(ctx, "#item")
page.Content(ctx)
page.Snapshot(ctx)             // 无障碍树，Agent 看页面主要靠它
page.Evaluate(ctx, "document.title")
page.ConsoleLogs(ctx)          // 轮询快照；要被动接收用 page.On
page.On(ctx, browserpilot.EventResponse, func(event browserpilot.EventRecord) {
	log.Println(event.Payload["status"], event.Payload["url"])
}) // 返回取消函数；response / request 自动开抓包
page.WaitForResponse(ctx, "api/user", 10*time.Second)
page.Screenshot(ctx, browserpilot.WithPath("a.png"))
page.BringToFront(ctx); page.Close(ctx)
page.ID(); page.Env()
```

### Locator

```go
page.GetByRole("button", browserpilot.Name("登录"))
page.GetByText("登录")
page.GetByLabel("账号")
page.GetByPlaceholder("请输入")
page.GetByTestID("submit")
page.Locator("#submit")
page.XPath("//button[1]")

locator.Nth(2).Click(ctx)
locator.First().Click(ctx)
locator.Within("#form").Click(ctx)
locator.Pierce().Click(ctx)     // 进 shadow DOM 和同源 iframe
locator.DblClick(ctx)
locator.SelectOption(ctx, "北京")
locator.Screenshot(ctx)
```

## 几个必须知道的语义

**`Fill` 为什么可能是三次调用**：`page_type` 底层用 `Input.insertText`，**只在光标处插入、不清空**已有内容。
要 Playwright 的「覆盖」语义，selector / xpath 走一次 `page_type {via:"inject"}`；
label / placeholder / role=textbox|searchbox|combobox+name 则要走「聚焦 → 全选（macOS 是 `Meta+A`，其余 `Control+A`）→ 粘贴」。

**`Click` 的匹配顺序**：text → role+name → selector/xpath → testId/alt，再加上 `within`、`index`。
工具不支持全部定位方式，所以顺序是固定的，不是随机的。

**`WaitFor` 走哪条路**：selector / xpath 走原生 `page_wait`；文本走 `page_find` 轮询（结束时一定发 `stop:true` 收掉高亮）；
role+name 走无障碍树轮询；label / placeholder 没有通道，会直接返回 `IsNotFoundError` 并提示改写成 selector。

**截图默认 `grid:false`**：App 默认会画一层坐标网格（给人估坐标用的），脚本里那是噪点，需要时用 `WithGrid(true)` 打开。

## 事件

页面级：`On` 返回取消函数，回调跑在独立 goroutine。`response` / `request` 订阅时自动
`net_start`，最后一个订阅取消时 `net_stop`；取消会立刻结束在途的长轮询。

```go
stop := page.On(ctx, browserpilot.EventResponse, func(event browserpilot.EventRecord) {
    fmt.Println(event.Payload["status"], event.Payload["url"])
})
page.Goto(ctx, "https://example.com")
stop()

// match 可以是 string（子串）或 *regexp.Regexp；返回前抓包已经挂好
record, err := page.WaitForResponse(ctx, "api/user", 10*time.Second)
if err != nil {
    log.Fatal(err) // 超时是 CodeNotFound
}
fmt.Println(record.Payload["status"], record.Payload["mimeType"])
```

事件名：`EventResponse`、`EventRequest`、`EventNavigation`、`EventConsole`、`EventLoading`；
不在常量里的按原始事件类型处理（比如 `"net.response"`）。

`WaitForResponse` 是阻塞调用：要覆盖一次点击/导航触发的请求，把它放进 goroutine 先等，
再在主 goroutine 里执行动作（或直接用 `On` 先订阅）。

客户端级（所有环境）：

```go
before, _ := bp.Call(ctx, "env_list", nil)
page.Goto(ctx, "https://example.com")

since := int64(before["seq"].(float64))
sub := bp.Subscribe(ctx, browserpilot.EventWaitOptions{Since: &since})
defer sub.Close()
for event := range sub.C {
    fmt.Println(event.Type, event.Payload)
    break
}
```

`Subscribe` 内部是长轮询循环，自动带 `seq` 续传；需要一次拿一批就用 `bp.Transport().WaitEvents`。

## 已知限制

| 限制 | 原因 |
| --- | --- |
| `On` 的回调跑在独立 goroutine | 没有推送通道，底层是长轮询；回调里别直接 `t.Fatal` 之类退出进程 |
| `Goto` 不知道「网络空闲」 | 只有 `did-stop-loading`；用 `WaitForLoad`、locator 的 `WaitFor` 或 `WaitForResponse` |
| Linux 无头仍需 `Xvfb` | Electron 起 BrowserWindow 需要 display，`DISPLAY` 缺失时 App 自己会报错 |
| 一次只能有一个 App 实例 | 单实例锁；并发测试靠「环境」隔离 |
| `WithGrid` 只接受 bool | Node 版还支持传数字当网格间距，Go 这边需要的话用 `Page.Call` 直发 |
| `Evaluate` 只能传源码字符串 | Go 函数不能像 JS 那样 `toString`；自己写成 `(() => { ... })()` 再传 |
| Unix 上没做 `setsid` | 为了只用标准库、不带平台专用文件；进程仍独立于父进程，只有整个终端会话被拆掉时可能一起退出 |
| `WithTimeout` 只管等 App 启动 | 单次工具调用的超时走 `WithClickTimeout` 或 `Call` 的默认值（120 秒） |

## 测试

用 `net/http/httptest` 起一个假的 MCP 端点（Bearer 鉴权、图片拆成第二个 content part、工具错误是 200 + `ok:false`），
全部离线，不启动也不下载真的 App：

```bash
cd sdk/go
go test ./...
```

下载/解压/SHA-256 校验也有一组用假 GitHub Release API 的测试。
