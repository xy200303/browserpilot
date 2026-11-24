"""端点文件和安装位置。

App 在启动时把 userData 固定成「系统配置目录/BrowserPilot」，
所以 mcp.json 的位置只跟系统有关，跟 App 装在哪儿无关。
"""

from __future__ import annotations

import ntpath
import os
import posixpath
import sys
from pathlib import Path

__all__ = [
    'app_data_root',
    'mcp_file',
    'data_home',
    'sdk_dir',
    'downloads_dir',
    'looks_like_app',
    'install_candidates',
]


def _get(env, name):
    """读环境变量。Windows 上 os.environ 的键大小写不敏感，这里统一处理。"""
    if name in env:
        return env[name]
    lowered = name.lower()
    for key, value in env.items():
        if key.lower() == lowered:
            return value
    return None


def _join(platform, *parts):
    # 模拟别的系统时用那个系统的分隔符，报错信息和测试都更直观。
    return ntpath.join(*parts) if platform == 'win32' else posixpath.join(*parts)


def _home():
    return str(Path.home())


def app_data_root(platform=None, env=None):
    """App 的 userData 根目录。"""
    platform = platform or sys.platform
    env = os.environ if env is None else env
    if platform == 'win32':
        return _get(env, 'APPDATA') or _join(platform, _home(), 'AppData', 'Roaming')
    if platform == 'darwin':
        return _join(platform, _home(), 'Library', 'Application Support')
    return _get(env, 'XDG_CONFIG_HOME') or _join(platform, _home(), '.config')


def mcp_file(platform=None, env=None):
    """`%APPDATA%\\BrowserPilot\\mcp.json` / `~/Library/Application Support/...` / `~/.config/...`"""
    return _join(platform or sys.platform, app_data_root(platform, env), 'BrowserPilot', 'mcp.json')


def data_home(env=None):
    """SDK 自己的目录：下载缓存和便携副本都放这儿。"""
    env = os.environ if env is None else env
    return _get(env, 'BROWSERPILOT_HOME') or os.path.join(_home(), '.browserpilot')


def sdk_dir(version):
    return os.path.join(data_home(), 'sdk', version)


def downloads_dir():
    return os.path.join(data_home(), 'downloads')


def looks_like_app(path, platform=None):
    """确认某个路径真是应用本体，而不是同目录下的 cli/browserpilot。

    打包后的 App 一定有 `resources/app.asar`；AppImage 是一整个大文件。
    """
    platform = platform or sys.platform
    candidate = Path(path)
    try:
        if not candidate.is_file():
            return False
        if platform == 'darwin' and '.app/Contents/MacOS/' in str(candidate).replace('\\', '/'):
            return True
        if candidate.stat().st_size > 20 * 1024 * 1024:
            return True
        return (candidate.parent / 'resources' / 'app.asar').is_file()
    except OSError:
        return False


def _from_path(exe, platform, env):
    """安装包会把 CLI 放进 PATH；同一个目录里通常就是应用本体。"""
    raw = _get(env, 'PATH') or ''
    separator = ';' if platform == 'win32' else ':'
    return [_join(platform, directory, exe) for directory in raw.split(separator) if directory]


def install_candidates(platform=None, env=None):
    """桌面版的默认安装位置。SDK 优先用这些，因为登录态都在用户日常那份里。"""
    platform = platform or sys.platform
    env = os.environ if env is None else env
    if platform == 'win32':
        local = _get(env, 'LOCALAPPDATA') or _join(platform, _home(), 'AppData', 'Local')
        pf = _get(env, 'ProgramFiles') or 'C:\\Program Files'
        pf86 = _get(env, 'ProgramFiles(x86)') or 'C:\\Program Files (x86)'
        return [
            _join(platform, local, 'Programs', 'BrowserPilot', 'BrowserPilot.exe'),
            _join(platform, pf, 'BrowserPilot', 'BrowserPilot.exe'),
            _join(platform, pf86, 'BrowserPilot', 'BrowserPilot.exe'),
            *_from_path('BrowserPilot.exe', platform, env),
        ]
    if platform == 'darwin':
        return [
            '/Applications/BrowserPilot.app/Contents/MacOS/BrowserPilot',
            _join(platform, _home(), 'Applications', 'BrowserPilot.app', 'Contents', 'MacOS', 'BrowserPilot'),
        ]
    return [
        '/opt/BrowserPilot/BrowserPilot',
        '/usr/lib/browserpilot/BrowserPilot',
        *_from_path('BrowserPilot', platform, env),
    ]
