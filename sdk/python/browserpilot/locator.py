"""定位器：只记录「用户想怎么找」，能不能这样找由各个动作决定。

BrowserPilot 的工具不是每个都支持全部定位方式：点击支持 text / role+name /
xpath / selector，输入只支持 label / placeholder / xpath / selector。
所以这里保留定位意图，由各个动作自己翻译成工具参数。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Dict, NamedTuple, Optional, Union

from .errors import NotFoundError

__all__ = [
    'LocatorSpec',
    'Locator',
    'is_locator_spec',
    'coerce_spec',
    'describe',
    'action_args',
    'type_plan',
    'wait_args',
    'TypePlan',
]


@dataclass(frozen=True)
class LocatorSpec:
    role: Optional[str] = None
    name: Optional[str] = None
    # 'exact' 或 'contains'，None 表示让工具自己决定。
    name_match: Optional[str] = None
    text: Optional[str] = None
    text_match: Optional[str] = None
    # 关联的 label 或 placeholder。
    label: Optional[str] = None
    placeholder: Optional[str] = None
    test_id: Optional[str] = None
    alt: Optional[str] = None
    selector: Optional[str] = None
    xpath: Optional[str] = None
    # 缩小范围的 CSS 容器，支持 :has-text()。
    within: Optional[str] = None
    # 多个匹配时取第几个，从 0 开始。
    index: Optional[int] = None
    # 搜索 shadow DOM 和同源 iframe。
    pierce: bool = False
    # 进 iframe 找：填 frame URL 的一段（和 App 的 frame 参数同义）。
    frame: Optional[str] = None


# 字典写法和 Node 版的 camelCase 都认，用户不必背工具参数名。
_ALIASES = {
    'role': 'role',
    'name': 'name',
    'nameMatch': 'name_match',
    'name_match': 'name_match',
    'text': 'text',
    'textMatch': 'text_match',
    'text_match': 'text_match',
    'label': 'label',
    'placeholder': 'placeholder',
    'testId': 'test_id',
    'test_id': 'test_id',
    'alt': 'alt',
    'selector': 'selector',
    'xpath': 'xpath',
    'within': 'within',
    'index': 'index',
    'pierce': 'pierce',
    'frame': 'frame',
}


def is_locator_spec(value: Any) -> bool:
    return isinstance(value, Mapping) and any(key in _ALIASES for key in value)


def coerce_spec(value: Any) -> LocatorSpec:
    """把字符串 / 字典 / LocatorSpec 统一成 LocatorSpec。"""
    if isinstance(value, LocatorSpec):
        return value
    if isinstance(value, str):
        return LocatorSpec(selector=value)
    if isinstance(value, Mapping):
        fields: Dict[str, Any] = {}
        for key, item in value.items():
            field = _ALIASES.get(key)
            if field is None:
                raise TypeError(f'定位描述里没有 {key} 这个字段')
            fields[field] = item
        if not fields:
            raise TypeError('定位描述是空的')
        return LocatorSpec(**fields)
    raise TypeError('定位目标必须是 CSS 选择器字符串、Locator 或定位描述字典')


def describe(spec: LocatorSpec) -> str:
    """给人看的描述，用在报错里。"""
    label = _describe_body(spec)
    if spec.frame:
        return f'{label}（frame={spec.frame}）'
    return label


def _describe_body(spec: LocatorSpec) -> str:
    if spec.role:
        return f'role={spec.role}' + (f' name={spec.name}' if spec.name else '')
    if spec.text:
        return f'text={spec.text}'
    if spec.label:
        return f'label={spec.label}'
    if spec.placeholder:
        return f'placeholder={spec.placeholder}'
    if spec.test_id:
        return f'testId={spec.test_id}'
    if spec.alt:
        return f'alt={spec.alt}'
    if spec.xpath:
        return f'xpath={spec.xpath}'
    if spec.selector:
        return f'selector={spec.selector}'
    return '空定位器'


def action_args(spec: LocatorSpec) -> Dict[str, Any]:
    """page_click / page_hover 的定位字段。顺序按工具建议：text 优先，然后 role+name。"""
    args: Dict[str, Any] = {}
    if spec.text:
        args['text'] = spec.text
        if spec.text_match:
            args['textMatch'] = spec.text_match
    elif spec.role:
        args['role'] = spec.role
        if spec.name:
            args['name'] = spec.name
        if spec.name_match:
            args['nameMatch'] = spec.name_match
    elif spec.selector:
        args['selector'] = spec.selector
        if spec.pierce:
            args['pierce'] = True
    elif spec.xpath:
        args['xpath'] = spec.xpath
        if spec.pierce:
            args['pierce'] = True
    elif spec.test_id:
        args['testId'] = spec.test_id
    elif spec.alt:
        args['alt'] = spec.alt
    if spec.within:
        args['within'] = spec.within
    if spec.index is not None:
        args['index'] = spec.index
    if spec.frame:
        args['frame'] = spec.frame
    return args


class TypePlan(NamedTuple):
    # 'inject'：一次调用直接覆盖；'focus'：先聚焦再插入，要三步。
    mode: str
    args: Dict[str, Any]


def type_plan(spec: LocatorSpec) -> TypePlan:
    """page_type 只认 label / placeholder / xpath / selector。

    role+name 的输入框通常就是文本框，它的可访问名一般也是 label，退一步用它当 label。
    """
    if spec.selector:
        args: Dict[str, Any] = {'selector': spec.selector}
        if spec.pierce:
            args['pierce'] = True
        if spec.frame:
            args['frame'] = spec.frame
        return TypePlan('inject', args)
    if spec.xpath:
        args = {'xpath': spec.xpath}
        if spec.pierce:
            args['pierce'] = True
        if spec.frame:
            args['frame'] = spec.frame
        return TypePlan('inject', args)
    if spec.label:
        return TypePlan('focus', {'label': spec.label})
    if spec.placeholder:
        return TypePlan('focus', {'placeholder': spec.placeholder})
    if spec.role in ('textbox', 'searchbox', 'combobox') and spec.name:
        return TypePlan('focus', {'label': spec.name})
    raise NotFoundError(
        f'无法输入 {describe(spec)}：page_type 只支持 selector、xpath、label、placeholder，'
        '以及 role=textbox/searchbox/combobox 且带 name 的定位器。'
    )


def wait_args(spec: LocatorSpec, state: str, timeout: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """page_wait 只认 xpath / selector，而且不支持 frame。返回 None 表示这个定位器得靠轮询。"""
    if spec.frame:
        return None
    args: Dict[str, Any] = {'state': state}
    if timeout is not None:
        args['timeout'] = timeout
    if spec.selector:
        args['selector'] = spec.selector
        if spec.pierce:
            args['pierce'] = True
        return args
    if spec.xpath:
        args['xpath'] = spec.xpath
        if spec.pierce:
            args['pierce'] = True
        return args
    return None


class Locator:
    """链式定位器。每个动作都落在当前页面上，页面上唯一匹配才算成功（工具本身就这么要求）。"""

    def __init__(self, page, spec):
        self.page = page
        self.spec = coerce_spec(spec)

    # ---------- 收窄 ----------

    def nth(self, index: int) -> 'Locator':
        """多个匹配时取第 index 个，从 0 开始。"""
        return Locator(self.page, replace(self.spec, index=index))

    def first(self) -> 'Locator':
        return self.nth(0)

    def within(self, selector: str) -> 'Locator':
        """在某个容器里找。"""
        return Locator(self.page, replace(self.spec, within=selector))

    def pierce(self) -> 'Locator':
        """进 shadow DOM 和同源 iframe 里找。"""
        return Locator(self.page, replace(self.spec, pierce=True))

    # ---------- 动作 ----------

    def click(self, button=None, count=None, timeout=None, via=None) -> None:
        return self.page.click(self.spec, button=button, count=count, timeout=timeout, via=via)

    def dblclick(self) -> None:
        return self.page.click(self.spec, count=2)

    def fill(self, value: str) -> None:
        """Playwright 语义：覆盖已有内容。selector/xpath 一次调用，其余要三步。"""
        return self.page.fill(self.spec, value)

    def type(self, value: str) -> None:
        """在光标处追加，不清空。"""
        return self.page.type(self.spec, value)

    def hover(self) -> None:
        return self.page.hover(self.spec)

    def select_option(self, option: str) -> None:
        return self.page.select(self.spec, option)

    def scroll_into_view(self) -> None:
        return self.page.scroll_to(self.spec)

    # ---------- 等待与读取 ----------

    def wait_for(self, state: str = 'appear', timeout: float = 10, poll: Optional[float] = None) -> None:
        return self.page.wait_for(self.spec, state=state, timeout=timeout, poll=poll)

    def count(self) -> int:
        return self.page.count(self.spec)

    def is_visible(self) -> bool:
        return self.page.is_visible(self.spec)

    def text_content(self) -> str:
        return self.page.text_content(self.spec)

    def screenshot(self, path: Optional[str] = None, grid: Union[bool, int] = True) -> bytes:
        return self.page.screenshot(path=path, target=self.spec, grid=grid)

    def __str__(self) -> str:
        return f'Locator({describe(self.spec)})'

    __repr__ = __str__
