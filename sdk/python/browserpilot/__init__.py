"""BrowserPilot Python SDK：用 Playwright 的样子驱动本机的 BrowserPilot 桌面浏览器。

零运行时依赖，只用标准库。SDK 不自带浏览器引擎，它驱动的是你机器上那扇
BrowserPilot 窗口：登录态、书签、密码都还在，脚本和 Agent 用的是同一套 cookie。

    from browserpilot import launch

    with launch() as bp:
        page = bp.new_page()
        page.goto('https://example.com')
        page.get_by_role('button', name='登录').click()
"""

from .client import DEFAULT_ENV, BrowserPilot, Environment, connect, launch
from .errors import (
    BrowserPilotError,
    InstallError,
    NotFoundError,
    ToolError,
    TransportError,
)
from .install import APP_VERSION, SDK_VERSION, asset_for, ensure_app, locate_app
from .locator import Locator, LocatorSpec
from .page import Page
from .paths import data_home, install_candidates, mcp_file
from .transport import (
    CallResult,
    Endpoint,
    EventRecord,
    ImagePart,
    Transport,
    read_endpoint,
)

__version__ = SDK_VERSION

__all__ = [
    # 入口
    'launch',
    'connect',
    'BrowserPilot',
    'Environment',
    'DEFAULT_ENV',
    # 页面与定位
    'Page',
    'Locator',
    'LocatorSpec',
    # 错误
    'BrowserPilotError',
    'ToolError',
    'TransportError',
    'InstallError',
    'NotFoundError',
    # 传输与安装
    'Transport',
    'Endpoint',
    'EventRecord',
    'ImagePart',
    'CallResult',
    'read_endpoint',
    'asset_for',
    'locate_app',
    'ensure_app',
    'mcp_file',
    'data_home',
    'install_candidates',
    # 版本
    'APP_VERSION',
    'SDK_VERSION',
    '__version__',
]
