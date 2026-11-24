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

// 截图（默认不画坐标网格，和 Playwright 一样干净）
await page.screenshot({ path: 'a.png' })
await page.screenshot({ target: page.locator('#chart') })

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

## 限制

- 没有 `page.on('response')`：MCP 是无状态 POST，没有订阅通道，只能轮询
- `goto()` 只等到 `did-stop-loading`，没有 networkidle
- `waitFor()` 支持 selector / xpath / 文本 / role；`label`、`placeholder` 请改写成 selector
- 一次只能有一个 App 实例，并发测试靠环境隔离

完整契约见 [`../README.md`](../README.md)。
