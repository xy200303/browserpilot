<table>
<tr>
<td valign="top">

<img src="resources/icon.svg" width="64" alt="BrowserPilot" />

# BrowserPilot

**你的浏览器，助手可以接着用。**

本机浏览器。登录留在本机的一套环境里。人打开窗口之后，Agent 继续操作同一扇窗口里的标签。

<a href="https://github.com/xy200303/browserpilot/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/xy200303/browserpilot?style=flat-square"></a>
<img alt="Windows" src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows&logoColor=white">
<img alt="macOS" src="https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple&logoColor=white">
<img alt="Linux" src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=white">

</td>
<td width="28%" align="right" valign="middle">

<a href="https://github.com/xy200303/browserpilot/releases/latest"><b>下载</b></a>

Windows · macOS · Linux

</td>
</tr>
</table>

## 窗口模型

下表比较同一次操作停在哪里。

| | 登录 | 中途需要人看一眼 | 继续下一步 |
| --- | --- | --- | --- |
| 日常浏览器 | 人在自己的 Chrome 里登录 | Agent 进不了这扇窗口 | 只能再开一个浏览器，登录对不上 |
| Agent 自己起浏览器 | 每次都要重新准备登录 | 窗口往往不可见 | 任务一结束，页面和登录一起丢掉 |
| BrowserPilot | 人在窗口里登录，Cookie 留在这套环境 | 遮罩写着 Agent 正在操作，人可以点「接管」 | 仍是同一扇窗口、同一套登录 |

一套环境是一扇窗口。这扇窗口里的标签共用这套登录。第一次打开是环境「默认」（`env-default`），可以改名，不能删除。关掉窗口不会清掉登录。

## 交给 Agent

先打开 BrowserPilot，在设置的「通用」里确认 MCP 开着。然后把下面这段话发给 Claude Code、Kimi Code、Codex、Cursor、WorkBuddy 或 CodeBuddy：

```text
请安装 BrowserPilot 配套 skill：读取 https://raw.githubusercontent.com/xy200303/browserpilot/main/skills/browserpilot/SKILL.md 并安装到你的用户级 skills 目录，再读取本机 BrowserPilot 的 mcp.json（Windows 是 %APPDATA%\BrowserPilot\mcp.json），只把名为 browserpilot 的 MCP 注册到你自己的配置里，其它服务器不要动；完成后用这个 skill 操作 BrowserPilot。
```

Agent 会安装使用说明并注册 BrowserPilot。连接口令写在本机 `mcp.json` 中，不进入代码仓库，也不要贴到对话里。

MCP 不可用时，在 Windows 上运行本机命令 `browserpilot`。窗口未打开时，该命令会先启动 BrowserPilot。`tools` 列出工具，`schema` 查看参数，`call` 执行调用。中文参数写进 JSON 文件，用 `--json-file`。

## 功能

- 一个进程，多套环境。每套环境一扇窗口，标签是窗口里的页面，不是再开一个应用。
- 地址栏、标签和设置用同一套界面组件。设置从窗口菜单打开。
- 工作流是一张图。点一条在单独的窗口里编辑。Agent 用 `workflow_run` 一次跑完，中间的点击不再逐次向 Agent 要下一步。
- 地址栏右边的「工作流」在网页区域打开。顶部可以搜索，右边点「已安装」看本机已有的，点「导入」从 GitHub 地址或本机 JSON 安装。目录从 [browserpilot-market](https://github.com/xy200303/browserpilot-market) 读取还没安装的。下载后保存在本机。可以填参数后自己执行，也可以点「交给 Agent」，把执行说明复制出去，由 Agent 调用 `workflow_run`。
- 点击按 XPath 或 CSS 选择器定位，必须恰好命中一个元素。画布这类没有稳定节点的目标用坐标。加 `pierce: true` 穿透 Shadow DOM 和同源 iframe；`page_script` 的 `frame` 参数可在跨域 iframe 里执行脚本。
- `page_drag` 按住一点按 `dx`、`dy` 精确拖拽，轨迹带拟人的加减速、抖动和微过冲；`page_cdp_batch` 在同一个调试会话里连发一组 CDP。
- 验证码识别：滑块用 `captcha_detect` / `captcha_solve` 全自动（识别引擎 cv / ddddocr / onnx 三选一，默认 auto 降级）。其它类型（图标点选、五子棋、交换消除……）用 `captcha_panel` 截出验证码区域图和坐标映射，由读图的 Agent 自己识别后点击——视觉模型路线，不限制验证码种类。新类型也可以在 `src/main/captcha.ts` 的 `detectors` 里注册内置检测器。
- 本机部署：`npm run dist:win` 打完包后跑 `npm run deploy:win`，直接把 `release/win-unpacked` 覆盖到安装目录并重启，不走安装器。
- 可以录下这扇窗口的画面，保存为本机 MP4。

## 下载

最新安装包见 [Releases](https://github.com/xy200303/browserpilot/releases/latest)。安装包未做代码签名。

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `BrowserPilot.Setup.<version>.exe`、`BrowserPilot-<version>-win.zip` |
| macOS（Apple Silicon） | `BrowserPilot-<version>-arm64.dmg`、`BrowserPilot-<version>-arm64-mac.zip` |
| Linux x64 | `BrowserPilot-<version>.AppImage`、`browserpilot_<version>_amd64.deb` |

`<version>` 与对应 Release 的版本号一致。

命令行 `browserpilot` 打进安装包的 `cli` 目录。

## 从源码运行

```bash
npm install
npm run dev
```

工作流保存在本机用户目录的 `workflows.json`。Windows 上端点文件是 `%APPDATA%\BrowserPilot\mcp.json`。

```bash
npm run typecheck
npm run build
```

推送到 `main` 会执行类型检查和构建。创建与 `package.json` 中 `version` 一致的标签（例如 `v0.1.1`）后，在 Windows、macOS 和 Linux 上打包，并发布到 GitHub Release。发布说明来自 [`.github/release-body.md`](.github/release-body.md)。仅构建当前系统时使用 `npm run dist:win`、`npm run dist:mac` 或 `npm run dist:linux`。

## 工作流市场

线上目录是独立仓库 [xy200303/browserpilot-market](https://github.com/xy200303/browserpilot-market)。应用每次打开市场都通过 GitHub API 读取 `index.json` 和其中的工作流文件，不使用安装包里的副本。

把自己的工作流放进市场时，把 JSON 放进这个仓库，并在 `index.json` 的 `workflows` 里加一条。`file` 是仓库里的相对路径。应用只下载，不把本机工作流推上去。
