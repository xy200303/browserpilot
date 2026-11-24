"""SDK 的回归测试。

不启动真实的 App、不联网：起一个假的 MCP 端点（照着 src/main/services/McpService.ts
的行为抄：Bearer 鉴权、每请求独立、图片拆成第二个 content part、工具错误是 200 + ok:false），
然后断言 SDK 到底发出了哪些工具调用。
"""

import base64
import json
import os
import re
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import browserpilot.client as client_mod
import browserpilot.install as install_mod
from browserpilot import (
    InstallError,
    Locator,
    NotFoundError,
    Page,
    ToolError,
    Transport,
    TransportError,
    asset_for,
    connect,
    data_home,
    ensure_app,
    install_candidates,
    launch,
    locate_app,
    mcp_file,
    read_endpoint,
)
from browserpilot.install import AppLocation

# ---------------------------------------------------------------- 假 MCP 端点

PNG_BYTES = b'png-bytes'


def _default_handlers():
    """预置一批合理的返回值，让测试只关心「发了什么」。"""
    return {
        'tab_open': lambda args, calls: {'ok': True, 'tabId': 'tab-test', 'env': 'env-default'},
        'tab_list': lambda args, calls: {
            'ok': True,
            'tabs': [
                {
                    'id': 'tab-test',
                    'envId': 'env-default',
                    'url': 'https://example.com',
                    'title': 'Example',
                }
            ],
        },
        'env_list': lambda args, calls: {
            'ok': True,
            'envs': [
                {
                    'id': 'env-default',
                    'name': '默认',
                    'remark': '',
                    'windowOpen': True,
                    'headless': False,
                }
            ],
        },
        'page_navigate': lambda args, calls: {'ok': True, 'tabId': args.get('tabId'), 'url': args.get('url')},
        'page_click': lambda args, calls: {'ok': True, 'tabId': args.get('tabId'), 'control': 'agent'},
        'page_type': lambda args, calls: {'ok': True, 'tabId': args.get('tabId')},
        'page_key': lambda args, calls: {'ok': True, 'tabId': args.get('tabId')},
        'page_wait': lambda args, calls: {'ok': True, 'tabId': args.get('tabId'), 'state': args.get('state')},
        'page_query': lambda args, calls: {
            'ok': True,
            'total': 2,
            'matches': [{'index': 0, 'hittable': True}, {'index': 1, 'hittable': False}],
        },
        'page_inspect': lambda args, calls: {'ok': True, 'text': '按钮文字'},
        'page_source': lambda args, calls: {'ok': True, 'html': '<html></html>'},
        'page_script': lambda args, calls: {'ok': True, 'value': 42},
        'page_snapshot': lambda args, calls: {'ok': True, 'snapshot': 'button 登录'},
        'page_console': lambda args, calls: {'ok': True, 'messages': [{'level': 'error', 'message': 'boom'}]},
        'page_screenshot': lambda args, calls: {
            'ok': True,
            'width': 800,
            'height': 600,
            'path': '/tmp/a.jpg',
            'image': {'mimeType': 'image/png', 'data': base64.b64encode(PNG_BYTES).decode()},
        },
    }


class _FakeApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, token, handlers):
        super().__init__(address, _FakeApiHandler)
        self.token = token
        self.handlers = handlers
        self.calls = []
        self.events = []


class _FakeApiHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 别把每个请求都打到 stderr
        pass

    def _authorized(self):
        if self.headers.get('Authorization') == f'Bearer {self.server.token}':
            return True
        self._write(401, 'text/plain', b'unauthorized')
        return False

    def _write(self, status, content_type, body):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass  # 客户端已经走了，用例本身不受影响

    def _json(self, status, payload):
        self._write(status, 'application/json', json.dumps(payload, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        if not self._authorized():
            return
        if self.path.split('?')[0] == '/api/tools':
            self._json(200, {'version': '0.19.0', 'tools': [{'name': 'page_click'}]})
            return
        self._write(404, 'text/plain', b'')

    def do_POST(self):
        if not self._authorized():
            return
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            body = json.loads(raw or b'{}')
        except ValueError:
            self._json(400, {'ok': False, 'code': 'bad_request', 'error': 'body is not valid JSON'})
            return
        if not isinstance(body, dict):
            self._json(400, {'ok': False, 'code': 'bad_request', 'error': 'body must be an object'})
            return
        path = self.path.split('?')[0]

        if path == '/api/call':
            name = body.get('tool')
            args = dict(body.get('args') or {})
            if not isinstance(name, str) or not name:
                self._json(400, {'ok': False, 'code': 'bad_request', 'error': 'tool is required'})
                return
            # 和真服务端一致：先记录再处理，handler 里能看见自己这一次调用。
            self.server.calls.append({'name': name, 'args': args})
            handler = self.server.handlers.get(name)
            try:
                data = dict(handler(args, self.server.calls)) if handler else {'ok': True}
            except Exception as error:  # 工具失败也走 200 + ok:false
                data = {'ok': False, 'control': 'shared', 'error': str(error)}
            self._json(200, data)
            return

        if path == '/api/events':
            since = body.get('since')
            wait = min(float(body.get('wait') or 0) / 1000.0, 3.0)
            deadline = time.time() + wait
            while True:
                ready = [
                    event
                    for event in self.server.events
                    if not isinstance(since, (int, float)) or event['seq'] > since
                ]
                if ready:
                    self._json(
                        200,
                        {
                            'epoch': 'test',
                            'seq': ready[-1]['seq'],
                            'events': ready[: int(body.get('limit') or 200)],
                        },
                    )
                    return
                if time.time() >= deadline:
                    self._json(
                        200,
                        {'epoch': 'test', 'seq': since if isinstance(since, (int, float)) else 0, 'events': [], 'timeout': True},
                    )
                    return
                time.sleep(0.01)

        self._write(404, 'text/plain', b'')

    def do_PUT(self):
        self._write(405, 'text/plain', b'')


class _FakeServer:
    def __init__(self, handlers=None, token='test-token'):
        merged = _default_handlers()
        merged.update(handlers or {})
        self._httpd = _FakeApiServer(('127.0.0.1', 0), token, merged)
        self.calls = self._httpd.calls
        self.token = token
        port = self._httpd.server_address[1]
        self.url = f'http://127.0.0.1:{port}/mcp'
        self.api = f'http://127.0.0.1:{port}/api'
        self.endpoint = {'api': self.api, 'url': self.url, 'token': token}
        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            kwargs={'poll_interval': 0.01},
            daemon=True,
        )
        self._thread.start()

    def push_event(self, type_, payload=None):
        seq = (self._httpd.events[-1]['seq'] if self._httpd.events else 100) + 1
        self._httpd.events.append({'seq': seq, 'type': type_, 'at': 0, 'payload': payload or {}})
        return seq

    def close(self):
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=5)


# ---------------------------------------------------------------- 用例基类


class SdkTest(unittest.TestCase):
    def serve(self, **options):
        server = _FakeServer(**options)
        self.addCleanup(server.close)
        return server

    def page(self, server):
        return Page(Transport(server.endpoint), 'tab-test', 'env-default')

    def bp(self, server):
        client = launch(endpoint=server.endpoint)
        self.addCleanup(client.close)
        return client

    def names(self, server):
        return [call['name'] for call in server.calls]


# ---------------------------------------------------------------- 传输


class TransportTest(SdkTest):
    def test_call_carries_tab_id(self):
        server = self.serve()
        self.page(server).goto('https://example.com')
        self.assertEqual(
            server.calls,
            [{'name': 'page_navigate', 'args': {'tabId': 'tab-test', 'url': 'https://example.com'}}],
        )

    def test_events_long_poll(self):
        server = self.serve()
        transport = Transport(server.endpoint)
        server.push_event('page.console', {'message': 'hi'})
        result = transport.events(since=100, wait=0.5)
        self.assertEqual(len(result['events']), 1)
        self.assertEqual(result['events'][0]['type'], 'page.console')

        empty = transport.events(since=result['seq'], wait=0.12)
        self.assertEqual(empty['events'], [])
        self.assertTrue(empty['timeout'])

    def test_endpoint_without_api_is_install_error(self):
        path = Path(tempfile.mkdtemp()) / 'mcp.json'
        path.write_text(json.dumps({'url': 'http://127.0.0.1:1/mcp', 'token': 't'}), encoding='utf-8')
        with self.assertRaises(InstallError) as caught:
            read_endpoint(path)
        self.assertIn('/api', str(caught.exception))

    def test_tool_failure_is_tool_error_not_status_code(self):
        def boom(args, calls):
            raise RuntimeError('元素被遮住了')

        server = self.serve(handlers={'page_click': boom})
        with self.assertRaises(ToolError) as caught:
            self.page(server).click('#go')
        error = caught.exception
        self.assertEqual(error.tool, 'page_click')
        self.assertIn('遮住了', str(error))
        self.assertIs(error.payload.get('ok'), False)

    def test_tool_error_carries_screenshot(self):
        server = self.serve(
            handlers={
                'page_click': lambda args, calls: {
                    'ok': False,
                    'error': '元素不存在',
                    'errorShot': '/tmp/shot.png',
                }
            }
        )
        with self.assertRaises(ToolError) as caught:
            self.page(server).click('#go')
        self.assertEqual(caught.exception.screenshot, '/tmp/shot.png')
        self.assertEqual(caught.exception.payload['error'], '元素不存在')

    def test_wrong_token_is_transport_error(self):
        server = self.serve()
        transport = Transport({'url': server.url, 'api': server.api, 'token': 'wrong'})
        self.assertFalse(transport.ping())
        with self.assertRaises(TransportError):
            launch(endpoint={'url': server.url, 'api': server.api, 'token': 'wrong'})

    def test_closed_transport_refuses_calls(self):
        server = self.serve()
        transport = Transport(server.endpoint)
        transport.close()
        with self.assertRaises(TransportError):
            transport.call('page_click', {})


# ---------------------------------------------------------------- 动作映射


class ActionMappingTest(SdkTest):
    def test_click_mapping_order(self):
        server = self.serve()
        page = self.page(server)
        page.get_by_text('登录').click()
        page.get_by_role('button', name='登录').click()
        page.locator('#submit').click()
        page.get_by_role('button', name='登录').nth(2).click()

        args = [call['args'] for call in server.calls]
        self.assertEqual(args[0]['text'], '登录')
        self.assertNotIn('role', args[0])
        self.assertEqual((args[1]['role'], args[1]['name']), ('button', '登录'))
        self.assertEqual(args[2]['selector'], '#submit')
        self.assertEqual(args[3]['index'], 2)

    def test_click_carries_within_and_pierce(self):
        server = self.serve()
        self.page(server).locator('.item').within('.form').pierce().click()
        args = server.calls[0]['args']
        self.assertEqual(args['selector'], '.item')
        self.assertEqual(args['within'], '.form')
        self.assertIs(args['pierce'], True)

    def test_dblclick_is_count_two(self):
        server = self.serve()
        self.page(server).locator('#submit').dblclick()
        self.assertEqual(server.calls[0]['args']['count'], 2)

    def test_fill_injects_for_selector_and_overwrites_for_label(self):
        server = self.serve()
        page = self.page(server)

        page.fill('#name', '小明')
        # page_type 底层是 Input.insertText，inject 才是覆盖语义。
        self.assertEqual(
            server.calls[-1],
            {
                'name': 'page_type',
                'args': {'tabId': 'tab-test', 'selector': '#name', 'text': '小明', 'via': 'inject'},
            },
        )

        del server.calls[:]
        page.get_by_label('账号').fill('小明')
        self.assertEqual(self.names(server), ['page_type', 'page_key', 'page_type'])
        self.assertEqual(server.calls[0]['args']['text'], '')
        self.assertEqual(server.calls[0]['args']['label'], '账号')
        self.assertRegex(server.calls[1]['args']['shortcut'], r'\+A$')
        self.assertEqual(server.calls[2]['args']['entry'], 'paste')
        self.assertEqual(server.calls[2]['args']['text'], '小明')

    def test_fill_role_textbox_uses_name_as_label(self):
        server = self.serve()
        self.page(server).get_by_role('textbox', name='账号').fill('小明')
        self.assertEqual(self.names(server), ['page_type', 'page_key', 'page_type'])
        self.assertEqual(server.calls[0]['args']['label'], '账号')

    def test_type_appends_without_via(self):
        server = self.serve()
        self.page(server).get_by_label('账号').type('小明')
        self.assertEqual(len(server.calls), 1)
        self.assertEqual(server.calls[0]['name'], 'page_type')
        self.assertEqual(server.calls[0]['args']['label'], '账号')
        self.assertNotIn('via', server.calls[0]['args'])
        self.assertEqual(server.calls[0]['args']['text'], '小明')

    def test_select_scroll_and_navigation(self):
        server = self.serve()
        page = self.page(server)
        page.select('#city', '北京')
        page.scroll(direction='up', until='#footer')
        page.scroll_to('.target')
        page.press('Control+Enter')
        page.wait_for_load(7)

        calls = {call['name']: call['args'] for call in server.calls if call['name'] != 'page_scroll'}
        self.assertEqual(calls['page_select'], {'tabId': 'tab-test', 'selector': '#city', 'option': '北京'})
        self.assertEqual(calls['page_key'], {'tabId': 'tab-test', 'shortcut': 'Control+Enter'})
        self.assertEqual(calls['page_wait_load'], {'tabId': 'tab-test', 'timeout': 7})

        scrolls = [call['args'] for call in server.calls if call['name'] == 'page_scroll']
        self.assertEqual(scrolls[0], {'tabId': 'tab-test', 'direction': 'up', 'untilSelector': '#footer'})
        self.assertEqual(scrolls[1], {'tabId': 'tab-test', 'direction': 'down', 'untilSelector': '.target'})

    def test_select_rejects_non_selector_target(self):
        server = self.serve()
        with self.assertRaises(NotFoundError):
            self.page(server).select({'text': '城市'}, '北京')


# ---------------------------------------------------------------- 等待


class WaitTest(SdkTest):
    def test_wait_for_uses_native_page_wait(self):
        server = self.serve()
        page = self.page(server)
        page.wait_for('.done', state='appear', timeout=3)
        self.assertEqual(server.calls[0]['name'], 'page_wait')
        self.assertEqual(server.calls[0]['args']['selector'], '.done')
        self.assertEqual(server.calls[0]['args']['state'], 'appear')
        self.assertEqual(server.calls[0]['args']['timeout'], 3)

    def test_wait_for_role_polls_snapshot(self):
        server = self.serve()
        page = self.page(server)
        page.get_by_role('button', name='登录').wait_for()
        self.assertEqual(server.calls[0]['name'], 'page_snapshot')

    def test_wait_for_label_has_no_channel(self):
        server = self.serve()
        with self.assertRaises(NotFoundError):
            self.page(server).get_by_label('账号').wait_for()

    def test_wait_for_text_polls_then_clears_find(self):
        def page_find(args, calls):
            if args.get('stop'):
                return {'ok': True, 'stopped': True}
            seen = len([call for call in calls if call['name'] == 'page_find' and not call['args'].get('stop')])
            return {'ok': True, 'matches': 3 if seen > 1 else 0, 'active': 1 if seen > 1 else 0}

        server = self.serve(handlers={'page_find': page_find})
        self.page(server).wait_for_text('完成', timeout=5, poll=0.01)
        found = [call for call in server.calls if call['name'] == 'page_find']
        self.assertGreaterEqual(len(found), 3, f'应该至少查两次再收尾，实际 {len(found)}')
        self.assertIs(found[-1]['args'].get('stop'), True)

    def test_wait_for_text_timeout_still_clears_find(self):
        server = self.serve()
        with self.assertRaises(NotFoundError):
            self.page(server).wait_for_text('永远不会出现', timeout=0.05, poll=0.01)
        self.assertIs(server.calls[-1]['args'].get('stop'), True)

    def test_expect_text_is_alias(self):
        server = self.serve(
            handlers={'page_find': lambda args, calls: {'ok': True, 'matches': 0 if args.get('stop') else 1, 'active': 0}}
        )
        self.page(server).expect_text('完成')
        self.assertIs(server.calls[-1]['args'].get('stop'), True)


# ---------------------------------------------------------------- 读取与截图


class ReadTest(SdkTest):
    def test_screenshot_grid_off_and_bytes(self):
        server = self.serve()
        page = self.page(server)
        data = page.screenshot()
        self.assertIs(server.calls[0]['args']['grid'], False)
        self.assertEqual(data, PNG_BYTES)

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'a.png'
            page.screenshot(path=str(target))
            self.assertEqual(target.read_bytes(), PNG_BYTES)

    def test_screenshot_of_locator_passes_selector(self):
        server = self.serve()
        self.page(server).locator('#chart').screenshot()
        args = server.calls[0]['args']
        self.assertEqual(args['selector'], '#chart')
        self.assertIs(args['grid'], False)

    def test_count_is_visible_text_content_need_selector_or_xpath(self):
        server = self.serve()
        page = self.page(server)
        self.assertEqual(page.count('#item'), 2)
        self.assertIs(page.is_visible('#item'), True)
        self.assertEqual(page.text_content('#item'), '按钮文字')

        with self.assertRaises(NotFoundError):
            page.count({'text': '按钮'})
        with self.assertRaises(NotFoundError):
            page.is_visible(page.get_by_text('按钮'))
        with self.assertRaises(NotFoundError):
            page.text_content(page.get_by_role('button', name='登录'))

    def test_page_content_snapshot_evaluate_console(self):
        server = self.serve()
        page = self.page(server)
        self.assertEqual(page.content(), '<html></html>')
        self.assertEqual(page.snapshot(), 'button 登录')
        self.assertEqual(page.evaluate('1+1'), 42)
        self.assertEqual(page.console_logs(), [{'level': 'error', 'message': 'boom'}])
        self.assertEqual(page.console_logs(clear=True), [])

        calls = {call['name']: call['args'] for call in server.calls}
        self.assertEqual(calls['page_source'], {'tabId': 'tab-test', 'kind': 'dom'})
        self.assertEqual(calls['page_script'], {'tabId': 'tab-test', 'source': '1+1'})
        with self.assertRaises(TypeError):
            page.evaluate(lambda: 1)

    def test_url_and_title_come_from_tab_list(self):
        server = self.serve()
        page = self.page(server)
        self.assertEqual(page.url(), 'https://example.com')
        self.assertEqual(page.title(), 'Example')
        self.assertEqual(page.env, 'env-default')
        self.assertEqual(page.id, 'tab-test')

        gone = Page(Transport(server.endpoint), 'tab-gone', 'env-default')
        with self.assertRaises(NotFoundError):
            gone.url()

    def test_with_page_closes_tab(self):
        server = self.serve()
        with self.page(server) as page:
            page.goto('https://example.com')
        self.assertEqual(self.names(server)[-1], 'tab_close')


# ---------------------------------------------------------------- 客户端


class ClientTest(SdkTest):
    def test_launch_with_endpoint_never_spawns_or_closes_windows(self):
        server = self.serve()
        bp = launch(endpoint=server.endpoint)
        page = bp.new_page()
        self.assertEqual(page.id, 'tab-test')
        self.assertEqual(server.calls[0]['name'], 'tab_open')
        self.assertEqual(server.calls[0]['args'], {'env': 'env-default', 'url': ''})
        bp.close()
        # 不是自己启动的进程，close 不该关任何窗口
        self.assertFalse(any(name == 'env_close' for name in self.names(server)))

    def test_launch_connects_to_running_instance_without_spawning(self):
        server = self.serve()
        with mock.patch.object(client_mod, '_running_endpoint', return_value=server.endpoint):
            with mock.patch.object(client_mod, '_spawn', side_effect=AssertionError('不该拉起第二个进程')):
                bp = client_mod.launch()
        self.addCleanup(bp.close)
        self.assertEqual(bp.new_page().id, 'tab-test')
        bp.close()
        self.assertFalse(any(name == 'env_close' for name in self.names(server)))

    def test_connect_refuses_dead_endpoint(self):
        server = self.serve()
        bp = connect(server.endpoint)
        self.addCleanup(bp.close)
        # 连上不做任何工具调用
        self.assertEqual(server.calls, [])
        with self.assertRaises(TransportError):
            connect({'url': server.url, 'api': server.api, 'token': 'wrong'})

    def test_raw_call_passes_args_through(self):
        server = self.serve()
        bp = self.bp(server)
        bp.call('page_scroll', {'tabId': 'tab-test', 'direction': 'up'})
        self.assertEqual(
            server.calls[0],
            {'name': 'page_scroll', 'args': {'tabId': 'tab-test', 'direction': 'up'}},
        )

    def test_environments_and_pages(self):
        server = self.serve()
        bp = self.bp(server)
        self.assertEqual(bp.env_id, 'env-default')
        self.assertEqual(bp.sdk_version, install_mod.SDK_VERSION)
        self.assertIsNone(bp.app_version)

        self.assertEqual([env['id'] for env in bp.environments()], ['env-default'])
        self.assertEqual([page.id for page in bp.pages()], ['tab-test'])

        env = bp.environment('env-default')
        page = env.new_page(url='https://example.com')
        self.assertEqual(page.env, 'env-default')
        self.assertEqual(server.calls[-1]['args'], {'env': 'env-default', 'url': 'https://example.com'})
        self.assertEqual([item.id for item in env.pages()], ['tab-test'])

    def test_context_manager_closes(self):
        server = self.serve()
        with launch(endpoint=server.endpoint) as bp:
            bp.new_page()
        self.assertFalse(any(name == 'env_close' for name in self.names(server)))

    def test_strict_version_rejects_mismatch(self):
        located = AppLocation(exe=os.devnull, source='cache', version=install_mod.SDK_VERSION + '-mismatch')
        with mock.patch.object(client_mod, '_running_endpoint', return_value=None):
            with mock.patch.object(client_mod, 'locate_app', return_value=located):
                with mock.patch.object(client_mod, '_spawn', side_effect=AssertionError('不该拉起进程')):
                    with self.assertRaises(InstallError):
                        client_mod.launch(strict_version=True)
                    with mock.patch.dict(os.environ, {'BROWSERPILOT_STRICT_VERSION': '1'}):
                        with self.assertRaises(InstallError):
                            client_mod.launch()


# ---------------------------------------------------------------- 安装与路径


class InstallTest(SdkTest):
    def test_asset_matrix_only_has_three_real_platforms(self):
        self.assertEqual(asset_for('0.19.0', 'win32', 'x64').name, 'BrowserPilot-0.19.0-win.zip')
        self.assertEqual(asset_for('0.19.0', 'darwin', 'arm64').name, 'BrowserPilot-0.19.0-arm64-mac.zip')
        self.assertEqual(asset_for('0.19.0', 'linux', 'x64').name, 'BrowserPilot-0.19.0.AppImage')
        self.assertEqual(asset_for('0.19.0', 'linux', 'x64').kind, 'appimage')
        self.assertEqual(
            asset_for('0.19.0', 'darwin', 'arm64').exe,
            'BrowserPilot.app/Contents/MacOS/BrowserPilot',
        )

        for platform, arch in (('win32', 'arm64'), ('darwin', 'x64'), ('linux', 'arm64')):
            with self.assertRaises(InstallError):
                asset_for('0.19.0', platform, arch)

    def test_mcp_file_per_os(self):
        def norm(path):
            return path.replace('\\', '/')

        windows = norm(mcp_file('win32', {'APPDATA': 'C:/Users/me/AppData/Roaming'}))
        self.assertTrue(windows.startswith('C:/Users/me/AppData/Roaming'))
        self.assertTrue(windows.endswith('BrowserPilot/mcp.json'))
        self.assertIn(
            'Library/Application Support/BrowserPilot/mcp.json',
            norm(mcp_file('darwin', {})),
        )
        self.assertTrue(norm(mcp_file('linux', {'XDG_CONFIG_HOME': '/home/me/.config'})).startswith('/home/me/.config'))

    def test_install_candidates_per_os(self):
        windows = [path.replace('\\', '/') for path in install_candidates('win32', {'LOCALAPPDATA': 'C:/Local'})]
        self.assertTrue(any('Programs' in path for path in windows))
        self.assertTrue(any(path.startswith('/Applications') for path in install_candidates('darwin', {})))
        self.assertTrue(any(path.startswith('/opt') for path in install_candidates('linux', {})))

    def test_missing_broserpilot_exe_raises(self):
        missing = str(Path(tempfile.gettempdir()) / 'definitely-not-here-12345')
        with mock.patch.dict(os.environ, {'BROWSERPILOT_EXE': missing}):
            with self.assertRaises(InstallError) as caught:
                locate_app()
        self.assertIn(missing, str(caught.exception))

        with self.assertRaises(InstallError):
            locate_app(exe=missing)

    def test_offline_without_any_app_raises(self):
        with mock.patch.dict(os.environ, {'BROWSERPILOT_OFFLINE': '1'}):
            with mock.patch.object(install_mod, 'locate_app', return_value=None):
                with self.assertRaises(InstallError):
                    ensure_app()

    def test_data_home_honours_broserpilot_home(self):
        with mock.patch.dict(os.environ, {'BROWSERPILOT_HOME': str(Path(tempfile.gettempdir()) / 'bp-home')}):
            self.assertIn('bp-home', data_home())

    def test_zip_extraction_writes_into_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'app.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('BrowserPilot.exe', b'MZ')
                bundle.writestr('resources/app.asar', b'asar')
            target = Path(tmp) / 'out'
            target.mkdir()
            install_mod._extract_zip(archive, target)
            self.assertEqual((target / 'BrowserPilot.exe').read_bytes(), b'MZ')

    def test_zip_extraction_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('../escape.txt', b'x')
            target = Path(tmp) / 'out'
            target.mkdir()
            with self.assertRaises(InstallError):
                install_mod._extract_zip(archive, target)
            self.assertFalse((Path(tmp) / 'escape.txt').exists())


class LocatorTest(SdkTest):
    def test_chaining_builds_new_specs(self):
        server = self.serve()
        page = self.page(server)
        base = page.locator('.item')
        narrowed = base.nth(1).within('.list').pierce()
        self.assertEqual(base.spec.index, None)
        self.assertEqual((narrowed.spec.index, narrowed.spec.within, narrowed.spec.pierce), (1, '.list', True))
        self.assertIn('Locator(', str(narrowed))

        narrowed.click()
        args = server.calls[0]['args']
        self.assertEqual(
            (args['selector'], args['within'], args['index'], args['pierce']),
            ('.item', '.list', 1, True),
        )

    def test_locator_construction_accepts_dicts(self):
        server = self.serve()
        page = self.page(server)
        locator = Locator(page, {'text': '完成', 'textMatch': 'exact'})
        locator.click()
        self.assertEqual(server.calls[0]['args']['textMatch'], 'exact')


# ---------------------------------------------------------------- 事件监听


def wait_until(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError('等超时了')


class EventTest(SdkTest):
    def names(self, server):
        return [call['name'] for call in server.calls]

    def test_on_response_starts_capture_and_stops_after_off(self):
        server = self.serve()
        page = self.page(server)
        seen = []
        off = page.on('response', lambda event: seen.append(event.payload.get('url')))
        self.assertEqual(self.names(server).count('net_start'), 1)

        server.push_event('net.response', {'url': 'https://a.test/api', 'status': 200})
        wait_until(lambda: len(seen) == 1)
        self.assertEqual(seen[0], 'https://a.test/api')

        off()
        wait_until(lambda: 'net_stop' in self.names(server))
        server.push_event('net.response', {'url': 'https://a.test/late', 'status': 200})
        time.sleep(0.3)
        self.assertEqual(seen, ['https://a.test/api'], 'off() 之后不该再收到事件')

    def test_on_console_does_not_open_capture(self):
        server = self.serve()
        page = self.page(server)
        seen = []
        off = page.on('console', lambda event: seen.append(event.payload.get('message')))
        server.push_event('page.console', {'message': 'hello'})
        wait_until(lambda: len(seen) == 1)
        self.assertEqual(seen, ['hello'])
        off()
        self.assertNotIn('net_start', self.names(server))

    def test_wait_for_response_matches_url(self):
        server = self.serve()
        page = self.page(server)
        server.push_event('net.response', {'url': 'https://a.test/api/user', 'status': 201})
        record = page.wait_for_response('api/user', timeout=2)
        self.assertEqual(record.payload['status'], 201)
        self.assertIn('net_start', self.names(server))
        self.assertIn('net_stop', self.names(server))

    def test_wait_for_response_accepts_regex(self):
        server = self.serve()
        page = self.page(server)
        server.push_event('net.response', {'url': 'https://a.test/api/user/42'})
        record = page.wait_for_response(re.compile(r'/api/user/\d+'), timeout=2)
        self.assertTrue(record.payload['url'].endswith('/42'))

    def test_wait_for_response_times_out(self):
        server = self.serve()
        page = self.page(server)
        started = time.monotonic()
        with self.assertRaises(NotFoundError):
            page.wait_for_response('never', timeout=0.4)
        self.assertLess(time.monotonic() - started, 2.5, '超时释放太慢')
        self.assertIn('net_stop', self.names(server))

    def test_capture_is_reference_counted(self):
        server = self.serve()
        page = self.page(server)
        first = []
        second = []
        off_first = page.on('response', lambda event: first.append(event.payload.get('url')))
        off_second = page.on('response', lambda event: second.append(event.payload.get('url')))
        self.assertEqual(self.names(server).count('net_start'), 1)

        server.push_event('net.response', {'url': 'https://a.test/one'})
        wait_until(lambda: len(first) == 1 and len(second) == 1)

        off_first()
        time.sleep(0.3)
        self.assertNotIn('net_stop', self.names(server), '还有一路订阅，不该关抓包')

        server.push_event('net.response', {'url': 'https://a.test/two'})
        wait_until(lambda: len(second) == 2)

        off_second()
        wait_until(lambda: 'net_stop' in self.names(server))

    def test_unknown_event_is_rejected(self):
        server = self.serve()
        page = self.page(server)
        with self.assertRaises(ValueError):
            page.on('nope', lambda event: None)


if __name__ == '__main__':
    unittest.main()
