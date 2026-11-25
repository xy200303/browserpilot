"""launch / connect / close：一个 App 实例，多个环境。

BrowserPilot 是单实例应用，所以不能像 Playwright 那样开 N 个浏览器：
隔离单位是「环境」（env-），一套环境一套 cookie。
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import warnings
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional

from .errors import BrowserPilotError, InstallError, NotFoundError, TransportError
from . import cookies as cookie_ops
from .api import Bookmarks, Downloads, Environments, Groups, History, Net, Network, Sessions, Settings, Tabs, Workflows
from .install import APP_VERSION, SDK_VERSION, AppLocation, ensure_app, locate_app
from .locator import Locator
from .page import Page
from .paths import mcp_file
from .transport import DEFAULT_TIMEOUT, Endpoint, EndpointLike, Transport, read_endpoint

__all__ = [
    'DEFAULT_ENV',
    'Environment',
    'BrowserPilot',
    'launch',
    'connect',
]

DEFAULT_ENV = 'env-default'


@dataclass
class _Owned:
    """SDK 自己拉起来的那份进程，close() 时收拾它开的环境。"""

    exe: str
    source: str
    envs: set = field(default_factory=set)


class Environment:
    """一套 cookie / 登录态。窗口可以开着，也可以只有后台标签。"""

    def __init__(self, client: 'BrowserPilot', id: str):
        self._client = client
        self.id = id

    def __str__(self) -> str:
        return f'Environment({self.id})'

    def open(self, headless: Optional[bool] = None) -> Dict[str, Any]:
        """打开这套环境的窗口。已经开着就按这次的显示方式切换。"""
        args: Dict[str, Any] = {'env': self.id}
        if headless is not None:
            args['headless'] = headless
        return self._client.call('env_open', args)

    def close(self) -> Dict[str, Any]:
        """关窗但保留登录态。"""
        return self._client.call('env_close', {'env': self.id})

    def new_page(self, url: Optional[str] = None) -> Page:
        data = self._client.call('tab_open', {'env': self.id, 'url': url or ''})
        return Page(self._client.transport, str(data.get('tabId')), self.id)

    def pages(self) -> List[Page]:
        tabs = self._client.call('tab_list', {}).get('tabs') or []
        return [
            Page(self._client.transport, tab.get('id'), self.id)
            for tab in tabs
            if tab.get('envId') == self.id
        ]


class BrowserPilot:
    """一个连上的 BrowserPilot。构造它意味着连接已经验过活了。"""

    def __init__(
        self,
        transport: Transport,
        env_id: str = DEFAULT_ENV,
        app_version: Optional[str] = None,
        owned: Optional[_Owned] = None,
    ):
        self.transport = transport
        self.env_id = env_id
        self.sdk_version = SDK_VERSION
        # 只有 SDK 自己装的那份才知道版本；连别人实例时是 None。
        self.app_version = app_version
        self._owned = owned
        # 按用途分组的工具入口，见 api.py；等价于直接 bp.call('env_list', ...)
        self.envs = Environments(self)
        self.tabs = Tabs(self)
        self.groups = Groups(self)
        self.settings = Settings(self)
        self.workflow = Workflows(self)
        self.net = Net(self)
        self.history = History(self)
        self.bookmarks = Bookmarks(self)
        self.downloads = Downloads(self)
        self.network = Network(self)
        self.sessions = Sessions(self)

    def __enter__(self) -> 'BrowserPilot':
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        self.close()
        return False

    def __str__(self) -> str:
        return f'BrowserPilot({self.transport.endpoint.url})'

    # ---------- 调用 ----------

    def call(
        self,
        tool: str,
        args: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """原始工具调用。SDK 没封装的工具都从这里走。"""
        return self.transport.call(tool, dict(args or {}), timeout=timeout).data

    # ---------- 事件 ----------

    def events(
        self,
        types: Optional[List[str]] = None,
        env: Optional[str] = None,
        tab_id: Optional[str] = None,
        since: Optional[int] = None,
    ) -> Iterator[Any]:
        """长轮询事件流。永远不自己结束，用 `break` 退出。

        for event in bp.events(types=['net.*']):
            print(event.type, event.payload)
        """
        return self.transport.event_stream(types=types, env=env, tab_id=tab_id, since=since)

    # ---------- 页面 ----------

    def new_page(self, url: Optional[str] = None, env: Optional[str] = None) -> Page:
        env_id = env or self.env_id
        if self._owned is not None:
            self._owned.envs.add(env_id)
        data = self.call('tab_open', {'env': env_id, 'url': url or ''})
        return Page(self.transport, str(data.get('tabId')), env_id)

    def pages(self) -> List[Page]:
        tabs = self.call('tab_list', {}).get('tabs') or []
        return [Page(self.transport, tab.get('id'), tab.get('envId')) for tab in tabs]

    def environments(self) -> List[Dict[str, Any]]:
        envs = self.call('env_list', {}).get('envs')
        return list(envs or [])

    def environment(self, id: str) -> Environment:
        return Environment(self, id)

    def tab(self, tab_id: str) -> Page:
        """按标签 id 绑定一个 Page：`bp.tab('tab-xxx').locator(...)` 不会串到别的页。"""
        tabs = self.call('tab_list', {}).get('tabs') or []
        for tab in tabs:
            if tab.get('id') == tab_id:
                return Page(self.transport, str(tab_id), str(tab.get('envId') or DEFAULT_ENV))
        known = '、'.join(str(tab.get('id')) for tab in tabs) or '没有打开的标签'
        raise NotFoundError(f'标签 {tab_id} 不在了；现有标签：{known}')

    def locator(self, selector: str) -> Locator:
        """当前第一页上的定位器，等价于先 new_page 再取。

        已经废弃：多标签时这个「第一页」可能是别人的页面。请用 `bp.tab(id).locator(...)`。
        """
        pages = self.pages()
        if not pages:
            raise BrowserPilotError('没有打开的页面，先 new_page()')
        warnings.warn(
            'bp.locator() 作用在「第一个标签页」上，多标签时会串页；请改用 bp.tab(id).locator(...)',
            DeprecationWarning,
            stacklevel=2,
        )
        return pages[0].locator(selector)

    # ---------- cookie ----------

    def cookies(self, env: Optional[str] = None, domain: Optional[str] = None) -> List[Dict[str, Any]]:
        """导出这套环境的 cookie（可以直接 json.dump 存起来，以后 add_cookies 注回去）。"""
        return cookie_ops.list_cookies(self.call, env=env, domain=domain)

    def add_cookies(self, cookies: Any, env: Optional[str] = None) -> int:
        """注入 cookie。传一条字典或一个列表，返回写进去的条数。"""
        return cookie_ops.add_cookies(self.call, cookies, env=env)

    def clear_cookies(
        self,
        name: Optional[str] = None,
        domain: Optional[str] = None,
        url: Optional[str] = None,
        all: bool = False,
        env: Optional[str] = None,
    ) -> None:
        """删 cookie。`name` 单删；`all=True` 清空这套环境；`domain` / `url` 收窄范围。"""
        cookie_ops.clear_cookies(self.call, name=name, domain=domain, url=url, all=all, env=env)

    # ---------- 剪贴板 ----------

    def clipboard_read(self) -> str:
        """读系统剪贴板文本。"""
        return str(self.call('clipboard_read', {}).get('text') or '')

    def clipboard_write(self, text: str) -> Dict[str, Any]:
        """写系统剪贴板；中文走剪贴板比逐键输入稳。"""
        return self.call('clipboard_write', {'text': text})

    # ---------- 权限与密码 ----------

    def permissions(self, env: Optional[str] = None) -> List[Dict[str, Any]]:
        """这套环境记住的站点权限（摄像头、麦克风、通知、定位等）。"""
        data = self.call('permission_list', {'env': env} if env else {})
        return list(data.get('permissions') or data.get('list') or [])

    def passwords(self, env: Optional[str] = None) -> List[Dict[str, Any]]:
        """已保存的登录（只有站点和账号，永远不含密码）。"""
        data = self.call('password_list', {'env': env} if env else {})
        return list(data.get('passwords') or data.get('list') or [])

    # ---------- 关闭 ----------

    def close(self) -> None:
        """收拾自己开的东西。

        App 是用户日常在用的浏览器：连的是别人的实例时什么都不做，
        只有 SDK 自己拉起来的那份才关窗口（关完最后一个窗口 App 自己退出）。
        """
        try:
            if self._owned is not None:
                for env in list(self._owned.envs):
                    try:
                        self.transport.call('env_close', {'env': env})
                    except BrowserPilotError:
                        pass
        finally:
            self.transport.close()


def connect(
    endpoint: Optional[EndpointLike] = None,
    timeout: float = DEFAULT_TIMEOUT,
    log: Optional[Callable[[str], None]] = None,
) -> BrowserPilot:
    """连上一个已经跑着的 BrowserPilot，不启动任何进程。

    没有实例时抛错，适合「必须用用户当前这扇窗口」的场景。
    """
    target = endpoint if endpoint is not None else read_endpoint()
    transport = Transport(target, timeout=timeout)
    if not transport.ping():
        url = transport.endpoint.url
        raise TransportError(f'{url} 没有响应。BrowserPilot 可能已经关了。')
    return BrowserPilot(transport)


def launch(
    env: Optional[str] = None,
    headless: Optional[bool] = None,
    timeout: float = 60,
    exe: Optional[str] = None,
    version: Optional[str] = None,
    endpoint: Optional[EndpointLike] = None,
    offline: bool = False,
    strict_version: bool = False,
    on_download: Optional[Callable[[Dict[str, Any]], None]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> BrowserPilot:
    """拿到一个可用的 BrowserPilot。

    发现顺序：已经在跑的实例 → 桌面版安装位置 → SDK 缓存 → 下载。
    已经有一个实例在跑时只连上去，绝不拉起第二个（单实例锁会让它自己退出）。
    """
    log = log or _default_log()
    env_id = env or DEFAULT_ENV

    # 0. 给了端点就直接用，不发现也不启动。
    if endpoint is not None:
        transport = Transport(endpoint)
        if not transport.ping():
            raise TransportError(f'{transport.endpoint.url} 没有响应')
        if headless is not None:
            _apply_headless(transport, env_id, headless)
        return BrowserPilot(transport, env_id=env_id)

    # 1. 已经有一个实例在跑：直接连，绝不拉起第二个。
    if not exe:
        running = _running_endpoint()
        if running is not None:
            transport = Transport(running)
            log(f'连上已经在跑的实例 {transport.endpoint.url}')
            if headless is not None:
                _apply_headless(transport, env_id, headless)
            return BrowserPilot(transport, env_id=env_id)

    # 2. 找一份能用的，必要时下载。
    app: Optional[AppLocation] = locate_app(exe=exe, version=version)
    if app is None:
        app = ensure_app(
            exe=exe,
            version=version,
            offline=offline,
            on_download=on_download,
            log=log,
        )

    strict = strict_version or os.environ.get('BROWSERPILOT_STRICT_VERSION') == '1'
    if strict and app.version and app.version != APP_VERSION:
        raise InstallError(
            f'SDK 对应 v{APP_VERSION}，本机装的是 v{app.version}（BROWSERPILOT_STRICT_VERSION 生效）'
        )
    log(f'装了 v{app.version} 到 {app.exe}' if app.source == 'downloaded' else f'用已有的 {app.exe}')

    # 3. 拉起来并等它就绪。
    _spawn(app.exe)
    endpoint = _wait_for_endpoint(timeout * 1000, log)
    transport = Transport(endpoint)
    if headless is not None:
        _apply_headless(transport, env_id, headless)

    owned = _Owned(exe=app.exe, source=app.source, envs={env_id})
    return BrowserPilot(transport, env_id=env_id, app_version=app.version, owned=owned)


def _default_log() -> Callable[[str], None]:
    if os.environ.get('BROWSERPILOT_DEBUG'):
        return lambda message: print(f'[browserpilot] {message}', file=sys.stderr)
    return lambda message: None


def _apply_headless(transport: Transport, env: str, headless: bool) -> None:
    # headless=False 时不主动开窗：那会把用户正在用的窗口拉到前台。
    if not headless:
        return
    transport.call('env_open', {'env': env, 'headless': True})


def _running_endpoint() -> Optional[Endpoint]:
    try:
        endpoint = read_endpoint()
        return endpoint if Transport(endpoint, timeout=2).ping() else None
    except TransportError:
        return None


def _spawn(exe: str) -> None:
    """detached：脚本崩了不能把用户日常在用的浏览器带走。"""
    options: Dict[str, Any] = {
        'stdin': subprocess.DEVNULL,
        'stdout': subprocess.DEVNULL,
        'stderr': subprocess.DEVNULL,
        'close_fds': True,
    }
    if sys.platform == 'win32':
        options['creationflags'] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options['start_new_session'] = True
    subprocess.Popen([exe], **options)


def _wait_for_endpoint(timeout_ms: float, log: Callable[[str], None]) -> Endpoint:
    deadline = time.monotonic() + timeout_ms / 1000.0
    file = mcp_file()
    announced = False
    while True:
        try:
            endpoint = read_endpoint(file)
            if Transport(endpoint, timeout=2).ping():
                return endpoint
        except TransportError:
            pass  # 还没写出来，继续等
        if time.monotonic() > deadline:
            raise InstallError(
                f'等了 {round(timeout_ms / 1000)}s，BrowserPilot 还没把 {file} 写好或者端口不通。'
                '打开 BrowserPilot 的 设置 → 通用，确认 MCP 是开着的。'
            )
        if not announced:
            announced = True
            log('等 BrowserPilot 起来…')
        time.sleep(0.3)
