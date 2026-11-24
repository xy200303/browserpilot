Windows、macOS 和 Linux 安装包。命令行 `browserpilot` 打进安装包的 `cli` 目录。

## 新增

- **SDK 事件监听**：`page.on(event, handler)` 在 Python / Node / Go 三个 SDK 里同名同语义，
  支持 `response` / `request` / `navigation` / `console` / `loading`。
  - `response` / `request` 订阅时自动开抓包（`net_start`），按订阅计数，最后一个取消才 `net_stop`
  - 取消会立刻结束在途长轮询（Node 用 `AbortSignal`，Go 用 context，Python 最多一次轮询）
  - `page.waitForResponse()` / `page.wait_for_response()` / `page.WaitForResponse()` 等第一个
    URL 匹配的响应，字符串按子串、也支持正则；超时抛 `NotFoundError`，不会一直等下去
  - 未知事件名在 Node / Python 直接报错，不会退化成订阅全部事件
- **历史写盘攒批**：导航产生的历史记录在内存里立刻更新，300ms 内合并成一次批量写入，
  退出前统一 flush，减少并发导航时主线程上的 SQLite 排队。
- **布局请求按环境合并到一帧**：多标签同时加载时不再每个标签各做一次全量布局。

## 说明

- 安装包没有代码签名。
- 这一版的数据格式和 0.20.x 一致，不需要迁移。
- SDK 三个包（npm / PyPI / Go）同时发 0.21.0，和 App 同号。
