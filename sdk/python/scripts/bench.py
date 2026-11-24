"""高性能 / 高并发基准，用 Python SDK 跑。

用法：
    python sdk/python/scripts/bench.py                       # 读系统默认 mcp.json
    python sdk/python/scripts/bench.py --mcp <mcp.json>      # 指定端点（比如开发版）
    python sdk/python/scripts/bench.py --tabs 16 --rounds 5

会新建一套临时环境、跑完删掉；不碰你正在用的环境。
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
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


def stats(values):
    if not values:
        return (0.0, 0.0, 0.0)
    ordered = sorted(values)
    return (
        round(statistics.mean(ordered), 1),
        round(ordered[int(len(ordered) * 0.5)], 1),
        round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))], 1),
    )


def line(name: str, detail: str) -> None:
    print(f'{name:<34} {detail}')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mcp', default=None, help='mcp.json 路径')
    parser.add_argument('--tabs', type=int, default=8, help='并发标签数')
    parser.add_argument('--rounds', type=int, default=3, help='每项重复轮数')
    args = parser.parse_args()

    path = Path(args.mcp) if args.mcp else None
    bp = connect(endpoint_of(path) if path else None)
    created = bp.envs.create(f'基准 {int(time.time()) % 10000}', '性能测试，跑完删除')
    env = created['env']
    page_html = 'data:text/html,' + (
        '<title>基准页</title>'
        + '<div class="row">一行</div>' * 200
        + '<input id="v" value="1">'
    )

    try:
        # 1. 纯工具调用吞吐
        bp.settings.get()
        started = time.perf_counter()
        for _ in range(200):
            bp.settings.get()
        elapsed = time.perf_counter() - started
        line('工具调用吞吐', f'200 次 settings_get，{elapsed * 1000:.0f}ms，{200 / elapsed:.0f} ops/s')

        # 2. 导航 + 读取
        page = bp.new_page(env=env)
        timings = []
        for _ in range(args.rounds):
            started = time.perf_counter()
            page.goto(page_html)
            page.title()
            page.count('div')
            timings.append((time.perf_counter() - started) * 1000)
        mean, p50, p95 = stats(timings)
        line('导航+标题+计数', f'{mean}ms 平均，p50 {p50}ms，p95 {p95}ms')

        # 3. 无障碍树 / DOM
        started = time.perf_counter()
        for _ in range(args.rounds):
            page.snapshot()
        snap_ms = (time.perf_counter() - started) / args.rounds * 1000
        started = time.perf_counter()
        for _ in range(args.rounds):
            page.content()
        content_ms = (time.perf_counter() - started) / args.rounds * 1000
        line('无障碍树 / DOM', f'snapshot {snap_ms:.0f}ms，content {content_ms:.0f}ms')

        # 4. 截图吞吐
        started = time.perf_counter()
        shots = [page.screenshot() for _ in range(5)]
        shot_ms = (time.perf_counter() - started) / 5 * 1000
        line('截图', f'{shot_ms:.0f}ms 一张，{len(shots[0]) / 1024:.0f}KB')

        # 5. 批量 CDP vs 逐条
        started = time.perf_counter()
        for _ in range(50):
            page.cdp('Runtime.evaluate', {'expression': '1+1'})
        single_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        page.cdp_batch([{'method': 'Runtime.evaluate', 'params': {'expression': '1+1'}}] * 50)
        batch_ms = (time.perf_counter() - started) * 1000
        line('CDP 50 条：逐条 vs 批量', f'{single_ms:.0f}ms → {batch_ms:.0f}ms（{single_ms / max(batch_ms, 1):.1f}x）')

        # 6. 事件延迟：导航后多久收到 tab.navigation
        before = bp.call('env_list')
        page.goto('data:text/html,<title>事件</title>')
        started = time.perf_counter()
        result = bp.transport.events(since=before.get('seq'), wait=5)
        latency = (time.perf_counter() - started) * 1000
        types = {event.get('type') for event in result.get('events') or []}
        line('事件延迟（导航后）', f'{latency:.0f}ms，{len(result.get("events") or [])} 条：{", ".join(sorted(types))[:60]}')

        # 7. 并行标签：串行 vs 并发
        pages = [bp.new_page(env=env) for _ in range(args.tabs)]

        def work(target):
            target.goto(page_html)
            target.snapshot()
            return target.count('div')

        started = time.perf_counter()
        for target in pages:
            work(target)
        serial = time.perf_counter() - started

        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.tabs) as pool:
            list(pool.map(work, pages))
        parallel = time.perf_counter() - started
        line(
            f'{args.tabs} 个标签 串行 vs 并发',
            f'{serial * 1000:.0f}ms → {parallel * 1000:.0f}ms（{serial / max(parallel, 0.001):.1f}x）',
        )

        for target in pages:
            target.close()
        page.close()
        line('结果', '全部通过')
        return 0
    finally:
        bp.call('env_delete', {'env': env})
        bp.close()


if __name__ == '__main__':
    raise SystemExit(main())
