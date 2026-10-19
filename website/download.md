---
title: 下载与安装
description: 下载 BrowserPilot 0.14.0：Windows x64、macOS Apple Silicon、Linux x64；含未签名安装提示、系统要求、MCP 端点位置、用户数据目录与备份/卸载说明。
---

# 下载与安装

最新版在 [GitHub Releases](https://github.com/xy200303/browserpilot/releases/latest)。当前站点对应 **v0.14.0**。

| 平台 | 文件 |
| ---- | ---- |
| Windows x64 | `BrowserPilot.Setup.0.14.0.exe`、`BrowserPilot-0.14.0-win.zip` |
| macOS（Apple Silicon） | `BrowserPilot-0.14.0-arm64.dmg`、`BrowserPilot-0.14.0-arm64-mac.zip` |
| Linux x64 | `BrowserPilot-0.14.0.AppImage`、`browserpilot_0.14.0_amd64.deb` |

只发布 Windows x64、Linux x64 与 macOS arm64（Apple Silicon）包；没有 32 位，也没有 Intel Mac 版本。CI 在三个平台打包，当前素材与验收在 Windows 完成。

## Windows

双击安装包按向导安装，向导里可以改安装目录。安装包大约 **123 MB**（117.3 MiB），安装后目录约 460 MB，因为 Electron 与 Chromium 都在包里。

::: warning SmartScreen 提示
安装包没有代码签名。Windows 可能弹出「Windows 已保护你的电脑」——点「**更多信息**」→「**仍要运行**」。
:::

安装后 CLI 在：

```text
%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe
```

它默认不在 PATH 里。要用短命令，把这个目录加进 PATH；不想改 PATH 就写全路径。

## macOS

打开 dmg 拖进「应用程序」，或解压 zip。应用未签名，macOS 提示「应用已损坏」或「无法验证开发者」时执行：

```bash
xattr -cr /Applications/BrowserPilot.app
```

## Linux

- AppImage：`chmod +x` 后直接运行
- deb：`sudo dpkg -i browserpilot_0.14.0_amd64.deb`

Linux 需要图形会话。BrowserPilot 是桌面应用，不是服务器端的 headless 浏览器。

## 系统要求

| 项目 | 要求 |
| ---- | ---- |
| Windows | Windows 10 及以上（x64） |
| macOS | macOS 13 Ventura 及以上，仅 Apple Silicon（arm64） |
| Linux | x64，主流发行版；AppImage 免安装 |
| 图形会话 | 必须有。无头只是窗口隐藏，不是无桌面运行 |
| 内存 | 建议 4 GB 以上；同时开多套环境或保存视频时建议 8 GB |
| 磁盘 | 安装约 460 MB；下载、录屏、合并后的视频另算 |

## 第一次打开

1. 启动后会出现「默认」环境的一扇窗口，首页是必应。
2. MCP 默认开着，只监听 `127.0.0.1`，默认端口 `39221`。
3. 端点与令牌写在本机：

```text
Windows: %APPDATA%\BrowserPilot\mcp.json
macOS:   ~/Library/Application Support/BrowserPilot/mcp.json
Linux:   ~/.config/BrowserPilot/mcp.json
```

4. 把端点注册给 Agent 的方法见[快速上手](/guide/quickstart)。

## 更新

仓库里没有自动更新器。升级方式是下载新安装包覆盖安装；用户数据目录不动。版本号以 `package.json` 与 Release tag 为准，本页写作 v0.14.0。

## 数据与备份

数据全部在本机：

| 系统 | 目录 |
| ---- | ---- |
| Windows | `%APPDATA%\BrowserPilot` |
| macOS | `~/Library/Application Support/BrowserPilot` |
| Linux | `~/.config/BrowserPilot` |

目录里包括：

| 内容 | 位置 |
| ---- | ---- |
| 环境、分组、工作流、设置 | `envs.json`、`groups.json`、`workflows.json`、`settings.json` |
| 运行记录（最多 200 条） | `runs.json` |
| 现场截图 | `screenshots\` |
| 工作流失败截图与 HAR | `runs\` |
| 导出的 CSV | `exports\` |
| 网页下载 | `downloads\` |
| 媒体保存 | `media\` |
| 窗口录屏 | `videos\` |
| 环境登录分区 | `Partitions\<env-id>\` |
| MCP 端点与令牌 | `mcp.json` |

备份就是**把整个目录拷走**；恢复时拷回同一位置。卸载程序不会删除这个目录（NSIS 配置里 `deleteAppDataOnUninstall` 为 false）。要彻底清空，先确认里面没有要留的东西，再手动删除。

::: warning 导出 Cookie 是明文
`env_export` 导出的 JSON 里有完整 Cookie，只用于本机换机。不要贴到对话、仓库或工单里。
:::
