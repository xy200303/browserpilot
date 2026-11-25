# BrowserPilot Python SDK

用 Playwright 的样子驱动本机的 BrowserPilot 桌面浏览器。零运行时依赖，只用标准库，Python 3.9+。

SDK **不自带浏览器引擎**，它驱动的是你机器上那扇 BrowserPilot 窗口：登录态、书签、密码都还在，
脚本和 Agent 操作的是同一套 cookie。发现、下载、传输的行为和 Node 版逐条对齐。

## 安装

```bash
pip install browserpilot-sdk
```

源码目录里开发：

```bash
pip install -e sdk/python
```

## 快速开始

```python
from browserpilot import launch

# 也支持不加 with
with launch(headless=True) as bp:
    page = bp.new_page()
    page.goto("https://example.com")
    page.get_by_role("button", name="登录").click()
    page.get_by_label("账号").fill("小明")
    page.locator("#submit").click()
    page.get_by_text("完成").wait_for()
    page.wait_for_text("完成", timeout=10)
    page.screenshot(path="a.png")  # 返回 bytes
    print(page.title(), page.url())
    bp.close()
```

## 找 BrowserPilot 的顺序

**先找已经装好的，再考虑下载。** 用户机器上那份桌面版就是首选，因为登录态都在它那儿。

| 顺序 | 条件 | 说明 |
| --- | --- | --- |
| 1 | `BROWSERPILOT_EXE` 环境变量 | 指向可执行文件，优先级最高，CI 里常用 |
| 2 | 已经在跑的实例 | 端点文件存在且 `GET {api}/tools` 能通，直接连上，不启动任何进程 |
| 3 | 桌面版安装位置 | Windows `%LOCALAPPDATA%\Programs\BrowserPilot\`、macOS `/Applications/BrowserPilot.app`、Linux `/opt/BrowserPilot/` |
| 4 | SDK 自己的缓存 | `~/.browserpilot/sdk/<version>/` |
| 5 | 下载 | 只有在前面都失败时才发生 |

下载只在需要时进行：从 GitHub Release 取 `v<version>` 的资产，边下边算 SHA-256 和 API 的
`digest` 比对，临时文件用 `.part` 后缀，解压到 `~/.browserpilot/sdk/<version>/`。
平台矩阵只认实际发布过的三种：Windows x64（zip）、macOS arm64（zip）、Linux x64（AppImage），
其余组合直接报 `InstallError`，不会下到一半才崩。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `BROWSERPILOT_EXE` | 指定 App 可执行文件，跳过发现流程 |
| `BROWSERPILOT_HOME` | 改 `~/.browserpilot` 的位置（缓存和下载目录） |
| `BROWSERPILOT_OFFLINE=1` | 只找不下载，找不到直接报错 |
| `BROWSERPILOT_STRICT_VERSION=1` | 已装版本和 SDK 不一致时报错，而不是警告 |
| `BROWSERPILOT_DEBUG=1` | 把发现/启动的过程打到 stderr |
| `GITHUB_TOKEN` | 下载时带上，避免 GitHub API 限流 |

## API

### `launch(...)`

```python
launch(env=None, headless=None, timeout=60, exe=None, version=None,
       endpoint=None, offline=False, strict_version=False,
       on_download=None, log=None) -> BrowserPilot
```

- `env`：用哪套环境，默认 `env-default`
- `headless`：`True` 时把窗口切成无头（窗口仍然存在，只是不显示）；`False` 不会主动开窗，免得把用户正在用的窗口拉到前台
- `timeout`：等 App 起来的秒数，首次下载不占这个时间
- `endpoint`：直接连一个已知端点（`{"url": ..., "token": ...}` 或 `Endpoint`），跳过发现
- `on_download(progress)`：下载进度回调，`progress` 是 `{"asset", "received", "total"}`

已经在跑的实例只会被连上，**不会拉起第二个**（App 有单实例锁，第二个会自己退出）。

### `connect(endpoint=None, timeout=120, log=None)`

只连已经在跑的实例，没有就抛 `TransportError`。适合「必须用用户当前那扇窗口」的场景。

### `BrowserPilot`

| 成员 | 说明 |
| --- | --- |
| `new_page(url=None, env=None)` | `tab_open`，返回 `Page` |
| `pages()` | 所有标签 |
| `environments()` | 所有环境 |
| `environment(id)` | 取一套环境，可 `open()` / `close()` / `new_page()` / `pages()` |
| `call(tool, args=None)` | 原始工具调用，参数原样透传 |
| `locator(selector)` | 当前第一页上的定位器 |
| `close()` | 只关自己开的环境；连的是别人的实例时什么都不做 |
| `env_id` / `sdk_version` / `app_version` | `app_version` 只有 SDK 自己装的那份才知道 |

支持 `with`，退出时调用 `close()`。

### `Page`

| 成员 | 说明 |
| --- | --- |
| `goto` `reload` `back` `forward` | 导航，`goto` 内部已经等到 load 完成 |
| `wait_for_load(timeout=15)` | 等 `did-stop-loading` |
| `url()` `title()` | 从 `tab_list` 里读 |
| `get_by_role` `get_by_text` `get_by_label` `get_by_placeholder` `get_by_test_id` `locator` `xpath` | 定位器工厂 |
| `click` `fill` `type` `press` `hover` `select` `scroll` `scroll_to` | 动作 |
| `wait_for` `wait_for_text` `expect_text` | 等待 |
| `count` `is_visible` `text_content` `content` `snapshot` `evaluate` `console_logs` | 读取 |
| `on(event, handler)` `wait_for_response(match, timeout=30)` | 事件：`response` / `request` 自动开抓包；返回取消函数 |
| `screenshot(path=None, ...)` | 返回 `bytes`，给了 `path` 就顺手写一份 |
| `bring_to_front` `close` | 标签生命周期 |
| `call(tool, args=None)` | 原始调用，自动带 `tabId` |
| `id` / `env` | 标签 id 和所属环境 |

支持 `with page:`，退出时关掉这个标签。

### `Locator`

`click` `dblclick` `fill` `type` `hover` `select_option` `scroll_into_view` `wait_for`
`count` `is_visible` `text_content` `screenshot`，以及收窄用的 `nth` `first` `within` `pierce`。

`Page` 和 `Locator` 都接受三种定位目标：CSS 选择器字符串、`Locator`、
或者字典（`{"role": "button", "name": "登录"}`，键名同时认 `testId` 和 `test_id`）。

### iframe

`count()` 对 iframe 里的元素返回 0：`page_query` / `page_wait` 只看主文档。进 iframe 用 `Frame`：

```python
page = bp.tab(tab_id)                        # 先明确绑到哪个标签
frame = page.frame_locator('iframe#editor')  # 也可以 page.frames() 先看有哪些
frame.locator('#save').click()               # 点击 / 输入 / 悬停走 App 的 frame 通道
frame.count('#row')                          # 计数 / 文本 / 可见性 / 等待走 page_script
frame.wait_for('#saved')
page.wait_for_function("document.body.innerText.includes('已保存')")
```

`frame_locator` 按 iframe 元素的选择器解析 src；`page.frame('graph.qq.com')` 直接按 URL
片段取。同一个 URL 的多个 iframe 会命中第一个（App 的匹配规则），需要精确就用更长的片段。
定位失败时会说明原因：是在某个 iframe 里、被遮罩挡住，还是主文档就没有。

### 弹窗、上传、遮罩、监听

```python
page.dialogs()                     # 最近的弹窗 + 当前策略
page.accept_dialog(once=True)      # 让下一个确认框点「确定」
page.upload(['a.pdf'], page.locator('#file'))   # 塞文件，不弹系统框
page.overlays(), page.dismiss_overlays()        # 挡点击的广告/遮罩
page.find('订单号')                 # 页面内查找（Ctrl+F），page.find_stop() 清高亮
page.inspect(page.locator('#go'))  # kind/tag/text/rect；也可以传 x/y 按坐标反查
page.watch('#price', timeout=30, interval=0.5)  # 等文字或位置变化
page.lock(), page.handoff('该你输验证码了')      # 人工交接
```

### cookie

按环境隔离，掉登录时不用重扫：

```python
saved = page.cookies()        # 或 bp.cookies(env='env-default')
page.add_cookies(saved)       # 导出的列表原样注回去
page.clear_cookies(name='sid')
```

## 事件

页面级：`page.on(event, handler)` 返回取消函数，回调在后台线程里跑。
`response` / `request` 订阅时自动 `net_start`，最后一个订阅取消时 `net_stop`；取消后最多一次
长轮询（约 1 秒）收手。

```python
seen = []
off = page.on('response', lambda event: seen.append(event.payload.get('url')))
page.goto('https://example.com')
off()

# 字符串按子串匹配，也可以传 re.compile(...)；抓包在开始等之前就挂好了
res = page.wait_for_response('api/user', timeout=10)
print(res.payload['status'], res.payload['mimeType'])
```

支持的事件名：`response`、`request`、`navigation`、`console`、`loading`。
超时抛 `NotFoundError`；更细的匹配（方法、状态码）用 `page.on('response', ...)` 自己筛。
`wait_for_response` 是阻塞调用：要覆盖一次点击/导航触发的请求，先把它放进后台线程
（或先用 `page.on` 订阅），再执行动作。

客户端级（所有环境）：

```python
before = bp.call('env_list')                 # 任何工具结果里都有 seq
page.goto('https://example.com')

for event in bp.events(since=before['seq']):
    print(event.type, event.payload)
    break                                    # 生成器不会自己结束
```

一步拿一批、不等推送：`bp.transport.events(since=..., wait=25)`。
位置失效（App 重启或超出缓冲）时返回里带 `reset`，客户端应该用工具重建状态。

## 和 Playwright 不一样的地方

| 差异 | 原因 |
| --- | --- |
| `fill()` 要发三次调用（聚焦 → 全选 → 粘贴） | `page_type` 底层是 `Input.insertText`，只在光标处插入、不清空；selector/xpath 例外，一次 `via="inject"` 就够 |
| 不能开多个浏览器，隔离单位是「环境」 | App 是单实例应用 |
| 事件回调是后台线程 + 长轮询 | 没有推送通道；`page.on()` 负责线程和抓包，取消后最多约 1 秒收手 |
| `goto()` 不知道「网络空闲」 | 只有 `did-stop-loading`，需要时补 `wait_for_load()`、`locator.wait_for()` 或 `wait_for_response()` |
| `screenshot()` 默认 `grid=True` | 和 App 一致叠 100px 坐标网格，照着刻度就能直接算点击坐标；要干净图传 `grid=False`，传数字改间距（10–500） |
| `evaluate()` 只收 JS 源码字符串 | Python 函数没法序列化进页面；Node 版会把函数 `toString()` |
| `click()` 按 text → role+name → selector/xpath → testId/alt 映射 | 工具本身就按这个优先级找元素；`label` / `placeholder` 定位器点不了，得改写成 selector |

其他限制：Linux 无头仍然需要 `Xvfb`（Electron 起窗口要 display）；二进制没有代码签名，
macOS 首次运行可能需要 `xattr -cr`。

## 测试

```bash
cd sdk/python
python -m unittest discover -s tests -v
```

测试不联网、不启动真实 App：`tests/test_sdk.py` 里起一个假的 `/api` 端点（Bearer 鉴权、
`{tool, args}` 进、图片放同级的 `image`），断言 SDK 到底发出了哪些工具调用。
