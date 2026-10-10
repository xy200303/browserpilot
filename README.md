<p align="center">
  <img src="resources/icon.svg" width="80" height="80" alt="BrowserPilot Logo" />
</p>

<h1 align="center">BrowserPilot</h1>

<p align="center">
  <strong>你的浏览器，助手可以接着用。</strong>
</p>

<p align="center">
  登录留在本机的一套环境里，人打开窗口之后，<br>
  Agent 在同一扇窗口里继续操作标签——不用重开浏览器，不用重新登录。
</p>

<p align="center">
  <a href="https://github.com/xy200303/browserpilot/releases/latest">📦 下载</a> •
  <a href="https://github.com/xy200303/browserpilot-market">🛒 工作流市场</a> •
  <a href="skills/browserpilot/SKILL.md">🤖 Agent 接入</a>
</p>

<p align="center">
  <a href="https://github.com/xy200303/browserpilot/releases/latest"><img src="https://img.shields.io/github/v/release/xy200303/browserpilot?style=for-the-badge" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 44" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
</p>

---

## ✨ 特性

|     | 功能 | 说明 |
| --- | ---- | ---- |
| 🪟 | **同窗口人机协作** | 人在窗口里登录、过验证；Agent 接着操作同一扇窗口。操作中遮罩提示，人可随时点「接管」 |
| 🔐 | **多套隔离环境** | 一个进程多套环境，每套环境一扇窗口、一套独立登录态，关窗不清登录 |
| 🔄 | **工作流引擎** | 节点图编排（点击/填写/循环/脚本/验证码），一次跑完不逐次请示；内置市场一键安装 |
| 🎬 | **流媒体保存** | B站/抖音/YouTube 抓 DASH 双轨合并 mp4；央视/AcFun 拉 m3u8；搜狐分段合并；腾讯 Worker 拉流用 CDP 嗅探兜底 |
| 🧩 | **验证码识别** | 极验滑块全自动（cv / ddddocr / onnx 三引擎降级），其余类型截图交给视觉模型识别，种类不限 |
| 🖱️ | **拟人交互** | 拖拽轨迹自带加减速、抖动和微过冲；穿透 Shadow DOM 与 iframe 定位；跨域 iframe 执行脚本 |
| 📥 | **下载管理器** | 接管网页所有下载：进度、断点续传、复制链接，Agent 存的媒体也进列表 |
| 🎨 | **画布绘制** | 路径点、贝塞尔曲线（SVG path）、海龟命令绘图，画板/签名/Canva 都能画 |
| 📹 | **录制能力** | 窗口录屏成 mp4；页面视频 captureStream 录制，抓不到轨的流媒体也能存 |
| 🕵️ | **网络抓包** | 标签级 HTTP 记录与导出 HAR，请求头 Cookie 只留本机 |
| 🖱️ | **智能右键菜单** | 按元素类型出菜单：链接开新标签、图像另存、视频音频另存，保存弹系统对话框 |

---

## 💡 技术亮点

### 人机共驾的控制权模型

同一个标签有三种状态：人操作、Agent 操作、共享。Agent 上手时页面盖「正在操作」遮罩，人点「接管」即刻交还；做完了 Agent 再锁定回来。登录态始终在环境自己的 session 分区里，两边看到的是同一个页面、同一份 Cookie。

### 全平台流媒体提取管线

`page_save_media` 一条命令背后是一条分层管线：站点 provider（B站 `__playinfo__`、YouTube `ytInitialPlayerResponse`，`media/video/` 下一个平台一个文件）→ 性能条目嗅探（DASH 双轨 / 渐进 mp4 / m3u8）→ CDP 网络嗅探（抓 Web Worker 拉流）→ 必要时重载页面从头抓清单。ffmpeg 自动下载到用户目录，合并、转封装都在本机完成。

### 验证码的三层引擎

滑块验证码按 cv（内置视觉算法，零依赖）→ ddddocr（开源 OCR/识别库）→ onnx（自托管模型）顺序降级；识别完用拟人轨迹拖过去，失败自动换图重试。搞不定的类型（图标点选、五子棋……）截出面板图和坐标映射，交给会看图的 Agent 自己点。

---

## 🚀 快速开始

### 1. 下载安装

前往 [Releases](https://github.com/xy200303/browserpilot/releases/latest) 下载（未做代码签名）：

| 平台 | 文件 |
| ---- | ---- |
| Windows x64 | `BrowserPilot.Setup.<版本号>.exe`、`BrowserPilot-<版本号>-win.zip` |
| macOS（Apple Silicon） | `BrowserPilot-<版本号>-arm64.dmg`、`BrowserPilot-<版本号>-arm64-mac.zip` |
| Linux x64 | `BrowserPilot-<版本号>.AppImage`、`browserpilot_<版本号>_amd64.deb` |

> ⚠️ **Windows**：SmartScreen 提示"未知发布者"时，点「更多信息」→「仍要运行」。
> ⚠️ **macOS**：提示"应用已损坏"时执行 `xattr -cr /Applications/BrowserPilot.app`。

### 2. 交给 Agent

打开 BrowserPilot，在设置的「通用」里确认 MCP 开着。然后把下面这段话发给 Claude Code、Kimi Code、Codex、Cursor、WorkBuddy 或 CodeBuddy：

```text
请安装 BrowserPilot 配套 skill：读取 https://raw.githubusercontent.com/xy200303/browserpilot/main/skills/browserpilot/SKILL.md 并安装到你的用户级 skills 目录，再读取本机 BrowserPilot 的 mcp.json（Windows 是 %APPDATA%\BrowserPilot\mcp.json），只把名为 browserpilot 的 MCP 注册到你自己的配置里，其它服务器不要动；完成后用这个 skill 操作 BrowserPilot。
```

连接口令写在本机 `mcp.json`，不进入代码仓库，也不要贴到对话里。

### 3. 命令行（可选）

MCP 不可用时用 CLI。Windows 安装后可直接运行 `browserpilot`（窗口没开会先启动）：

```bash
browserpilot tools                 # 列出全部工具
browserpilot schema page_click     # 查看参数
browserpilot call page_navigate --json-file nav.json   # 中文参数写进 JSON 文件
```

---

## 🛒 工作流市场

地址栏右侧「工作流」打开市场：搜索、安装、填参数自己跑，或「交给 Agent」由它调用 `workflow_run`。线上目录是独立仓库 [xy200303/browserpilot-market](https://github.com/xy200303/browserpilot-market)，每次打开都从 GitHub 拉最新。

市场现有：BOSS 直聘自动投递（循环筛薪资、自动过验证码）、B站视频按 BV 号下载、股吧采集导出 CSV、极验滑块等。把自己的工作流放进市场：JSON 提交到该仓库并在 `index.json` 登记，应用只下载不回传。

---

## 🛠️ 本地开发

```bash
npm install
npm run dev          # 开发模式
npm run typecheck    # 类型检查
npm run build        # 构建
npm run dist:win     # 打包当前平台（dist:mac / dist:linux 同理）
npm run deploy:win   # 免安装器：覆盖安装目录并重启
```

推送到 `main` 会跑类型检查和构建；打上与 `package.json` 版本一致的 tag（如 `v0.13.0`）后，CI 在 Windows / macOS / Linux 三端打包并发布 Release。

## 📁 项目结构

```
├── src/main/          # 主进程：窗口/标签/环境、页面操作、抓包
│   ├── media/         # 媒体保存：video/ image/ audio/ canvas/ 按类型分目录
│   │   └── video/     #   平台 provider 一个文件（bilibili.ts、youtube.ts…）
│   ├── services/      # MCP、工作流引擎、下载、抓包、ffmpeg
│   └── captcha.ts     # 验证码检测器注册表
├── src/preload/       # 页面右键信号、性能缓冲扩容
├── src/renderer/      # React 界面（标签栏、设置、下载、工作流编辑器）
├── cli/               # Go 版命令行（与 MCP 同一套工具）
├── skills/            # Agent 使用说明（SKILL.md）
└── .github/           # CI 三平台打包发布
```

---

## 💬 反馈

问题与建议欢迎提 [Issue](https://github.com/xy200303/browserpilot/issues)。
