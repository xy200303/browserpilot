Windows、macOS 和 Linux 安装包。命令行 `browserpilot` 打进安装包的 `cli` 目录。

这一个版本动的是地基：数据的存放方式、环境的隔离单位、对外接口的形态。

## 存储

- 所有 JSON 改成原子写（`.tmp` + rename），解析失败的文件隔离成 `.corrupt-<时间戳>` 而不是静默清空。
- 工作流变成一文件一份 `workflows/<slug>.json`，slug 既是身份也是文件名；重名不再合并，导出直接拷文件。
- 历史换 SQLite，每套环境一个 `profiles/<env>/browserpilot/history.db`：一次导航只写一行，不再重写整份。
- 运行记录换 SQLite（`runs.db`），保留策略变成一条 `DELETE`。
- 老的 `history.json` / `runs.json` / `workflows.json` 在启动时自动导入，然后改名 `.migrated` 留着。

## 环境

- 一套环境 = 一个完整的 Chromium profile 目录 `profiles/<env>`，不再是 `Partitions/<env>`。旧的目录会在启动时自动搬过去，cookie 和登录态原样保留。
- 历史、书签、密码、权限、会话都按环境分文件存放，删环境就是删目录。
- Windows 上目录被 Chromium 占着删不掉时，先记进 `orphans.json`，下次启动在创建任何窗口之前再删。

## 接口

- `/mcp` 只接受 POST（GET 返回 405），新增程序面 `/api/tools`、`/api/call`、`/api/events`，同一个端口、同一个 token。
- 按 MCP 2026-07-28 校验 `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`，版本不支持返回 `-32022` 并列出支持的版本；未知方法返回 404。
- 新增长轮询事件通道：`seq` 单调递增、可续传，缓冲 2000 条 / 5 分钟。工具结果都带 `seq`，配套 `events_wait` 工具。
- 事件源：标签开关、导航、标题、图标、媒体、页面 console、控制权变化、网络请求、下载。
- 新增 `network_get` / `network_set`：每套环境独立代理（`direct` / `fixed` / `pac`）、UA、语言、WebRTC 策略，改完立刻生效。代理失败会明确报错，不会静默回退直连。

## SDK

Python、Node、Go 三个 SDK 都改走 `/api`，并加了事件订阅：

- Python：`pip install browserpilot-sdk`
- Node：`npm install browserpilot-sdk`
- Go：`go get github.com/xy200303/browserpilot/sdk/go`

## 还没做

- 每环境的时区和 locale 只存不生效（要 CDP `Emulation` 覆盖，并在每次主导航后重发）。
- 指纹引擎仍然是预留字段，没有实现。

## 说明

- 安装包没有代码签名。
- 首次启动会做一次数据迁移，环境多、历史多的话会多花几秒；迁移只做一次，重复启动是空操作。
