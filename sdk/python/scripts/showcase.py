"""高级效果演示：用 Python SDK 把几个"看起来不像自动化"的能力跑一遍。

    python sdk/python/scripts/showcase.py                 # 系统默认 mcp.json
    python sdk/python/scripts/showcase.py --mcp <path>    # 指定端点（比如开发版）

四段：
1. CDP 组合伪装：时区 + UA + 设备型号，页面里读出来验证
2. net_mock 改包：把某个接口的响应换成假数据，页面拿到的就是假的
3. 多环境并行：两套环境各自伪装不同时区，同时跑，互不影响
4. 工作流：录制一小段操作，再批量跑多行输入

跑完把建的环境删掉。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from browserpilot import connect  # noqa: E402


def endpoint_of(path: Path) -> dict:
    saved = json.loads(path.read_text(encoding='utf-8'))
    if not saved.get('api'):
        raise SystemExit(f'{path} 里没有 api 字段，装的是旧版 App')
    return {'api': saved['api'], 'url': saved.get('url', ''), 'token': saved['token']}


def show(title: str) -> None:
    print(f'\n=== {title} ===')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mcp', default=None, help='mcp.json 路径')
    args = parser.parse_args()
    bp = connect(endpoint_of(Path(args.mcp)) if args.mcp else None)
    created: list[str] = []
    name = ''
    try:
        # ---------- 1. CDP 组合伪装 ----------
        show('CDP 组合伪装')
        env = bp.envs.create(f'showcase-{int(time.time()) % 10000}', 'showcase 临时环境')['env']
        created.append(env)
        page = bp.new_page(env=env)
        page.goto('data:text/html,<title>spoof</title><p id=out>init</p>')

        page.cdp('Emulation.setTimezoneOverride', {'timezoneId': 'America/New_York'})
        page.cdp('Emulation.setUserAgentOverride', {'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Showcase/1.0'})
        page.cdp('Emulation.setDeviceMetricsOverride', {
            'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True,
        })

        probe = page.evaluate(
            "JSON.stringify({tz: Intl.DateTimeFormat().resolvedOptions().timeZone,"
            " ua: navigator.userAgent.slice(-20), w: innerWidth, screenW: screen.width, dpr: devicePixelRatio, lh: location.href.length,"
            " dpr: devicePixelRatio})"
        )
        print('页面读到的环境:', probe)
        parsed = json.loads(probe)
        assert parsed['tz'] == 'America/New_York', parsed
        assert 'Showcase' in parsed['ua'], parsed
        assert parsed['screenW'] == 390, parsed
        assert parsed['dpr'] == 3, parsed

        # ---------- 2. net_mock 改包 ----------
        show('net_mock 改包')
        payload = json.dumps({'mocked': True, 'by': 'browserpilot', 'items': [1, 2, 3]})
        bp.net.mock(page.id, [
            {'urlContains': 'example.com/api/demo', 'status': 200,
             'body': payload, 'headers': {'content-type': 'application/json'}},
        ])
        page.goto('https://example.com/api/demo')
        body = page.evaluate('document.body.innerText')
        print('页面拿到的响应体:', body.strip()[:80])
        assert 'mocked' in body, body
        bp.net.mock_off(page.id)
        print('改包已关闭')

        # ---------- 3. 多环境并行 ----------
        show('多环境并行（各自不同的时区）')
        env_b = bp.envs.create(f'showcase-b-{int(time.time()) % 10000}', 'showcase 环境 B')['env']
        created.append(env_b)
        env_c = bp.envs.create(f'showcase-c-{int(time.time()) % 10000}', 'showcase 环境 C')['env']
        created.append(env_c)

        def spoof(env_id: str, tz: str) -> str:
            p = bp.new_page(env=env_id)
            p.goto('data:text/html,<title>tz</title>')
            p.cdp('Emulation.setTimezoneOverride', {'timezoneId': tz})
            value = p.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone')
            p.close()
            return f'{env_id} -> {value}'

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda pair: spoof(pair[0], pair[1]),
                                    [(env_b, 'Europe/London'), (env_c, 'Asia/Tokyo')]))
        for line in results:
            print(' ', line)
        assert any('London' in line for line in results), results
        assert any('Tokyo' in line for line in results), results

        # ---------- 4. 工作流：录制 + 批量 ----------
        show('工作流录制与批量')
        name = f'showcase-flow-{int(time.time()) % 10000}'
        bp.workflow.record('start', name)
        page.goto('data:text/html,<title>recorded</title><p id=v>42</p>')
        page.evaluate("document.getElementById('v').textContent")
        bp.workflow.record('stop', name)
        saved = [w.get('name') for w in bp.workflow.list()]
        print('已保存的工作流:', saved)
        assert name in saved, saved

        one = bp.workflow.run(name)
        print('跑一遍:', {k: one.get(k) for k in ('ok', 'title', 'workflow') if k in one})
        assert one.get('ok') is True, one

        batch = bp.call('workflow_batch', {'workflow': name, 'rows': [{}, {}], 'concurrency': 2})
        ran = batch.get('runs') or batch.get('results') or []
        print('批量两行:', len(ran), '行，成功', sum(1 for item in ran if item.get('ok')))
        assert len(ran) == 2, batch

        print('\n全部演示通过')
        return 0
    finally:
        if name:
            try:
                bp.workflow.delete(name)
            except Exception:
                pass
        for env_id in created:
            try:
                bp.call('env_delete', {'env': env_id}, timeout=30)
            except Exception:
                pass
        bp.close()


if __name__ == '__main__':
    raise SystemExit(main())