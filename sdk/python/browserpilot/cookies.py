"""cookie 的导出与注入。掉登录时不用重扫，把上次导出的 cookie 注回去就行。

Client 和 Page 都调这里，只是传进来的 call 不一样（Page 不能带 tabId，cookie 工具不认）。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

__all__ = ['list_cookies', 'add_cookies', 'clear_cookies']

Call = Callable[[str, Dict[str, Any]], Dict[str, Any]]

_LIST_FIELDS = ('domain', 'path', 'secure', 'httpOnly', 'expirationDate', 'url')


def list_cookies(call: Call, env: Optional[str] = None, domain: Optional[str] = None) -> List[Dict[str, Any]]:
    args: Dict[str, Any] = {}
    if env:
        args['env'] = env
    if domain:
        args['domain'] = domain
    data = call('cookie_list', args)
    return list(data.get('cookies') or [])


def add_cookies(call: Call, cookies: Any, env: Optional[str] = None) -> int:
    items = list(cookies) if isinstance(cookies, (list, tuple)) else [cookies]
    written = 0
    for item in items:
        payload = dict(item)
        payload.pop('session', None)
        for key in _LIST_FIELDS:
            if payload.get(key) is None:
                payload.pop(key, None)
        if not payload.get('name') or payload.get('value') is None:
            raise ValueError('cookie 至少要 name 和 value')
        if env:
            payload['env'] = env
        call('cookie_set', payload)
        written += 1
    return written


def clear_cookies(
    call: Call,
    name: Optional[str] = None,
    domain: Optional[str] = None,
    url: Optional[str] = None,
    all: bool = False,
    env: Optional[str] = None,
) -> None:
    if not any((name, domain, url, all)):
        raise ValueError('clear_cookies 至少要给 name / domain / url，或者 all=True')
    scope: Dict[str, Any] = {'name': name} if name else {}
    if domain:
        scope['domain'] = domain
    if url:
        scope['url'] = url
    if all:
        scope['all'] = True
    if env:
        scope['env'] = env
    if name and not (domain or url or all):
        # App 要 url+name 或 domain 或 all；只给 name 时先查一下这个 cookie 在哪些域上。
        domains = sorted(
            {
                str(item.get('domain'))
                for item in list_cookies(call, env=env)
                if item.get('name') == name and item.get('domain')
            }
        )
        for item in domains:
            call('cookie_remove', {**scope, 'domain': item})
        return
    call('cookie_remove', scope)
