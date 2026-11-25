"""iframe 里的定位、读取和等待。

App 的定位工具只能按「frame URL 的一段」进 iframe（`page_click` / `page_type` /
`page_hover` / `page_script` 有 `frame` 参数），所以 Frame 记住自己的 URL 片段：

- 点击、输入、悬停：把 `frame` 传给对应工具，由 App 自己算坐标；
- 计数、文本、可见性、等待：用 `page_script` 在这个 frame 里执行，不碰主文档。

同一个 URL 的多个 iframe 会命中第一个，这是 App 的匹配规则；需要精确定位时用更长的 URL 片段。
"""

from __future__ import annotations

import json
import time
from dataclasses import replace
from typing import Any, Dict, Optional

from .errors import NotFoundError
from .locator import Locator, LocatorSpec, coerce_spec, describe

__all__ = ['Frame']

# iframe 没有 src（srcdoc、脚本写入）时，Electron 给的 frame URL 是 about:srcdoc。
SRCDOC_URL = 'about:srcdoc'

_FIRST_NODE = '''
(() => {{
  try {{
    const el = %s;
    return el ? true : false;
  }} catch (error) {{
    return false;
  }}
}})()
'''

_COUNT = '''
(() => {{
  try {{
    return %s;
  }} catch (error) {{
    return 0;
  }}
}})()
'''


def _js(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _first_expr(spec: LocatorSpec) -> str:
    """在 frame 文档里拿到第一个匹配节点的 JS 表达式。"""
    if spec.selector:
        return f'document.querySelector({_js(spec.selector)})'
    if spec.xpath:
        return (
            'document.evaluate('
            f'{_js(spec.xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null'
            ').singleNodeValue'
        )
    raise NotFoundError(f'frame 内只支持 selector / xpath，收到 {describe(spec)}')


def _count_expr(spec: LocatorSpec) -> str:
    if spec.selector:
        return f'document.querySelectorAll({_js(spec.selector)}).length'
    if spec.xpath:
        return (
            'document.evaluate('
            f'{_js(spec.xpath)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null'
            ').snapshotLength'
        )
    raise NotFoundError(f'frame 内只支持 selector / xpath，收到 {describe(spec)}')


class Frame:
    """一个 iframe。用 `page.frame_locator('iframe#main')` 或 `page.frames()` 拿。"""

    def __init__(self, page, url: str, name: str = '', selector: str = ''):
        self.page = page
        self.url = url
        self.name = name
        self.selector = selector

    def __str__(self) -> str:
        return f'Frame({self.url or self.name or self.selector or "about:blank"})'

    def __repr__(self) -> str:
        return str(self)

    @property
    def match(self) -> str:
        """传给 App 的 frame 片段。"""
        return self.url or SRCDOC_URL

    # ---------- 定位 ----------

    def locator(self, selector: str) -> Locator:
        return Locator(self.page, LocatorSpec(selector=selector, frame=self.match))

    def xpath(self, xpath: str) -> Locator:
        return Locator(self.page, LocatorSpec(xpath=xpath, frame=self.match))

    def get_by_text(self, text: str, exact: Optional[bool] = None) -> Locator:
        return Locator(
            self.page,
            LocatorSpec(text=text, text_match='exact' if exact else None, frame=self.match),
        )

    def get_by_role(self, role: str, name: Optional[str] = None, exact: Optional[bool] = None) -> Locator:
        return Locator(
            self.page,
            LocatorSpec(
                role=role,
                name=name,
                name_match='exact' if exact else None,
                frame=self.match,
            ),
        )

    def locator_spec(self, spec: LocatorSpec) -> LocatorSpec:
        """把任意定位器搬进这个 frame。"""
        return replace(spec, frame=self.match)

    # ---------- 执行 ----------

    def evaluate(self, source: str) -> Any:
        """在这个 frame 里跑 JS。跨域也能跑，因为走的是 App 的调试通道。"""
        return self.page.evaluate(source, frame=self.match)

    # ---------- 读取 ----------

    def count(self, target: Any) -> int:
        spec = self.page._spec_of(target)
        return int(self.evaluate(_COUNT % _count_expr(spec)) or 0)

    def text_content(self, target: Any) -> str:
        spec = self.page._spec_of(target)
        el = _first_expr(spec)
        value = self.evaluate(
            f'(() => {{ const el = {el}; return el ? (el.innerText || el.textContent || "") : ""; }})()'
        )
        return '' if value is None else str(value)

    def is_visible(self, target: Any) -> bool:
        spec = self.page._spec_of(target)
        el = _first_expr(spec)
        value = self.evaluate(
            f'''(() => {{
  const el = {el};
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return !!(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
}})()'''
        )
        return bool(value)

    # ---------- 等待 ----------

    def wait_for(
        self,
        target: Any,
        state: str = 'appear',
        timeout: float = 10,
        poll: float = 0.2,
    ) -> None:
        """等 frame 里的元素出现或消失。page_wait 不进 frame，所以这里轮询。"""
        spec = self.page._spec_of(target)
        if state not in ('appear', 'gone'):
            raise ValueError(f"state 只能是 appear 或 gone，收到 {state!r}")
        if spec.text and not (spec.selector or spec.xpath):
            probe = (
                '(() => { const text = document.body ? (document.body.innerText || "") : "";'
                f' return text.indexOf({_js(spec.text)}) !== -1; }})()'
            )

            def present_now() -> bool:
                return bool(self.evaluate(probe))
        else:
            count = _count_expr(spec)

            def present_now() -> bool:
                return int(self.evaluate(_COUNT % count) or 0) > 0

        deadline = time.monotonic() + timeout
        while True:
            if present_now() == (state == 'appear'):
                return
            if time.monotonic() > deadline:
                raise NotFoundError(
                    f'等了 {timeout}s，iframe「{self.match}」里'
                    f'{"还" if state == "gone" else "没"}出现 {describe(spec)}'
                )
            time.sleep(poll)

    def wait_for_function(self, expression: str, timeout: float = 10, poll: float = 0.2) -> Any:
        """在这个 frame 里轮询 JS 条件，返回使它为真的那个值。"""
        return self.page.wait_for_function(expression, timeout=timeout, poll=poll, frame=self.match)
