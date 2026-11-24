"""Playwright 风格的页面封装。

每个动作都直接落到 MCP 工具上，参数映射照 Node 版逐条对齐：
`page_click` 按 text → role+name → selector/xpath → testId/alt 排优先级，
`fill` 对 selector/xpath 一次 inject，其余靠「聚焦 → 全选 → 粘贴」三步。
"""

from __future__ import annotations

import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Pattern, Union

from .errors import BrowserPilotError, NotFoundError, ToolError
from .locator import (
    Locator,
    LocatorSpec,
    action_args,
    coerce_spec,
    describe,
    type_plan,
    wait_args,
)
from .transport import EventRecord, Transport

__all__ = ['Page', 'PageTarget', 'PAGE_EVENT_TYPES', 'DEFAULT_MODIFIER']

# 定位目标：CSS 选择器、Locator、或者直接给一份定位描述。
PageTarget = Union[str, Locator, LocatorSpec, Mapping[str, Any]]

# 页面能订阅的事件，映射到事件总线里的 type。
PAGE_EVENT_TYPES: Dict[str, List[str]] = {
    'response': ['net.response'],
    'request': ['net.request'],
    'navigation': ['tab.navigation'],
    'console': ['page.console'],
    'loading': ['tab.loading'],
}


def _url_matches(match: Union[str, Pattern[str]], url: str) -> bool:
    if isinstance(match, str):
        return match in url
    return match.search(url) is not None

# page_type 的底层是 Input.insertText，只在光标处插入，覆盖语义得先全选。
DEFAULT_MODIFIER = 'Meta+A' if sys.platform == 'darwin' else 'Control+A'


def _locate_fields(spec: LocatorSpec) -> Optional[Dict[str, Any]]:
    if spec.selector:
        fields: Dict[str, Any] = {'selector': spec.selector}
        if spec.pierce:
            fields['pierce'] = True
        return fields
    if spec.xpath:
        fields = {'xpath': spec.xpath}
        if spec.pierce:
            fields['pierce'] = True
        return fields
    return None


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class Page:
    """一个标签页。构造时拿到的 transport 和 env 就定下来了。"""

    def __init__(self, transport: Transport, id: str, env: str):
        self._transport = transport
        self.id = id
        self.env = env
        # 这个 Page 当前有几路订阅要抓包；0 时才真的 net_stop
        self._capture_users = 0
        self._capture_lock = threading.Lock()

    def __enter__(self) -> 'Page':
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        # with 结束就关掉这个标签；后台的 App 不受影响。
        self.close()
        return False

    def __str__(self) -> str:
        return f'Page({self.id})'

    def call(
        self,
        tool: str,
        args: Optional[Mapping[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """原始工具调用，参数里自动带上 tabId。SDK 没封装的工具都从这里走。"""
        return self._raw(tool, dict(args or {}), timeout=timeout).data

    # ---------- 导航 ----------

    def goto(self, url: str) -> Dict[str, Any]:
        """打开地址。page_navigate 内部已经等到 load 完成，不用再补等待。"""
        return self._raw('page_navigate', {'url': url}).data

    def reload(self) -> Dict[str, Any]:
        return self._raw('page_reload', {}).data

    def back(self) -> Dict[str, Any]:
        return self._raw('page_back', {}).data

    def forward(self) -> Dict[str, Any]:
        return self._raw('page_forward', {}).data

    def wait_for_load(self, timeout: float = 15) -> Dict[str, Any]:
        """等 did-stop-loading。跳转和点链接之后比 sleep 可靠。"""
        return self._raw('page_wait_load', {'timeout': timeout}).data

    def url(self) -> str:
        return self._info()['url']

    def title(self) -> str:
        return self._info()['title']

    # ---------- 定位 ----------

    def get_by_role(self, role: str, name: Optional[str] = None, exact: Optional[bool] = None) -> Locator:
        return Locator(
            self,
            LocatorSpec(
                role=role,
                name=name,
                name_match=None if exact is None else ('exact' if exact else 'contains'),
            ),
        )

    def get_by_text(self, text: str, exact: Optional[bool] = None) -> Locator:
        return Locator(
            self,
            LocatorSpec(text=text, text_match=None if exact is None else ('exact' if exact else 'contains')),
        )

    def get_by_label(self, label: str) -> Locator:
        return Locator(self, LocatorSpec(label=label))

    def get_by_placeholder(self, placeholder: str) -> Locator:
        return Locator(self, LocatorSpec(placeholder=placeholder))

    def get_by_test_id(self, test_id: str) -> Locator:
        return Locator(self, LocatorSpec(test_id=test_id))

    def locator(self, selector: str) -> Locator:
        return Locator(self, LocatorSpec(selector=selector))

    def xpath(self, xpath: str) -> Locator:
        return Locator(self, LocatorSpec(xpath=xpath))

    # ---------- 动作 ----------

    def click(
        self,
        target: PageTarget,
        button: Optional[str] = None,
        count: Optional[int] = None,
        timeout: Optional[float] = None,
        via: Optional[str] = None,
    ) -> Dict[str, Any]:
        args = action_args(self._spec_of(target))
        if button:
            args['button'] = button
        if count:
            args['count'] = count
        if via:
            args['via'] = via
        return self._raw('page_click', args, timeout=timeout).data

    def fill(self, target: PageTarget, value: str) -> Dict[str, Any]:
        """覆盖式输入。

        selector/xpath 一次 inject 搞定；label / placeholder / role 走
        「聚焦 → 全选 → 粘贴」三步，因为 page_type 只在光标处插入、不清空。
        """
        plan = type_plan(self._spec_of(target))
        if plan.mode == 'inject':
            return self._raw('page_type', {**plan.args, 'text': value, 'via': 'inject'}).data
        self._raw('page_type', {**plan.args, 'text': ''})
        self.press(DEFAULT_MODIFIER)
        return self._raw('page_type', {**plan.args, 'text': value, 'entry': 'paste'}).data

    def type(self, target: PageTarget, value: str) -> Dict[str, Any]:
        """在光标处追加，不清空。"""
        plan = type_plan(self._spec_of(target))
        # inject 只给 fill 用，所以这里不带 via。
        return self._raw('page_type', {**plan.args, 'text': value}).data

    def press(self, shortcut: str, via: Optional[str] = None) -> Dict[str, Any]:
        """快捷键进页面，例如 Control+Enter；不会触发窗口自己的新建/关闭标签。"""
        args: Dict[str, Any] = {'shortcut': shortcut}
        if via:
            args['via'] = via
        return self._raw('page_key', args).data

    def hover(self, target: PageTarget) -> Dict[str, Any]:
        return self._raw('page_hover', action_args(self._spec_of(target))).data

    def select(self, target: PageTarget, option: str) -> Dict[str, Any]:
        spec = self._spec_of(target)
        fields = _locate_fields(spec)
        if fields is None:
            raise NotFoundError(f'selectOption 只支持 selector 或 xpath，收到 {describe(spec)}')
        return self._raw('page_select', {**fields, 'option': option}).data

    def scroll(
        self,
        direction: str = 'down',
        target: Optional[PageTarget] = None,
        until: Optional[PageTarget] = None,
    ) -> Dict[str, Any]:
        args: Dict[str, Any] = {'direction': direction}
        if target is not None:
            args.update(_locate_fields(self._spec_of(target)) or {})
        if until is not None:
            until_spec = self._spec_of(until)
            if until_spec.selector:
                args['untilSelector'] = until_spec.selector
            if until_spec.xpath:
                args['untilXpath'] = until_spec.xpath
        return self._raw('page_scroll', args).data

    def scroll_to(self, target: PageTarget) -> Dict[str, Any]:
        """滚到目标能被点到为止。"""
        spec = self._spec_of(target)
        args: Dict[str, Any] = {'direction': 'down'}
        if spec.selector:
            args['untilSelector'] = spec.selector
        elif spec.xpath:
            args['untilXpath'] = spec.xpath
        else:
            raise NotFoundError(f'scrollTo 只支持 selector 或 xpath，收到 {describe(spec)}')
        return self._raw('page_scroll', args).data

    # ---------- 等待 ----------

    def wait_for(
        self,
        target: PageTarget,
        state: str = 'appear',
        timeout: float = 10,
        poll: Optional[float] = None,
    ) -> None:
        """等元素出现/消失。

        selector/xpath 走 page_wait（原生，最快）；文本走 page_find 轮询；
        role+name 走无障碍树轮询。label / placeholder 没有对应通道，请用 selector。
        """
        spec = self._spec_of(target)
        native = wait_args(spec, state, timeout)
        if native is not None:
            self._raw('page_wait', native)
            return
        if spec.text:
            self._poll_text(spec.text, state, timeout, poll if poll is not None else 0.3)
            return
        if spec.role and spec.name:
            self._poll_snapshot(spec.name, state, timeout, poll if poll is not None else 0.5)
            return
        raise NotFoundError(
            f'waitFor 不支持 {describe(spec)}：用 selector / xpath / getByText / getByRole 都能等，'
            'label 和 placeholder 请改写成 selector。'
        )

    def wait_for_text(self, text: str, state: str = 'appear', timeout: float = 10, poll: float = 0.3) -> None:
        """等页面上出现这段文字，用 Ctrl+F 的原生查找，不走 DOM。"""
        self._poll_text(text, state, timeout, poll)

    def expect_text(self, text: str, state: str = 'appear', timeout: float = 10, poll: float = 0.3) -> None:
        """wait_for_text 的别名，读起来更像断言。"""
        self.wait_for_text(text, state=state, timeout=timeout, poll=poll)

    # ---------- 读取 ----------

    def count(self, target: PageTarget) -> int:
        spec = self._spec_of(target)
        fields = _locate_fields(spec)
        if fields is None:
            raise NotFoundError(f'count 只支持 selector 或 xpath，收到 {describe(spec)}')
        return _as_int(self.call('page_query', fields).get('total'))

    def is_visible(self, target: PageTarget) -> bool:
        spec = self._spec_of(target)
        fields = _locate_fields(spec)
        if fields is None:
            raise NotFoundError(f'isVisible 只支持 selector 或 xpath，收到 {describe(spec)}')
        matches = self.call('page_query', fields).get('matches') or []
        return any(item.get('hittable') is True for item in matches)

    def text_content(self, target: PageTarget) -> str:
        spec = self._spec_of(target)
        fields = _locate_fields(spec)
        if fields is None:
            raise NotFoundError(f'textContent 只支持 selector 或 xpath，收到 {describe(spec)}')
        text = self.call('page_inspect', fields).get('text')
        return '' if text is None else str(text)

    def content(self, kind: str = 'dom') -> str:
        """dom 是当前文档，response 是这次导航的原始 HTML。"""
        html = self.call('page_source', {'kind': kind}).get('html')
        return '' if html is None else str(html)

    def snapshot(self) -> str:
        """无障碍树，Agent 看页面主要靠它。"""
        tree = self.call('page_snapshot', {}).get('snapshot')
        return '' if tree is None else str(tree)

    def cdp(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """直接下发一条 CDP 命令，返回原始结果。

            page.cdp('Emulation.setTimezoneOverride', {'timezoneId': 'America/New_York'})
            metrics = page.cdp('Page.getLayoutMetrics')
        """
        results = self.cdp_batch([{'method': method, 'params': params or {}}])
        return results[0] if results else None

    def cdp_batch(self, commands: List[Dict[str, Any]]) -> List[Any]:
        """一次下发多条命令，共用同一个 debugger 会话。

        ``delay_ms`` 是每条之后等多久（上限 5 秒）。工具那边 delay 的单位是秒，这里换算。
        """
        payload = []
        for command in commands:
            delay_ms = float(command.get('delay_ms') or 0)
            item: Dict[str, Any] = {'method': command['method'], 'params': command.get('params') or {}}
            if delay_ms > 0:
                item['delay'] = min(delay_ms, 5000.0) / 1000.0
            payload.append(item)
        data = self.call('page_cdp_batch', {'commands': payload})
        results = data.get('results')
        return list(results or [])

    def evaluate(self, source: str, frame: Optional[str] = None) -> Any:
        """在页面里执行 JS，返回值原样回来。

        只收 JS 源码：Python 函数没法序列化进页面，这一点和 Node 版不同。
        """
        if not isinstance(source, str):
            raise TypeError('evaluate 只接受 JS 源码字符串；Python 函数没法送进页面执行')
        args: Dict[str, Any] = {'source': source}
        if frame is not None:
            args['frame'] = frame
        return self.call('page_script', args).get('value')

    def console_logs(self, clear: bool = False, limit: int = 100) -> List[Dict[str, Any]]:
        if clear:
            self.call('page_console', {'action': 'clear'})
            return []
        messages = self.call('page_console', {'limit': limit}).get('messages')
        return list(messages or [])

    # ---------- 事件 ----------

    def on(self, event: str, handler: Callable[[EventRecord], None]) -> Callable[[], None]:
        """订阅这个标签的事件，返回取消函数。

            seen = []
            off = page.on('response', lambda e: seen.append(e.payload.get('url')))
            page.goto('https://example.com')
            off()

        ``response`` / ``request`` 会自动开抓包（net_start），最后一个订阅取消时关掉。
        事件在后台线程里回调；取消后最多一次长轮询（约 1 秒）内收手。
        """
        if event not in PAGE_EVENT_TYPES:
            raise ValueError(f"不认识的事件 {event!r}；可选：{', '.join(PAGE_EVENT_TYPES)}")
        stop = threading.Event()
        capture = event in ('response', 'request')
        if capture:
            # 先把抓包挂上再返回，调用方紧接着导航不会漏掉首批请求
            self._acquire_capture()
        thread = threading.Thread(
            target=self._run_events,
            args=(PAGE_EVENT_TYPES[event], handler, stop, capture),
            name=f'browserpilot-{self.id}-{event}',
            daemon=True,
        )
        try:
            thread.start()
        except RuntimeError:
            if capture:
                self._release_capture()
            raise
        return stop.set

    def wait_for_response(
        self,
        match: Union[str, Pattern[str]],
        timeout: float = 30.0,
    ) -> EventRecord:
        """等第一个 URL 匹配的响应，返回事件本身。

            res = page.wait_for_response('api/user', timeout=10)
            print(res.payload['status'])

        ``match`` 是字符串时按子串匹配，正则用 ``re.compile(...)``。
        超时抛 :class:`NotFoundError`，不会一直等下去。
        """
        deadline = time.monotonic() + float(timeout)
        stop = threading.Event()
        self._acquire_capture()
        try:
            stream = self._stream(['net.response'], stop, deadline=deadline)
            for record in stream:
                if _url_matches(match, str(record.payload.get('url') or '')):
                    return record
            raise NotFoundError(f'等了 {timeout}s，没等到匹配 {match} 的响应')
        finally:
            self._release_capture()

    def _run_events(
        self,
        types: List[str],
        handler: Callable[[EventRecord], None],
        stop: threading.Event,
        capture: bool,
    ) -> None:
        try:
            for record in self._stream(types, stop):
                if stop.is_set():
                    return
                handler(record)
        except Exception:  # noqa: BLE001 - 取消/断线/handler 抛错都只结束这一路订阅
            pass
        finally:
            if capture:
                self._release_capture()

    def _stream(
        self,
        types: List[str],
        stop: threading.Event,
        deadline: Optional[float] = None,
    ) -> Iterator[EventRecord]:
        """标签级事件流：长轮询续传，直到 stop 或 deadline。

        每次最多挂 1 秒，这样取消和超时都在一秒内生效。
        """
        since: Optional[int] = None
        while not stop.is_set():
            if deadline is None:
                wait = 1.0
            else:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                wait = min(1.0, remaining)
            result = self._transport.events(since=since, types=types, tab_id=self.id, wait=wait)
            if stop.is_set():
                return
            if result.get('busy'):
                stop.wait(0.1)
                continue
            floor = since
            since = int(result.get('seq') or 0)
            for raw in result.get('events') or []:
                if stop.is_set():
                    return
                record = EventRecord.of(raw)
                # 位置失效时服务端会重放缓冲，比自己拿到的位置还旧的丢掉
                if floor is not None and record.seq <= floor:
                    continue
                yield record

    def _acquire_capture(self) -> None:
        # 在锁里做 net_start：并发订阅共用一次握手，后来的不用抢跑
        with self._capture_lock:
            if self._capture_users == 0:
                try:
                    self.call('net_start', {})
                except BrowserPilotError:
                    pass
            self._capture_users += 1

    def _release_capture(self) -> None:
        with self._capture_lock:
            self._capture_users = max(0, self._capture_users - 1)
            if self._capture_users == 0:
                try:
                    self.call('net_stop', {})
                except BrowserPilotError:
                    pass

    # ---------- 截图 ----------

    def screenshot(
        self,
        path: Optional[str] = None,
        target: Optional[PageTarget] = None,
        clip: Optional[Mapping[str, Any]] = None,
        grid: bool = False,
        edge_only: bool = False,
    ) -> bytes:
        """返回图片字节，给了 path 就顺手写一份。

        grid 默认关：App 默认会画坐标网格（给人用截图点位置），SDK 里那是噪点。
        """
        args: Dict[str, Any] = {'grid': bool(grid)}
        if edge_only:
            args['edgeOnly'] = True
        if target is not None:
            args.update(_locate_fields(self._spec_of(target)) or {})
        if clip:
            args.update(dict(clip))
        result = self._raw('page_screenshot', args)
        if result.image is None:
            raise ToolError('page_screenshot', {'ok': False, 'error': '截图没有返回图片内容'})
        if path:
            Path(path).write_bytes(result.image.data)
        return result.image.data

    # ---------- 生命周期 ----------

    def bring_to_front(self) -> None:
        self._raw('tab_activate', {'tabId': self.id})

    def close(self) -> None:
        self._raw('tab_close', {'tabId': self.id})

    # ---------- 内部 ----------

    def _spec_of(self, target: PageTarget) -> LocatorSpec:
        if isinstance(target, Locator):
            return target.spec
        return coerce_spec(target)

    def _info(self) -> Dict[str, str]:
        tabs = self._transport.call('tab_list', {}).data.get('tabs') or []
        for tab in tabs:
            if tab.get('id') == self.id:
                return {'url': str(tab.get('url') or ''), 'title': str(tab.get('title') or '')}
        raise NotFoundError(f'标签 {self.id} 已经不在了')

    def _raw(self, tool: str, args: Mapping[str, Any], timeout: Optional[float] = None):
        # tabId 放前面，这样显式传进来的 tabId 仍然能覆盖。
        return self._transport.call(tool, {'tabId': self.id, **dict(args)}, timeout=timeout)

    def _poll_text(self, text: str, state: str, timeout: float, poll: float) -> None:
        deadline = time.monotonic() + timeout
        try:
            while True:
                found = self.call('page_find', {'text': text})
                # page_find 返回 { matches, active }；total 兜底兼容旧载荷
                present = _as_int(found.get('matches', found.get('total'))) > 0
                if present != (state == 'gone'):
                    return
                if time.monotonic() > deadline:
                    raise NotFoundError(
                        f"等了 {timeout}s，页面上{'还' if state == 'gone' else '没'}出现「{text}」"
                    )
                time.sleep(poll)
        finally:
            # 原生查找会高亮，收尾一定要清掉。
            try:
                self.call('page_find', {'stop': True})
            except BrowserPilotError:
                pass

    def _poll_snapshot(self, name: str, state: str, timeout: float, poll: float) -> None:
        """page_wait 不认 role，只能轮询无障碍树。"""
        deadline = time.monotonic() + timeout
        while True:
            present = name in self.snapshot()
            if present != (state == 'gone'):
                return
            if time.monotonic() > deadline:
                raise NotFoundError(
                    f"等了 {timeout}s，无障碍树里{'还' if state == 'gone' else '没'}出现「{name}」"
                )
            time.sleep(poll)
