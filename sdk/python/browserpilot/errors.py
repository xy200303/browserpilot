"""SDK 的错误只有几类，三个语言保持同样的语义。

- ToolError：工具跑了但失败（HTTP 200 + 载荷里 ok:false），带工具名和原始载荷
- TransportError：连不上、超时、鉴权失败、JSON-RPC 出错
- InstallError：找不到也装不上 BrowserPilot
- NotFoundError：定位器没法用这个工具表达，或者等的东西没等到
"""

__all__ = [
    'BrowserPilotError',
    'ToolError',
    'TransportError',
    'InstallError',
    'NotFoundError',
]


class BrowserPilotError(Exception):
    """所有 SDK 错误的基类。"""

    code = 'browserpilot_error'


class ToolError(BrowserPilotError):
    """工具失败。看 HTTP 状态码判断成败一定会漏，失败也是 200。"""

    code = 'tool_error'

    def __init__(self, tool, payload=None):
        payload = dict(payload or {})
        super().__init__(payload.get('error') or f'{tool} 失败')
        self.tool = tool
        self.payload = payload
        # 失败时 App 顺手拍的那张现场截图，路径在本机。
        shot = payload.get('errorShot')
        self.screenshot = shot if isinstance(shot, str) else None


class TransportError(BrowserPilotError):
    code = 'transport_error'


class InstallError(BrowserPilotError):
    code = 'install_error'


class NotFoundError(BrowserPilotError):
    code = 'not_found'
