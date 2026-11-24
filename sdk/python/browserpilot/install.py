"""找一份能用的 BrowserPilot，找不到才下载。

已经装好的优先，因为用户的登录态都在桌面版那份里。下载只在最后一步发生，
并且边下边算 SHA-256，校验不过就删掉。
"""

from __future__ import annotations

import hashlib
import json
import os
import platform as platform_module
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .errors import InstallError
from .paths import downloads_dir, install_candidates, looks_like_app, sdk_dir

__all__ = [
    'APP_VERSION',
    'SDK_VERSION',
    'Asset',
    'AppLocation',
    'asset_for',
    'locate_app',
    'ensure_app',
    'download_app',
]

# SDK 版本和 App 版本同号，只留一个真源：asset 名和下载目录都从这里来。
APP_VERSION = '0.21.0'
SDK_VERSION = '0.21.0'

RELEASE_API = 'https://api.github.com/repos/xy200303/browserpilot/releases/tags'
USER_AGENT = 'browserpilot-sdk'


@dataclass(frozen=True)
class Asset:
    """Release 里的一个资产。exe 是应用本体相对安装目录的路径。"""

    name: str
    kind: str  # 'zip' | 'appimage'
    exe: str


@dataclass(frozen=True)
class AppLocation:
    exe: str
    source: str  # 'env' | 'installed' | 'cache' | 'downloaded'
    # 只有 SDK 自己装的那份才知道确切版本。
    version: Optional[str] = None


def _host_arch() -> str:
    machine = (platform_module.machine() or '').lower()
    if machine in ('x86_64', 'amd64', 'x64'):
        return 'x64'
    if machine in ('arm64', 'aarch64'):
        return 'arm64'
    return machine


def asset_for(version: str = APP_VERSION, platform: Optional[str] = None, arch: Optional[str] = None) -> Asset:
    """这是实际存在的组合，不是猜的：发布流水线只产出这三个平台。

    别的组合直接报错，不要下到一半才发现。
    """
    platform = platform or sys.platform
    arch = arch or _host_arch()
    if platform == 'win32' and arch == 'x64':
        return Asset(name=f'BrowserPilot-{version}-win.zip', kind='zip', exe='BrowserPilot.exe')
    if platform == 'darwin' and arch == 'arm64':
        return Asset(
            name=f'BrowserPilot-{version}-arm64-mac.zip',
            kind='zip',
            exe='BrowserPilot.app/Contents/MacOS/BrowserPilot',
        )
    if platform == 'linux' and arch == 'x64':
        return Asset(
            name=f'BrowserPilot-{version}.AppImage',
            kind='appimage',
            exe='BrowserPilot.AppImage',
        )
    raise InstallError(
        f'没有 {platform}-{arch} 的 BrowserPilot 构建。目前只发布 Windows x64、macOS arm64、Linux x64。'
        '如果你本机已经装了桌面版，把 BROWSERPILOT_EXE 指向它就能用。'
    )


def locate_app(exe: Optional[str] = None, version: Optional[str] = None) -> Optional[AppLocation]:
    """找一份装好的 BrowserPilot，不做任何网络请求。"""
    explicit = exe or os.environ.get('BROWSERPILOT_EXE')
    if explicit:
        if not os.path.exists(explicit):
            raise InstallError(f'BROWSERPILOT_EXE 指向的 {explicit} 不存在')
        return AppLocation(exe=explicit, source='env')

    for candidate in install_candidates():
        if looks_like_app(candidate):
            return AppLocation(exe=candidate, source='installed')

    version = version or APP_VERSION
    cached = Path(sdk_dir(version)) / asset_for(version).exe
    if looks_like_app(str(cached)):
        return AppLocation(exe=str(cached), source='cache', version=version)
    return None


def ensure_app(
    exe: Optional[str] = None,
    version: Optional[str] = None,
    offline: bool = False,
    on_download: Optional[Callable[[Dict[str, Any]], None]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> AppLocation:
    found = locate_app(exe=exe, version=version)
    if found is not None:
        return found

    if offline or os.environ.get('BROWSERPILOT_OFFLINE') == '1':
        raise InstallError('没找到 BrowserPilot，而且现在是离线模式（BROWSERPILOT_OFFLINE=1）。')

    version = version or APP_VERSION
    path = download_app(version, on_download=on_download, log=log)
    return AppLocation(exe=path, source='downloaded', version=version)


def _release_asset(version: str, name: str) -> Dict[str, Any]:
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': USER_AGENT}
    # 没登录的 GitHub API 是 60 次/小时，CI 里塞个 token 更稳。
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = f'Bearer {token}'

    request = urllib.request.Request(f'{RELEASE_API}/v{version}', headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise InstallError(f'GitHub 上没有 v{version} 这个版本') from error
        raise InstallError(f'GitHub 返回 {error.code}，可能触发了限流') from error
    except (urllib.error.URLError, OSError) as error:
        raise InstallError(f'查 v{version} 的发行版失败') from error

    for item in (payload.get('assets') if isinstance(payload, dict) else None) or []:
        if item.get('name') == name:
            return item
    raise InstallError(f'v{version} 里没有 {name}')


def _sha256_file(path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _unlink(path) -> None:
    try:
        Path(path).unlink()
    except OSError:
        pass


def _stream_download(
    url: str,
    partial: Path,
    asset_name: str,
    expected: Optional[str],
    size: int,
    on_download: Optional[Callable[[Dict[str, Any]], None]],
) -> None:
    """边下边算哈希，只落到 .part，失败不会留下半个可执行文件。"""
    digest = hashlib.sha256()
    received = 0
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30 * 60) as response:
            total = int(response.headers.get('Content-Length') or size or 0)
            with open(partial, 'wb') as out:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    out.write(chunk)
                    received += len(chunk)
                    if on_download is not None:
                        on_download({'asset': asset_name, 'received': received, 'total': total})
    except urllib.error.HTTPError as error:
        _unlink(partial)
        raise InstallError(f'下载失败：HTTP {error.code}') from error
    except (urllib.error.URLError, OSError) as error:
        _unlink(partial)
        raise InstallError('下载中断') from error

    actual = digest.hexdigest()
    if expected and expected != actual:
        _unlink(partial)
        raise InstallError(f'SHA-256 不匹配：期望 {expected}，实际 {actual}')


def _extract_zip(archive: Path, target: Path) -> None:
    try:
        with zipfile.ZipFile(archive) as bundle:
            root = target.resolve()
            for member in bundle.infolist():
                destination = (root / member.filename).resolve()
                # 包是我们自己发的，但越界路径仍然不能写出去。
                if destination != root and not destination.is_relative_to(root):
                    raise InstallError(f'压缩包里有越界路径：{member.filename}')
            bundle.extractall(target)
    except zipfile.BadZipFile as error:
        raise InstallError('解压失败：不是合法的 zip') from error


def download_app(
    version: str,
    on_download: Optional[Callable[[Dict[str, Any]], None]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> str:
    asset = asset_for(version)
    log = log or (lambda message: None)
    info = _release_asset(version, asset.name)

    downloads = Path(downloads_dir())
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / asset.name
    partial = archive.with_name(archive.name + '.part')
    expected = (info.get('digest') or '').replace('sha256:', '') or None
    size = int(info.get('size') or 0)

    # 上次下好且校验通过就不再下。
    reusable = archive.is_file() and (expected is None or _sha256_file(archive) == expected)
    if not reusable:
        log(f'下载 {asset.name}（{size / 1024 / 1024:.0f} MB）')
        _stream_download(info['browser_download_url'], partial, asset.name, expected, size, on_download)
        os.replace(partial, archive)

    target = Path(sdk_dir(version))
    target.mkdir(parents=True, exist_ok=True)

    if asset.kind == 'appimage':
        exe = target / asset.exe
        shutil.copyfile(archive, exe)
        os.chmod(exe, 0o755)
        return str(exe)

    _extract_zip(archive, target)
    exe = target / asset.exe
    if not exe.is_file():
        raise InstallError(f'解压后没找到 {asset.exe}')
    os.chmod(exe, 0o755)
    return str(exe)
