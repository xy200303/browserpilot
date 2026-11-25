# browserpilot (Node)

用 Playwright 的方式驱动 [BrowserPilot](https://github.com/xy200303/browserpilot) 桌面浏览器。

它不下载一个额外的浏览器：你机器上那扇 BrowserPilot 窗口就是被驱动的对象，
登录态、书签、密码都还在原来的地方。

```bash
npm install browserpilot-sdk
```

```ts
import { launch } from 'browserpilot-sdk'

const bp = await launch()
const page = await bp.newPage()
await page.goto('https://example.com')
console.log(await page.title())
await page.screenshot({ path: 'shot.png' })
await bp.close()
```

## 第一次运行

`launch()` 按这个顺序找 BrowserPilot：

1. `BROWSERPILOT_EXE` 环境变量
2. **已经在跑的实例**（读 `%APPDATA%\BrowserPilot\mcp.json`，探活）——有就直接连，不再启动
3. 桌面版安装位置（Windows `%LOCALAPPDATA%\Programs\BrowserPilot\`，macOS `/Applications`，Linux `/opt`）
4. `~/.browserpilot/sdk/<version>/` 里 SDK 自己装的那份
5. 都没有才下载：GitHub Release，SHA-256 校验，解压到 `~/.browserpilot/sdk/<version>/`

已经装过桌面版的人不会触发下载，也不会多出一份应用。

## 常用操作

```ts
// 定位：text → role+name → selector，按这个顺序落到工具参数上
await page.getByText('登录').click()
await page.getByRole('button', { name: '登录' }).click()
await page.locator('#submit').click()
await page.getByRole('button', { name: '登录' }).nth(1).click()

// 输入：fill 覆盖，type 追加
await page.getByLabel('账号').fill('小明')
await page.locator('#note').type('（补充）')

// 等待
await page.waitFor('.done')                       // selector / xpath：走原生 page_wait
await page.waitForText('提交成功')                 // 文本：走 Ctrl+F 原生查找
await page.getByRole('button', { name: '保存' }).waitFor()

// 读取
await page.title()
await page.url()
await page.content('response')                    // 这次导航的原始 HTML
await page.evaluate(() => document.querySelectorAll('a').length)
await page.consoleLogs()                          // 页面报错先看这个

// 事件：response / request 会自动开抓包，最后一个订阅取消时关掉
const off = await page.on('response', (e) => console.log(e.payload.status, e.payload.url))
await page.goto('https://example.com')
off()

// 等一个响应：先挂好抓包再开始等，先等再导航不会漏
const api = await page.waitForResponse('api/user', { timeout: 10 })
console.log(api.payload.status, api.payload.mimeType)

// 截图（默认带 100px 坐标网格，照着刻度就能直接算点击坐标；要干净图传 grid: false）
await page.screenshot({ path: 'a.png' })
await page.screenshot({ target: page.locator('#chart') })

// iframe：page_query / page_wait 只看主文档，count 对 iframe 里的元素返回 0
const tab = await bp.tab(page.id)                  // 明确绑定，别用 bp.locator() 猜第一页
const frame = await tab.frameLocator('iframe#editor')
await frame.locator('#save').click()               // 点击 / 输入走 App 的 frame 通道
await frame.count('#row')                          // 计数 / 文本 / 等待走 page_script
await tab.waitForFunction("document.body.innerText.includes('已保存')")

// 弹窗默认自动应答；要让某个确认框点「确定」，提前放策略
await page.acceptDialog({ once: true })
// 点了没反应先看遮罩；上传直接给 file input；查找 / 监听 / 人工交接
await page.overlays()
await page.upload(['a.pdf'], page.locator('#file'))
await page.find('订单号')
await page.watch('#price', { timeout: 30 })
await page.handoff('该你输验证码了')

// cookie：按环境导出、注入，掉登录不用重扫
const saved = await page.cookies()
await page.addCookies(saved)
await page.clearCookies({ name: 'sid' })

// 99 个工具里没被封装的，直接调
await bp.call('net_start', { tabId: page.id })
await bp.call('workflow_run', { name: '每日签到' })
```

## 环境

BrowserPilot 是单实例应用：进程只有一个，但**窗口可以开很多，一个环境一扇窗口**。
隔离单位是「环境」（一套 cookie / 登录态），不用为了隔离再起一个进程：

```ts
const bp = await launch({ env: 'env-default' })
const work = bp.environment('env-k3j9')
await work.open({ headless: true })
const page = await work.newPage()
```

## 关闭

`close()` 只收拾自己开的东西：如果 BrowserPilot 本来就在跑，它什么都不做。
SDK 启动的进程是 detached 的，脚本崩了不会把你的浏览器一起带走。

## 配置

| 环境变量 | 作用 |
| --- | --- |
| `BROWSERPILOT_EXE` | 指定 App 可执行文件 |
| `BROWSERPILOT_HOME` | 改 `~/.browserpilot` 的位置 |
| `BROWSERPILOT_OFFLINE=1` | 只找不下载 |
| `BROWSERPILOT_STRICT_VERSION=1` | 已装版本和 SDK 不一致时报错 |
| `BROWSERPILOT_DEBUG=1` | 打印发现/启动过程 |
| `GITHUB_TOKEN` | 下载时提高 GitHub API 限流额度 |

## 事件

`page.on()` 支持 `response`、`request`、`navigation`、`console`、`loading`，返回取消函数。
`on()` 是 async 的：`await` 返回时抓包已经挂好，紧接着导航不会漏掉首批请求。
`response` / `request` 会在订阅时自动 `net_start`，最后一个订阅取消时 `net_stop`；取消会立刻
掐断在途的长轮询，不会留后台请求。

```ts
const seen = []
const off = await page.on('response', (e) => seen.push(e.payload.url))
await page.goto('https://example.com')
off()

// 字符串按子串匹配，也可以传 RegExp
const res = await page.waitForResponse(/\/api\/user\/\d+/, { timeout: 10 })
```

`waitForResponse()` 会先挂好抓包再开始等，所以「先 `waitForResponse` 再 `goto`」不会漏掉首批请求。
超时抛 `NotFoundError`。

## 限制

- `goto()` 只等到 `did-stop-loading`，没有 networkidle
- `waitFor()` 支持 selector / xpath / 文本 / role；`label`、`placeholder` 请改写成 selector
- 一次只能有一个 App 实例，并发测试靠环境隔离

完整契约见 [`../README.md`](../README.md)。
