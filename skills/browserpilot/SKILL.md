---
name: browserpilot
description: >-
  通过 BrowserPilot 操作本机浏览器：环境、标签、点击、工作流和工作流市场。
  用户要求打开网页、沿用已登录的环境、执行或编写工作流、从 GitHub 下载工作流时使用。
---

# BrowserPilot

BrowserPilot 是给 Agent 用的本机浏览器。一个进程里可以开多套环境，一套环境一扇窗口，同一套环境里的标签共享登录。不要另开 Chrome，也不要再启动一份 BrowserPilot。

## 安装

用户把 README 里的那句话发给你时，按下面做完，不要改其它 MCP 服务器。

1. 把本文件安装到你自己的用户级 skills 目录，目录名用 `browserpilot`。
2. 读取本机端点文件。Windows 是 `%APPDATA%\BrowserPilot\mcp.json`，macOS 是 `~/Library/Application Support/BrowserPilot/mcp.json`，Linux 是 `~/.config/BrowserPilot/mcp.json`。
3. 文件不存在时，请用户先打开一次 BrowserPilot，并在设置里打开 MCP。
4. 只注册名为 `browserpilot` 的这一条。`Authorization` 的值是 `Bearer ` 加上文件里的 `token`。不要在回复、日志或仓库里打印令牌。
5. BrowserPilot 要开着。关掉之后这些连接都会失败。

## 命令行

MCP 不可用时，在 Windows 上运行 `browserpilot`。它读取上面的 `mcp.json`。窗口没开时，这条命令会先启动 BrowserPilot。

```text
browserpilot tools
browserpilot schema workflow_run
browserpilot call workflow_list
browserpilot call workflow_run --json-file args.json
```

中文参数写进 UTF-8 的 JSON 文件，用 `--json-file`。不要在命令行里手写带中文的 `--json`。

## 操作

环境编号是 `env-`。默认环境是 `env-default`，名称是「默认」，不能删除。没写 `env` 就用它。人新建的窗口都是有头的。`env_open` 才可以 `headless: true`。关掉窗口不清登录。

标签编号是 `tab-`，全局唯一，关掉后不复用。只给 `tab-` 就能在所有窗口里找到。找不到就失败，不要另开一个标签。所有工具的标签参数都叫 `tabId`，不叫 `tab`。传错参数名会直接报错并列出合法参数。

定位只用 `xpath` 或 `selector`。点击、输入、粘贴、选择必须恰好匹配一个元素。匹配到多个就停，不取第一条。画布上没有稳定节点时，`page_click` 用 `x` 和 `y`；按截图点坐标时，把 `page_screenshot` 返回的 `width`、`height` 原样传给 `shotWidth`、`shotHeight`；按 `captcha_panel` 这类裁剪图点坐标时，再带上 `shotX`、`shotY`（rect 前两个值）和 `shotScale`（scale）。

导航后或触发异步渲染后用 `page_wait` 等元素出现或消失，不要写死 sleep 循环。`page_key` 的快捷键用 `ctrl+a`、`shift+enter` 这种写法，修饰键只认 ctrl、shift、alt、meta。

定位器默认只查顶层文档。加 `pierce: true` 可穿透 Shadow DOM 和同源 iframe（点击、输入、查询、等待都支持），穿透查到的目标会先滚进视口再点。跨域 iframe 进不了定位器：用 `page_script` 的 `frame` 参数（填框架 URL 的一段，如 graph.qq.com）在那个框架里跑脚本，或者用坐标点击、输入（CDP 输入能穿透，`page_type` 也支持 x、y 坐标直接打字）。

拖拽要精确距离时用 `page_drag`（起点 + `dx`/`dy`，轨迹拟人），不要用 `page_swipe`。要连着发一组 CDP（比如按下、移动、松开的输入序列）用 `page_cdp_batch`，中间不断开调试会话。

验证码：滑块用 `captcha_detect` / `captcha_solve`（识别、拖拽、结果检查一次完成，`engine` 可选 cv / ddddocr / onnx，默认 auto）。其它类型（图标点选、五子棋、交换消除等）用 `captcha_panel` 把验证码区域截成图，你自己读图算出点击位置或移动方向，按返回的 `mapping` 把图上传像素换算成 CSS 坐标，再用 `page_click` 或 `page_drag` 操作。点选类点完要按面板上的确认按钮（OK）；五子棋和交换消除是「点一下起点、再点一下目标」，不是拖拽。操作完用同样的截图确认结果，失败就重新截新题目再来。

一次任务用已经打开的环境和标签。做完调用 `page_unlock`，遮罩不要留着。需要人接手时用 `page_handoff`。

工作流用 `workflow_list` 查看，用 `workflow_run` 一次跑完。`name` 是工作流名称，`inputs` 的键是开始节点里的参数名。不要把图拆成逐步点击，除非用户明确要改这张图。目录里的工作流要先在「工作流」页安装到本机，之后仍然用 `workflow_run` 按名称执行。
