---
title: 可复制用例
description: 五个真实用例：抓 GitHub 话题榜单导出 CSV、填 httpbin 表单、批量保存图片、多标签截图、用系统计划任务做定时巡检。每个都给完整输入与预期输出。
---

# 可复制用例

下面每个用例都在 0.13.13 上跑过。参数按原样写；站点是公开、无需登录的，涉及账号的步骤会单独说明。

## 1. 抓 GitHub 话题榜单，导出 CSV

**输入**：话题 `browser-automation`。

```text
tab_open    { "url": "https://github.com/topics/browser-automation" }
page_wait   { "selector": "article", "timeout": 20 }
page_query  { "selector": "article" }
page_script { "source": "(() => { const cards = [...document.querySelectorAll('article')].slice(0, 5); return { rows: cards.map((card) => { const repo = (card.querySelector('h3')?.innerText || '').trim(); const href = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').find((h) => h.startsWith('/') && h.split('/').filter(Boolean).length === 2) || ''; const star = ((card.innerText || '').split('Star ')[1] || '').split(String.fromCharCode(10))[0].trim(); const desc = (card.querySelector('p')?.innerText || '').trim(); return [repo, star, desc, href ? 'https://github.com' + href : '']; }) }; })()" }
```

**存成工作流**：把这四步换成节点「打开 → 等待 → 页面脚本 → 导出」，导出文件名 `github-topics.csv`，表头 `仓库,Star,简介,链接`，行取页面脚本的 `rows`。之后一次 `workflow_run` 就能跑完。

**预期输出**（2026-10-18 实际导出，Star 会变）：

```csv
仓库,Star,简介,链接
browser-use / browser-use,118k,"Open-source Python library for AI browser agents, plus Browser Use Cloud: stealth browsers and a hosted agent API.",https://github.com/browser-use/browser-use
lightpanda-io / browser,36.7k,Lightpanda: the headless browser designed for AI and automation,https://github.com/lightpanda-io/browser
CloakHQ / CloakBrowser,32.3k,Stealth Chromium that passes every bot detection test. Drop-in Playwright replacement with source-level fingerprint patches. 50+ tests passed.,https://github.com/CloakHQ/CloakBrowser
feder-cr / invisible_dots,32.1k,"Open-source, self-hosted alternative to OpenAI Dots, Grok Bot. Built to be undetectable by anti-bot systems.",https://github.com/feder-cr/invisible_dots
jackwener / OpenCLI,30.4k,Make Any Website into CLI & Use your logged-in browser by AI agent.,https://github.com/jackwener/OpenCLI
```

文件落在 `%APPDATA%\BrowserPilot\exports\github-topics.csv`，带 BOM，Excel 直接打开不乱码。

## 2. 填一张真实表单并读回 JSON

目标：`https://httpbin.org/forms/post`。这个页面会把你提交的内容原样回显成 JSON。

```text
tab_open    { "url": "https://httpbin.org/forms/post" }
page_wait   { "selector": "input[name=custname]", "timeout": 15 }
page_type   { "selector": "input[name=custname]", "text": "BrowserPilot Demo" }
page_type   { "selector": "input[name=custtel]", "text": "10000000000" }
page_type   { "selector": "input[name=custemail]", "text": "demo@browserpilot.dev" }
page_click  { "selector": "input[name=size][value=large]" }
page_click  { "selector": "input[name=topping][value=cheese]" }
page_type   { "selector": "textarea[name=comments]", "text": "less salt" }
page_click  { "selector": "button", "untilSelector": "pre" }
page_script { "source": "(() => ({ url: location.href, text: document.body.innerText.slice(0, 600) }))()" }
```

**预期输出**（节选）：

```json
{
  "url": "https://httpbin.org/post",
  "form": {
    "comments": "less salt",
    "custemail": "demo@browserpilot.dev",
    "custname": "BrowserPilot Demo",
    "custtel": "10000000000",
    "delivery": "",
    "size": "large",
    "topping": "cheese"
  }
}
```

要点：`page_click` 的 `untilSelector` 会在点完后等 `pre` 出现，最多重试 3 次；不要写死 sleep。

## 3. 批量保存三张图片

目标：httpbin 的三张示例图。每张图单独一个标签，保存到指定路径；走环境自己的 Cookie 与 UA。

```text
tab_open        { "url": "https://httpbin.org/image/png" }
page_inspect    { "selector": "img" }
page_save_media { "selector": "img", "savePath": "C:\out\httpbin.png" }

tab_open        { "url": "https://httpbin.org/image/jpeg" }
page_inspect    { "selector": "img" }
page_save_media { "selector": "img", "savePath": "C:\out\httpbin.jpg" }

tab_open        { "url": "https://httpbin.org/image/svg" }
page_inspect    { "selector": "img" }
page_save_media { "selector": "img", "savePath": "C:\out\httpbin.svg" }
```

**预期输出**：每个 `page_inspect` 返回 `kind: "image"` 与 `src`；每个 `page_save_media` 返回本机路径、`kind` 与字节数。实测 PNG 是 8,090 字节。

批量时把三组调用放进一个 `loop` 节点，列表放 URL；或直接用 `workflow_batch` 跑三个输入。

## 4. 多标签同时截图

用途：给一组页面留档，或给「看图点坐标」准备基准图。

```text
tab_open       { "url": "https://github.com/topics/browser-automation" }
page_screenshot {}
tab_open       { "url": "https://github.com/topics/headless-browser" }
page_screenshot {}
tab_open       { "url": "https://github.com/topics/web-scraping" }
page_screenshot {}
```

**预期输出**：每次返回 `path`、`width`、`height`。截图落在 `%APPDATA%\BrowserPilot\screenshots\shot-<时间戳>.png`，尺寸是当前视口，不是整页。

需要按截图坐标点击时，把返回的 `width`、`height` 原样传给 `page_click` 的 `shotWidth`、`shotHeight`；裁剪图再带 `shotX`、`shotY`、`shotScale`。

## 5. 定时巡检：系统计划任务 + 工作流

BrowserPilot 没有内置定时器。用它跑定时任务，靠系统计划任务调用 CLI。

先做一个工作流「话题巡检」：

| 节点 | 配置 |
| ---- | ---- |
| 开始 | 参数 `话题`，必填 |
| 打开 | `https://github.com/topics/&#123;&#123;#input.话题#&#125;&#125;` |
| 等待 | 选择器 `article`，超时 20 秒 |
| 页面脚本 | 取 `document.title`、前 5 个仓库名、抓取时间，返回 `rows` |
| 导出 | `巡检.csv`，表头 `时间,标题,仓库`，行取页面脚本的 `rows` |

然后写一个 bat：

```bat
set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" call workflow_run --name "话题巡检" --json-file C:\tasks\watch.json
```

`watch.json`：

```json
{ "话题": "browser-automation" }
```

注册每天 09:00：

```bat
schtasks /Create /TN "BrowserPilot 话题巡检" /SC DAILY /ST 09:00 /TR "C:\tasks\browserpilot-watch.bat"
```

**预期输出**：计划任务启动应用（最多等 45 秒），跑完写 `%APPDATA%\BrowserPilot\exports\巡检.csv`，并在运行记录里留一条成功/失败。每次覆盖同一个文件；要留历史，把导出文件名改成带日期变量的名字，或运行后复制走。

::: warning 前提
计划任务需要那台机器有图形会话，并且环境里的登录还有效。它不是服务器端的无头浏览器；锁屏/注销时不要指望它跑。
:::
