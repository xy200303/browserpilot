"""把手里的工具按用途分组，省得每处都写 ``bp.call('workflow_run', ...)``。

设计原则：
- 每个方法就是一次工具调用，参数名和工具保持一致，不做花哨转换；
- 返回值就是工具载荷里的字段，不额外包一层；
- 传 ``None`` 的参数会被丢掉，工具端好收默认值。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

TabLike = Union[str, Any]


def _tab_id(tab: TabLike) -> str:
    if isinstance(tab, str):
        return tab
    tab_id = getattr(tab, 'id', None)
    if not tab_id:
        raise TypeError('需要一个 tab id 或者 Page 对象')
    return str(tab_id)


class _Api:
    def __init__(self, bp: Any) -> None:
        self._bp = bp

    def _call(self, tool: str, **args: Any) -> Dict[str, Any]:
        payload = {key: value for key, value in args.items() if value is not None}
        return self._bp.call(tool, payload)


class Environments(_Api):
    """环境 = 一套 cookie 和登录态，也对应一扇窗口。"""

    def list(self) -> List[Dict[str, Any]]:
        return list(self._call('env_list').get('envs') or [])

    def create(self, name: str, remark: str) -> Dict[str, Any]:
        """新建环境并打开窗口。remark 必填：写清楚这套环境是干什么的。"""
        return self._call('env_create', name=name, remark=remark)

    def open(self, env: str, headless: Optional[bool] = None) -> Dict[str, Any]:
        return self._call('env_open', env=env, headless=headless)

    def close(self, env: str) -> Dict[str, Any]:
        """关窗口，但保留登录态和标签会话。"""
        return self._call('env_close', env=env)

    def front(self, env: str, tab: Optional[TabLike] = None) -> Dict[str, Any]:
        return self._call('env_front', env=env, tabId=_tab_id(tab) if tab is not None else None)

    def update(self, env: str, name: Optional[str] = None, remark: Optional[str] = None) -> Dict[str, Any]:
        return self._call('env_update', env=env, name=name, remark=remark)

    def headless(self, env: str, headless: bool = True) -> Dict[str, Any]:
        return self._call('env_headless', env=env, headless=headless)

    def delete(self, env: str) -> Dict[str, Any]:
        """删环境 = 删目录，登录态一起没。默认环境不能删。"""
        return self._call('env_delete', env=env)

    def export(self, env: str, path: Optional[str] = None) -> Dict[str, Any]:
        """导出 cookie 到文件，用来在别的机器上复现登录态。"""
        return self._call('env_export', env=env, path=path)

    def import_(self, path: str, env: Optional[str] = None) -> Dict[str, Any]:
        return self._call('env_import', path=path, env=env)


class Tabs(_Api):
    def list(self) -> List[Dict[str, Any]]:
        return list(self._call('tab_list').get('tabs') or [])

    def open(self, env: Optional[str] = None, url: Optional[str] = None, group: Optional[str] = None) -> Dict[str, Any]:
        return self._call('tab_open', env=env, url=url, groupId=group)

    def close(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('tab_close', tabId=_tab_id(tab))

    def activate(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('tab_activate', tabId=_tab_id(tab))

    def mute(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('tab_mute', tabId=_tab_id(tab))

    def restore(self) -> Dict[str, Any]:
        return self._call('tab_restore')

    def duplicate(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('tab_duplicate', tabId=_tab_id(tab))

    def close_others(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('tab_close_others', tabId=_tab_id(tab))


class Groups(_Api):
    def list(self) -> List[Dict[str, Any]]:
        return list(self._call('group_list').get('groups') or [])

    def create(self, env: str, name: str, color: Optional[str] = None) -> Dict[str, Any]:
        return self._call('group_create', env=env, name=name, color=color)

    def update(self, env: str, id: str, name: Optional[str] = None, color: Optional[str] = None) -> Dict[str, Any]:
        return self._call('group_update', env=env, id=id, name=name, color=color)

    def delete(self, env: str, id: str) -> Dict[str, Any]:
        return self._call('group_delete', env=env, id=id)

    def assign(self, tab: TabLike, group: Optional[str] = None) -> Dict[str, Any]:
        """group 传 None 表示移出分组。"""
        return self._call('tab_group', tabId=_tab_id(tab), groupId=group)


class Settings(_Api):
    def get(self) -> Dict[str, Any]:
        return dict(self._call('settings_get').get('settings') or {})

    def update(self, **fields: Any) -> Dict[str, Any]:
        return self._call('settings_set', **fields)


class Workflows(_Api):
    def list(self) -> List[Dict[str, Any]]:
        return list(self._call('workflow_list').get('workflows') or [])

    def run(self, name: str, inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._call('workflow_run', name=name, inputs=inputs or {})

    def run_batch(self, name: str, rows: List[Dict[str, Any]], env: Optional[str] = None) -> Dict[str, Any]:
        return self._call('workflow_batch', name=name, rows=rows, env=env)

    def export(self, name: str, path: Optional[str] = None) -> Dict[str, Any]:
        return self._call('workflow_export', name=name, path=path)

    def import_(self, path: str) -> Dict[str, Any]:
        return self._call('workflow_import', path=path)

    def delete(self, name: str) -> Dict[str, Any]:
        return self._call('workflow_delete', name=name)

    def write(self, workflow: Dict[str, Any]) -> Dict[str, Any]:
        return self._call('workflow_write', **workflow)

    def update(self, name: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._call('workflow_update', name=name, **patch)

    def record(self, action: str, name: Optional[str] = None) -> Dict[str, Any]:
        """action: start / stop / cancel。录制期间的工具调用会变成工作流节点。"""
        return self._call('workflow_record', action=action, name=name)


class Net(_Api):
    """按标签抓包。会占用 debugger，和 page.cdp 共用同一个租约。"""

    def start(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('net_start', tabId=_tab_id(tab))

    def stop(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('net_stop', tabId=_tab_id(tab))

    def list(self, tab: TabLike, url_contains: Optional[str] = None) -> List[Dict[str, Any]]:
        return list(self._call('net_list', tabId=_tab_id(tab), urlContains=url_contains).get('requests') or [])

    def get(self, req_id: str) -> Dict[str, Any]:
        return self._call('net_get', reqId=req_id)

    def export(self, tab: TabLike, path: Optional[str] = None) -> Dict[str, Any]:
        return self._call('net_export', tabId=_tab_id(tab), path=path)

    def mock(self, tab: TabLike, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self._call('net_mock', tabId=_tab_id(tab), rules=rules)

    def mock_off(self, tab: TabLike) -> Dict[str, Any]:
        return self._call('net_mock_off', tabId=_tab_id(tab))


class History(_Api):
    def list(self, env: str, query: Optional[str] = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        return list(self._call('history_list', env=env, query=query, limit=limit).get('history') or [])

    def remove(
        self,
        env: str,
        id: Optional[str] = None,
        url: Optional[str] = None,
        all_entries: bool = False,
    ) -> int:
        payload = self._call('history_remove', env=env, id=id, url=url, all=True if all_entries else None)
        return int(payload.get('removed') or 0)


class Bookmarks(_Api):
    def list(self, env: str, query: Optional[str] = None) -> List[Dict[str, Any]]:
        return list(self._call('bookmark_list', env=env, query=query).get('bookmarks') or [])

    def add(self, env: str, url: str, title: Optional[str] = None) -> Dict[str, Any]:
        return self._call('bookmark_add', env=env, url=url, title=title)

    def remove(
        self,
        env: str,
        id: Optional[str] = None,
        url: Optional[str] = None,
        all_entries: bool = False,
    ) -> int:
        payload = self._call('bookmark_remove', env=env, id=id, url=url, all=True if all_entries else None)
        return int(payload.get('removed') or 0)


class Downloads(_Api):
    def list(self, wait: Optional[float] = None) -> List[Dict[str, Any]]:
        """wait 是等活跃下载完成的秒数，最多 120。"""
        return list(self._call('download', action='list', wait=wait).get('downloads') or [])

    def directory(self) -> Dict[str, Any]:
        return self._call('download', action='dir')

    def set_directory(self, path: str) -> Dict[str, Any]:
        return self._call('download', action='dir', path=path)

    def _act(self, action: str, id: Optional[str] = None) -> Dict[str, Any]:
        return self._call('download', action=action, id=id)

    def open(self, id: str) -> Dict[str, Any]:
        return self._act('open', id)

    def show(self, id: str) -> Dict[str, Any]:
        return self._act('show', id)

    def copy(self, id: str) -> Dict[str, Any]:
        return self._act('copy', id)

    def pause(self, id: str) -> Dict[str, Any]:
        return self._act('pause', id)

    def resume(self, id: str) -> Dict[str, Any]:
        return self._act('resume', id)

    def cancel(self, id: str) -> Dict[str, Any]:
        return self._act('cancel', id)

    def retry(self, id: str) -> Dict[str, Any]:
        return self._act('retry', id)

    def remove(self, id: str) -> Dict[str, Any]:
        return self._act('remove', id)

    def clear(self) -> Dict[str, Any]:
        return self._act('clear')


class Network(_Api):
    """每套环境自己的出口：代理、UA、语言、WebRTC 策略。"""

    def get(self, env: str) -> Dict[str, Any]:
        return self._call('network_get', env=env)

    def set(
        self,
        env: str,
        proxy: Optional[Dict[str, Any]] = None,
        user_agent: Optional[str] = None,
        accept_languages: Optional[str] = None,
        timezone: Optional[str] = None,
        locale: Optional[str] = None,
        webrtc_policy: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._call(
            'network_set',
            env=env,
            proxy=proxy,
            userAgent=user_agent,
            acceptLanguages=accept_languages,
            timezone=timezone,
            locale=locale,
            webrtcPolicy=webrtc_policy,
        )
