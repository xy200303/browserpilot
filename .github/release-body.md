Windows、macOS 和 Linux 安装包。命令行 `browserpilot` 打进安装包的 `cli` 目录。

这一版 App 本体没有功能改动，版本号跟 SDK 一起走到 0.22.0；新增能力都在三个 SDK 里。

## 新增

- **iframe 支持**：`page.frames()` / `frame_locator()` / `frame(url片段)`，点击、输入、悬停走 App 的
  `frame` 通道，计数、文本、可见性、等待用 `page_script` 在 frame 里算。跨域 iframe 也能进。
- **frame 内的等待**：`frame.wait_for(...)` 轮询；`page.wait_for_function(js)` 支持表达式或函数，
  主文档和 iframe 都能等。
- **定位失败会解释原因**：是在某个 iframe 里、被遮罩挡住，还是主文档就没有。
- **cookie 导入导出**：`bp.cookies()` / `add_cookies()` / `clear_cookies()`，按环境隔离，掉登录不用重扫。
- **标签绑定**：`bp.tab(id).locator(...)` 明确绑到某个标签；`bp.locator()` 标记废弃。
- **弹窗与交接**：`dialogs()` / `accept_dialog()` / `dismiss_dialog()`、`lock()` / `unlock()` / `handoff()`。
- **上传与遮罩**：`upload(paths, target)`、`overlays()` / `dismiss_overlays()`。
- **查找与监听**：`find(text)` / `find_stop()`、`inspect()`、`watch(target, timeout)`。
- **会话、剪贴板、权限**：`bp.sessions`、`bp.clipboard_read/write()`、`bp.permissions()` / `bp.passwords()`。
- **截图默认带网格**：SDK 截图默认叠 100px 坐标网格（和 App 一致），要干净图传 `grid: false`。

## 说明

- 安装包没有代码签名。
- 这一版的数据格式和 0.21.0 一致，不需要迁移。
- SDK 三个包（npm / PyPI / Go）同时发 0.22.0，和 App 同号。
- iframe 里的元素截图暂不支持（`page_screenshot` 没有 `frame` 参数），会明确报错。
