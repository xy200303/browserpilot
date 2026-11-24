"""程序面 `/api/*` 的 HTTP 通道。

三条必须照做的约定：
1. 端点文件里的 `api` 字段是程序面地址；没有它说明装的是旧版 App，直接报错，不回退 `/mcp`；
2. 请求是朴素的 `{tool, args}`，响应就是工具载荷本身，图片在同级 `image` 字段；
3. 鉴权通过、参数能解析之后一律 200，工具失败看载荷里的 `ok:false`。
"""

from __future__ import annotations

import base64
import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional, Union

from .errors import InstallError, ToolError, TransportError
from .install import APP_VERSION
from .paths import mcp_file

__all__ = [
    'DEFAULT_TIMEOUT',
    'Endpoint',
    'ImagePart',
    'CallResult',
    'EventRecord',
    'read_endpoint',
    'Transport',
]

DEFAULT_TIMEOUT = 120.0
MAX_WAIT_MS = 25000


@dataclass(frozen=True)
class Endpoint:
    api: str
    token: str
    url: str = ''


@dataclass
class ImagePart:
    """截图类工具才有：App 把图片放在同级 `image` 字段里。"""

    mime_type: str
    data: bytes


@dataclass
class CallResult:
    data: Dict[str, Any] = field(default_factory=dict)
    image: Optional[ImagePart] = None


@dataclass
class EventRecord:
    seq: int
    type: str
    at: int
    payload: Dict[str, Any] = field(default_factory=dict)
    env: Optional[str] = None
    tab_id: Optional[str] = None

    @classmethod
    def of(cls, raw: Mapping[str, Any]) -> 'EventRecord':
        return cls(
            seq=int(raw.get('seq') or 0),
            type=str(raw.get('type') or ''),
            at=int(raw.get('at') or 0),
            payload=dict(raw.get('payload') or {}),
            env=raw.get('env'),
            tab_id=raw.get('tabId'),
        )


EndpointLike = Union[Endpoint, Mapping[str, Any]]


def _endpoint_of(value: EndpointLike) -> Endpoint:
    if isinstance(value, Endpoint):
        if not value.api:
            raise InstallError(_missing_api())
        return value
    if isinstance(value, Mapping):
        token = value.get('token')
        api = value.get('api')
        if token and not api:
            raise InstallError(_missing_api())
        if api and token:
            return Endpoint(api=str(api).rstrip('/'), token=str(token), url=str(value.get('url') or ''))
    raise TransportError('endpoint 需要 api 和 token，例如 {"api": "http://127.0.0.1:39221/api", "token": ...}')


def _missing_api() -> str:
    return (
        f'本机装的 BrowserPilot 太旧，没有 /api（对应 SDK v{APP_VERSION}）。'
        '请升级，或用 BROWSERPILOT_EXE 指定新版本。'
    )


def read_endpoint(file=None) -> Endpoint:
    """读取 App 写下的端点文件。没有 `api` 字段就是旧版，直接报错。"""
    path = Path(file) if file is not None else Path(mcp_file())
    if not path.is_file():
        raise TransportError(
            f'没找到 {path}。要么 BrowserPilot 没启动过，要么 MCP 在设置里被关掉了。'
        )
    try:
        saved = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise TransportError(f'{path} 不是合法的 JSON') from error
    if not isinstance(saved, Mapping):
        raise TransportError(f'{path} 里缺 token')
    return _endpoint_of(saved)


class Transport:
    """一个程序面端点的 HTTP 通道。"""

    def __init__(self, endpoint: EndpointLike, timeout: float = DEFAULT_TIMEOUT):
        self.endpoint = _endpoint_of(endpoint)
        self.timeout = timeout
        self._closed = False

    # ---------- 探活 / 目录 ----------

    def ping(self, timeout: float = 2.0) -> bool:
        """App 没起来、端口被占、token 不对都算不通。"""
        try:
            self._request('GET', '/tools', timeout)
            return True
        except Exception:  # noqa: BLE001 - 探活把一切异常都当「不通」
            return False

    def tools(self) -> List[Dict[str, Any]]:
        """全量工具目录（不受 toolMode 影响）。"""
        try:
            payload = self._request('GET', '/tools', 10)
        except TransportError:
            return []
        tools = payload.get('tools') if isinstance(payload, Mapping) else None
        return list(tools or [])

    # ---------- 调用 ----------

    def call(
        self,
        name: str,
        args: Optional[Mapping[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> CallResult:
        payload = self._request(
            'POST',
            '/call',
            self.timeout if timeout is None else timeout,
            {'tool': name, 'args': dict(args or {})},
        )
        if not isinstance(payload, Mapping):
            raise TransportError(f'{name} 返回的不是 JSON 对象')
        data = dict(payload)
        image = None
        raw_image = data.pop('image', None)
        if isinstance(raw_image, Mapping) and raw_image.get('data'):
            image = ImagePart(
                mime_type=str(raw_image.get('mimeType') or 'image/png'),
                data=base64.b64decode(str(raw_image['data'])),
            )
        # 工具失败是 200 + ok:false，这是唯一判据
        if data.get('ok') is False:
            raise ToolError(name, data)
        return CallResult(data=data, image=image)

    # ---------- 事件 ----------

    def events(
        self,
        since: Optional[int] = None,
        types: Optional[List[str]] = None,
        env: Optional[str] = None,
        tab_id: Optional[str] = None,
        wait_ms: int = MAX_WAIT_MS,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """长轮询取一批事件。返回原始结果（events / seq / reset / timeout）。"""
        body: Dict[str, Any] = {'wait': max(0, min(MAX_WAIT_MS, int(wait_ms)))}
        if since is not None:
            body['since'] = since
        if types:
            body['types'] = list(types)
        if env:
            body['env'] = env
        if tab_id:
            body['tabId'] = tab_id
        if limit is not None:
            body['limit'] = limit
        # 客户端要比服务端挂得久一点，否则先超时的会是客户端
        payload = self._request('POST', '/events', body['wait'] / 1000 + 10, body)
        return dict(payload or {})

    def event_stream(
        self,
        types: Optional[List[str]] = None,
        env: Optional[str] = None,
        tab_id: Optional[str] = None,
        since: Optional[int] = None,
    ) -> Iterator[EventRecord]:
        """无限迭代事件。用 `break` 退出。"""
        while True:
            result = self.events(since=since, types=types, env=env, tab_id=tab_id)
            since = result.get('seq', since)
            for raw in result.get('events') or []:
                yield EventRecord.of(raw)

    def close(self) -> None:
        self._closed = True

    # ---------- 内部 ----------

    def _request(self, method: str, path: str, timeout: float, body: Optional[Mapping[str, Any]] = None):
        if self._closed:
            raise TransportError('连接已经关了')
        url = f'{self.endpoint.api}{path}'
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers = {'Authorization': f'Bearer {self.endpoint.token}'}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                text = response.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise TransportError('token 不对，重新读一遍 mcp.json') from error
            if error.code == 403:
                raise TransportError('被 Origin 校验挡下了') from error
            detail = error.read().decode('utf-8', 'replace')[:200]
            raise TransportError(f'HTTP {error.code} {detail}') from error
        except (socket.timeout, TimeoutError) as error:
            raise TransportError(f'等了 {int(timeout * 1000)}ms 没回应') from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (socket.timeout, TimeoutError)):
                raise TransportError(f'等了 {int(timeout * 1000)}ms 没回应') from error
            raise TransportError(f'连不上 {self.endpoint.api}') from error
        except OSError as error:
            raise TransportError(f'连不上 {self.endpoint.api}') from error
        try:
            return json.loads(text) if text else {}
        except ValueError as error:
            raise TransportError(f'{path} 返回的不是 JSON：{text[:200]}') from error
