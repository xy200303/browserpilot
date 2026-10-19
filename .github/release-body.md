Windows、macOS 和 Linux 安装包。命令行 `browserpilot` 打进安装包的 `cli` 目录。

## v0.14.0 新增

- `page_screenshot` 把截图作为 MCP image 内容返回；文本结果仍带路径、像素宽高和字节数。
- 新增 `window_preview`：把主界面、网页、遮罩、交接提示和弹层合成一张整窗预览图。
- `screen_start` 支持 `maxSeconds`，默认 300 秒、最长 3600 秒自动停止；新增 `screen_status`；`screen_stop` 返回时长和字节数。

## 说明

- `window_preview` 是合成预览，不是系统级窗口截图；无头窗口没有画面。
- 安装包没有代码签名。
