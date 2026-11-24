"""并行加速比曲线：同一个窗口里开 N 个标签，比较串行与并发。

    python sdk/python/scripts/curve.py --mcp <mcp.json> [--sizes 4,8,16]

每档都会临时新建环境、跑完删掉。注意：先把 ``maxLiveTabs`` 调到不小于 N、
并把休眠关掉，否则串行阶段会因为休眠/重载而虚高（脚本会自动设置并恢复）。
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mcp', default=None)
    parser.add_argument('--sizes', default='4,8,16')
    args = parser.parse_args()

    sizes = [int(item) for item in args.sizes.split(',') if item.strip()]
    bp = connect(endpoint_of(Path(args.mcp)) if args.mcp else None)
    before = bp.settings.get()
    try:
        bp.settings.update(**{'maxLiveTabs': 20, 'tabHibernateMinutes': 0})
        print('tabs   serial_ms   parallel_ms   speedup', flush=True)
        for n in sizes:
            env = bp.envs.create(f'curve-{n}', 'curve 临时环境')['env']
            try:
                pages = [bp.new_page(env=env) for _ in range(n)]

                def work(page, tag):
                    url = 'data:text/html,<title>%s</title>' % tag + '<div>x</div>' * 20
                    page.call('page_navigate', {'url': url}, timeout=30)
                    page.snapshot()

                started = time.perf_counter()
                for index, page in enumerate(pages):
                    work(page, 's%d' % index)
                serial = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                with ThreadPoolExecutor(max_workers=n) as pool:
                    list(pool.map(lambda pair: work(pair[0], 'p%d' % pair[1]), list(zip(pages, range(n)))))
                parallel = (time.perf_counter() - started) * 1000

                print('%4d %11.0f %13.0f %9.2f' % (n, serial, parallel, serial / max(parallel, 1)), flush=True)
            finally:
                bp.call('env_delete', {'env': env}, timeout=30)
        return 0
    finally:
        bp.settings.update(**{'maxLiveTabs': before.get('maxLiveTabs', 4), 'tabHibernateMinutes': before.get('tabHibernateMinutes', 15)})
        bp.close()


if __name__ == '__main__':
    raise SystemExit(main())
