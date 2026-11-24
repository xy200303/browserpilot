"""对着真实的 BrowserPilot 跑一遍。

用法：
    python sdk/python/scripts/smoke.py
    BROWSERPILOT_MCP_FILE=... python sdk/python/scripts/smoke.py

端点是 `mcp.json` 里的 `api` 字段；没有它就说明装的是旧版 App。
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows 控制台默认 GBK，✓ 会直接抛 UnicodeEncodeError
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from browserpilot import launch, mcp_file  # noqa: E402


def main() -> int:
    file = Path(os.environ.get('BROWSERPILOT_MCP_FILE') or mcp_file())
    saved = json.loads(file.read_text(encoding='utf-8'))
    if not saved.get('api'):
        print(f'✗ {file} 里没有 api 字段：装的是旧版 App')
        return 1

    started = time.time()
    bp = launch(endpoint={'api': saved['api'], 'url': saved.get('url', ''), 'token': saved['token']})
    page = None
    try:
        envs = bp.environments()
        print(f'✓ 连上端点，环境 {len(envs)} 套：' + ', '.join(env["id"] for env in envs))

        page = bp.new_page()
        print(f'✓ 新标签 {page.id}')

        before = bp.call('env_list')
        page.goto('https://example.com')
        print(f'✓ 导航到 example.com，标题「{page.title()}」')

        shot = page.screenshot()
        print(f'✓ 截图 {len(shot)} 字节')

        page.wait_for_text('Example', timeout=10)
        print('✓ wait_for_text 找到 Example')

        count = page.count('p')
        print(f"✓ count('p') = {count}")

        result = bp.transport.events(since=before.get('seq'), wait=3)
        types = sorted({event.get('type', '') for event in result.get('events') or []})
        print(f"✓ 事件 {len(result.get('events') or [])} 条，类型：{', '.join(types) or '（无）'}")

        print(f'\n冒烟通过，用时 {int((time.time() - started) * 1000)}ms')
        return 0
    except Exception as error:  # noqa: BLE001 - 冒烟脚本要打出真正的异常
        print(f'✗ 冒烟失败：{error!r}')
        return 1
    finally:
        if page is not None:
            try:
                page.close()
            except Exception:  # noqa: BLE001
                pass
        bp.close()


if __name__ == '__main__':
    raise SystemExit(main())
