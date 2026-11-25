import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  Page,
  ToolError,
  Transport,
  TransportError,
  NotFoundError,
  assetFor,
  installCandidates,
  launch,
  locateApp,
  mcpFile,
  readEndpoint,
  InstallError
} from '../dist/index.js'
import { startFakeServer, defaults } from './fake-server.mjs'

async function withServer(options, run) {
  const server = await startFakeServer({ handlers: defaults, ...options })
  try {
    await run(server)
  } finally {
    await server.close()
  }
}

const transportOf = (server) => new Transport(server.endpoint)
const pageOf = (server) => new Page(transportOf(server), 'tab-test', 'env-default')

test('调用带上 tabId，并把载荷原样返回', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.goto('https://example.com')
    assert.equal(server.calls.length, 1)
    assert.deepEqual(server.calls[0], {
      name: 'page_navigate',
      args: { tabId: 'tab-test', url: 'https://example.com' }
    })
  })
})

test('长轮询拿到事件，没有事件时按超时返回', async () => {
  await withServer({}, async (server) => {
    const bp = await launch({ endpoint: server.endpoint })
    server.pushEvent({ type: 'page.console', payload: { message: 'hi' } })
    const result = await bp.transport.events({ since: 100, wait: 0.5 })
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].type, 'page.console')
    assert.equal(result.seq, result.events[0].seq)

    const empty = await bp.transport.events({ since: result.seq, wait: 0.12 })
    assert.equal(empty.events.length, 0)
    assert.equal(empty.timeout, true)
  })
})

test('工具失败抛 ToolError，而不是看 HTTP 状态', async () => {
  await withServer(
    {
      handlers: {
        ...defaults,
        page_click: () => {
          throw new Error('元素被遮住了')
        }
      }
    },
    async (server) => {
      const page = pageOf(server)
      await assert.rejects(
        () => page.click('#go'),
        (error) => {
          assert.ok(error instanceof ToolError, `期望 ToolError，收到 ${error.constructor.name}`)
          assert.equal(error.tool, 'page_click')
          assert.match(error.message, /遮住了/)
          return true
        }
      )
    }
  )
})

test('token 不对时是 TransportError', async () => {
  await withServer({}, async (server) => {
    const transport = new Transport({ url: server.url, api: server.api, token: 'wrong' })
    assert.equal(await transport.ping(), false)
    await assert.rejects(
      () => launch({ endpoint: { url: server.url, api: server.api, token: 'wrong' } }),
      TransportError
    )
  })
})

test('端点文件没有 api 字段时报明确错误，不回退', async () => {
  const file = join(tmpdir(), `bp-endpoint-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:1/mcp', token: 't' }))
  assert.throws(() => readEndpoint(file), (error) => {
    assert.ok(error instanceof InstallError)
    assert.match(error.message, /\/api/)
    return true
  })
  rmSync(file, { force: true })
})

test('点击按 text 优先，其次 role+name，再其次 selector', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.getByText('登录').click()
    await page.getByRole('button', { name: '登录' }).click()
    await page.locator('#submit').click()
    await page.getByRole('button', { name: '登录' }).nth(2).click()

    const args = server.calls.map((call) => call.args)
    assert.equal(args[0].text, '登录')
    assert.equal(args[1].role, 'button')
    assert.equal(args[1].name, '登录')
    assert.equal(args[2].selector, '#submit')
    assert.equal(args[3].index, 2)
  })
})

test('fill 对 selector 是一次 inject，对 label 是三步覆盖', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)

    await page.fill('#name', '小明')
    // page_type 底层是 Input.insertText，inject 才是覆盖语义。
    assert.deepEqual(server.calls.at(-1), {
      name: 'page_type',
      args: { tabId: 'tab-test', selector: '#name', text: '小明', via: 'inject' }
    })

    server.calls.length = 0
    await page.getByLabel('账号').fill('小明')
    assert.deepEqual(
      server.calls.map((call) => call.name),
      ['page_type', 'page_key', 'page_type']
    )
    assert.equal(server.calls[0].args.text, '')
    assert.match(server.calls[1].args.shortcut, /\+A$/)
    assert.equal(server.calls[2].args.entry, 'paste')
    assert.equal(server.calls[2].args.text, '小明')
  })
})

test('type 追加内容，不覆盖', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.getByLabel('账号').type('小明')
    assert.equal(server.calls.length, 1)
    assert.equal(server.calls[0].args.label, '账号')
    assert.equal(server.calls[0].args.via, undefined)
  })
})

test('waitFor 走原生 page_wait，role 走无障碍树轮询', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.waitFor('.done', { state: 'appear', timeout: 3 })
    assert.equal(server.calls[0].name, 'page_wait')
    assert.equal(server.calls[0].args.selector, '.done')
    assert.equal(server.calls[0].args.timeout, 3)

    server.calls.length = 0
    await page.getByRole('button', { name: '登录' }).waitFor()
    assert.equal(server.calls[0].name, 'page_snapshot')
  })
})

test('waitFor 碰到 label 这种没有通道的定位器会明确报错', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await assert.rejects(() => page.getByLabel('账号').waitFor(), NotFoundError)
  })
})

test('waitForText 轮询 page_find，结束时清掉高亮', async () => {
  await withServer(
    {
      handlers: {
        ...defaults,
        page_find: (args, calls) => {
          if (args.stop) return { ok: true, stopped: true }
          const seen = calls.filter((call) => call.name === 'page_find' && !call.args.stop).length
          return { ok: true, matches: seen > 1 ? 3 : 0, active: seen > 1 ? 1 : 0 }
        }
      }
    },
    async (server) => {
      const page = pageOf(server)
      await page.waitForText('完成', { timeout: 5, poll: 0.01 })
      const found = server.calls.filter((call) => call.name === 'page_find')
      assert.ok(found.length >= 3, `应该至少查了两次再收尾，实际 ${found.length}`)
      assert.equal(found.at(-1).args.stop, true)
    }
  )
})

test('截图默认带坐标网格，并返回图片字节', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const shots = () => server.calls.filter((call) => call.name === 'page_screenshot').map((call) => call.args)

    const buffer = await page.screenshot()
    assert.equal(shots()[0].grid, true)
    assert.equal(buffer.toString(), 'png-bytes')

    await page.screenshot({ grid: false })
    assert.equal(shots()[1].grid, false)

    await page.screenshot({ grid: 20 })
    assert.equal(shots()[2].grid, 20)

    const target = join(tmpdir(), `bp-shot-${Date.now()}.png`)
    await page.screenshot({ path: target })
    assert.equal(readFileSync(target).toString(), 'png-bytes')
    rmSync(target, { force: true })
  })
})

test('count / isVisible / textContent 只接受 selector 或 xpath', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    assert.equal(await page.count('#item'), 2)
    assert.equal(await page.isVisible('#item'), true)
    assert.equal(await page.textContent('#item'), '按钮文字')
    await assert.rejects(() => page.count({ text: '按钮' }), NotFoundError)
  })
})

test('launch 给端点就直接连，不探测也不启动', async () => {
  await withServer({}, async (server) => {
    const bp = await launch({ endpoint: server.endpoint })
    const page = await bp.newPage()
    assert.equal(page.id, 'tab-test')
    assert.equal(server.calls[0].name, 'tab_open')
    assert.equal(server.calls[0].args.url, '')
    await bp.close()
    // 不是自己启动的进程，close 不该关任何窗口
    assert.ok(!server.calls.some((call) => call.name === 'env_close'))
  })
})

test('原始工具入口不做任何加工', async () => {
  await withServer({}, async (server) => {
    const bp = await launch({ endpoint: server.endpoint })
    await bp.call('page_scroll', { tabId: 'tab-test', direction: 'up' })
    assert.deepEqual(server.calls[0], { name: 'page_scroll', args: { tabId: 'tab-test', direction: 'up' } })
  })
})

test('发布产物矩阵只承认真实存在的三个平台', () => {
  assert.equal(assetFor('0.19.0', 'win32', 'x64').name, 'BrowserPilot-0.19.0-win.zip')
  assert.equal(assetFor('0.19.0', 'darwin', 'arm64').name, 'BrowserPilot-0.19.0-arm64-mac.zip')
  assert.equal(assetFor('0.19.0', 'linux', 'x64').name, 'BrowserPilot-0.19.0.AppImage')
  assert.throws(() => assetFor('0.19.0', 'win32', 'arm64'), InstallError)
  assert.throws(() => assetFor('0.19.0', 'darwin', 'x64'), InstallError)
  assert.throws(() => assetFor('0.19.0', 'linux', 'arm64'), InstallError)
})

test('端点文件按系统放对位置', () => {
  // join 用的是宿主系统的分隔符，断言里统一归一化。
  const norm = (path) => path.replace(/\\/g, '/')
  assert.match(norm(mcpFile('win32', { APPDATA: 'C:/Users/me/AppData/Roaming' })), /BrowserPilot\/mcp\.json$/)
  assert.match(norm(mcpFile('darwin', {})), /Library\/Application Support\/BrowserPilot\/mcp\.json$/)
  assert.match(norm(mcpFile('linux', { XDG_CONFIG_HOME: '/home/me/.config' })), /^\/home\/me\/\.config/)
})

test('桌面版安装位置覆盖三个平台', () => {
  assert.ok(installCandidates('win32', { LOCALAPPDATA: 'C:\\Local' }).some((path) => path.includes('Programs')))
  assert.ok(installCandidates('darwin', {}).some((path) => path.startsWith('/Applications')))
  assert.ok(installCandidates('linux', {}).some((path) => path.startsWith('/opt')))
})

test('BROWSERPILOT_EXE 指向不存在的文件时给出明确错误', () => {
  const saved = process.env.BROWSERPILOT_EXE
  process.env.BROWSERPILOT_EXE = join(tmpdir(), 'definitely-not-here-12345')
  try {
    assert.throws(() => locateApp({}), InstallError)
  } finally {
    if (saved === undefined) delete process.env.BROWSERPILOT_EXE
    else process.env.BROWSERPILOT_EXE = saved
  }
})

const waitFor = async (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等超时了')
}

test('page.on(response) 自动开抓包，收到事件，off 后停止并关抓包', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const seen = []
    const off = await page.on('response', (event) => seen.push(event.payload.url))
    await waitFor(() => server.calls.some((call) => call.name === 'net_start'))

    server.pushEvent({ type: 'net.response', payload: { url: 'https://a.test/api', status: 200 } })
    await waitFor(() => seen.length === 1)
    assert.equal(seen[0], 'https://a.test/api')

    off()
    await waitFor(() => server.calls.some((call) => call.name === 'net_stop'))
    server.pushEvent({ type: 'net.response', payload: { url: 'https://a.test/late', status: 200 } })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(seen.length, 1, 'off() 之后不该再收到事件')
    assert.equal(server.calls.filter((call) => call.name === 'net_start').length, 1)
  })
})

test('page.on(console) 不需要抓包，也不会发 net_start', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const seen = []
    const off = await page.on('console', (event) => seen.push(event.payload.message))
    server.pushEvent({ type: 'page.console', payload: { message: 'hello' } })
    await waitFor(() => seen.length === 1)
    assert.equal(seen[0], 'hello')
    off()
    assert.ok(!server.calls.some((call) => call.name === 'net_start'))
  })
})

test('不认识的事件名会报错，不会退化成订阅全部事件', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await assert.rejects(() => page.on('respones', () => {}), /不认识的事件/)
    assert.equal(server.calls.length, 0)
  })
})

test('waitForResponse 命中 URL 返回事件，命中前抓包已经挂好', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    server.pushEvent({
      type: 'net.response',
      payload: { url: 'https://a.test/api/user', status: 201, mimeType: 'application/json' }
    })
    const record = await page.waitForResponse('api/user', { timeout: 2 })
    assert.equal(record.payload.status, 201)
    const names = server.calls.map((call) => call.name)
    assert.ok(names.indexOf('net_start') >= 0)
    assert.ok(names.indexOf('net_start') < names.indexOf('net_stop'))
  })
})

test('waitForResponse 超时抛 NotFoundError，不会一直等下去', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const started = Date.now()
    await assert.rejects(() => page.waitForResponse('never', { timeout: 0.4 }), NotFoundError)
    assert.ok(Date.now() - started < 2500, `超时释放太慢：${Date.now() - started}ms`)
    await waitFor(() => server.calls.some((call) => call.name === 'net_stop'))
  })
})

test('抓包按订阅计数：先取消一个不关，最后一个取消才关', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const first = []
    const second = []
    const offFirst = await page.on('response', (event) => first.push(event.payload.url))
    const offSecond = await page.on('response', (event) => second.push(event.payload.url))
    await waitFor(() => server.calls.filter((call) => call.name === 'net_start').length === 1)

    server.pushEvent({ type: 'net.response', payload: { url: 'https://a.test/one' } })
    await waitFor(() => first.length === 1 && second.length === 1)

    offFirst()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(server.calls.filter((call) => call.name === 'net_stop').length, 0, '还有一路订阅，不该关抓包')

    server.pushEvent({ type: 'net.response', payload: { url: 'https://a.test/two' } })
    await waitFor(() => second.length === 2)

    offSecond()
    await waitFor(() => server.calls.filter((call) => call.name === 'net_stop').length === 1)
  })
})

// ---------------------------------------------------------------- iframe

const FRAME_A = 'https://frame.example.com/login'
const FRAME_B = 'https://other.example.com/child'

const scriptValue = (value) => () => ({ ok: true, value })

test('frames() 列出主文档里的 iframe', async () => {
  await withServer(
    {
      handlers: {
        ...defaults,
        page_script: scriptValue([
          { src: FRAME_A, name: 'login', selector: 'iframe#login' },
          { src: FRAME_B, name: '', selector: 'iframe' }
        ])
      }
    },
    async (server) => {
      const frames = await pageOf(server).frames()
      assert.deepEqual(frames.map((frame) => frame.url), [FRAME_A, FRAME_B])
      assert.equal(frames[0].name, 'login')
      assert.equal(frames[0].selector, 'iframe#login')
    }
  )
})

test('frameLocator 解析 iframe 的 src，缺失时列出已有 frame', async () => {
  await withServer({ handlers: { ...defaults, page_script: scriptValue({ src: FRAME_A, name: 'login' }) } }, async (server) => {
    const frame = await pageOf(server).frameLocator('iframe#login')
    assert.equal(frame.url, FRAME_A)
    assert.equal(frame.selector, 'iframe#login')
  })

  await withServer(
    {
      handlers: {
        ...defaults,
        page_script: (args) =>
          String(args.source).includes("querySelectorAll('iframe')")
            ? { ok: true, value: [{ src: FRAME_A, name: 'login', selector: '#login' }] }
            : { ok: true, value: null }
      }
    },
    async (server) => {
      await assert.rejects(() => pageOf(server).frameLocator('iframe#nope'), (error) => {
        assert.ok(error instanceof NotFoundError)
        assert.match(error.message, /iframe/)
        assert.match(error.message, new RegExp(FRAME_A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        return true
      })
    }
  )
})

test('frame 里的点击和输入带上 frame 参数', async () => {
  await withServer({ handlers: { ...defaults, page_script: scriptValue({ src: FRAME_A, name: '' }) } }, async (server) => {
    const page = pageOf(server)
    const frame = await page.frameLocator('iframe#login')
    await frame.locator('#ok').click()
    assert.equal(server.calls.at(-1).name, 'page_click')
    assert.equal(server.calls.at(-1).args.frame, FRAME_A)
    assert.equal(server.calls.at(-1).args.selector, '#ok')

    await frame.locator('#user').fill('小明')
    assert.equal(server.calls.at(-1).name, 'page_type')
    assert.equal(server.calls.at(-1).args.frame, FRAME_A)
    assert.equal(server.calls.at(-1).args.via, 'inject')
  })
})

test('frame.count 在 frame 里跑 page_script', async () => {
  await withServer({ handlers: { ...defaults, page_script: scriptValue(3) } }, async (server) => {
    const frame = pageOf(server).frame(FRAME_A)
    assert.equal(await frame.count('#row'), 3)
    const call = server.calls.at(-1)
    assert.equal(call.name, 'page_script')
    assert.equal(call.args.frame, FRAME_A)
    assert.match(String(call.args.source), /querySelectorAll/)
  })
})

test('frame.waitFor 轮询到出现为止', async () => {
  let count = 0
  await withServer(
    {
      handlers: {
        ...defaults,
        page_script: () => {
          count += 1
          return { ok: true, value: count < 3 ? 0 : 1 }
        }
      }
    },
    async (server) => {
      await pageOf(server).frame(FRAME_A).waitFor('#ok', { timeout: 2, poll: 0.01 })
      assert.ok(count >= 3)
    }
  )
})

test('page.waitFor 遇到 frame 定位器不走 page_wait', async () => {
  await withServer({ handlers: { ...defaults, page_script: scriptValue(1) } }, async (server) => {
    const page = pageOf(server)
    await page.waitFor(page.frame(FRAME_A).locator('#ok'), { timeout: 1, poll: 0.01 })
    assert.equal(server.calls.filter((call) => call.name === 'page_wait').length, 0)
  })
})

test('waitForFunction 轮询并返回真值，超时报 NotFoundError', async () => {
  let step = 0
  await withServer(
    {
      handlers: {
        ...defaults,
        page_script: () => {
          step += 1
          return { ok: true, value: step < 3 ? false : 'ready' }
        }
      }
    },
    async (server) => {
      assert.equal(await pageOf(server).waitForFunction('document.title', { timeout: 2, poll: 0.01 }), 'ready')
      const source = String(server.calls.at(-1).args.source)
      assert.match(source, /document\.title/)
      assert.match(source, /typeof value === 'function'/)
    }
  )

  await withServer({ handlers: { ...defaults, page_script: scriptValue(false) } }, async (server) => {
    await assert.rejects(() => pageOf(server).waitForFunction('false', { timeout: 0.05, poll: 0.01 }), NotFoundError)
  })
})

test('点击失败时解释「元素在 iframe 里」', async () => {
  await withServer(
    {
      handlers: {
        page_script: (args) =>
          String(args.source).includes("querySelectorAll('iframe')")
            ? { ok: true, value: [{ src: FRAME_A, name: 'login', selector: 'iframe#login' }] }
            : { ok: true, value: 1 },
        page_click: () => {
          throw new Error('DOM Error while querying')
        }
      }
    },
    async (server) => {
      await assert.rejects(() => pageOf(server).click('#submit'), (error) => {
        assert.ok(error instanceof ToolError)
        assert.match(error.message, /DOM Error while querying/)
        assert.match(error.message, /iframe/)
        assert.match(error.message, /frameLocator/)
        return true
      })
    }
  )
})

test('frame 里的元素截图直接报错，不静默截主文档', async () => {
  await withServer(
    { handlers: { ...defaults, page_script: scriptValue({ src: FRAME_A, name: '' }) } },
    async (server) => {
      const page = pageOf(server)
      const frame = await page.frameLocator('iframe#login')
      await assert.rejects(
        () => page.screenshot({ target: frame.locator('#chart') }),
        (error) => {
          assert.ok(error instanceof NotFoundError)
          assert.match(error.message, /frame 里的元素截图/)
          return true
        }
      )
    }
  )
})

// ---------------------------------------------------------------- tab 与 cookie

test('bp.tab(id) 把定位器绑到指定标签', async () => {
  await withServer({}, async (server) => {
    const bp = await launch({ endpoint: server.endpoint })
    const page = await bp.tab('tab-test')
    await page.locator('#a').click()
    const call = server.calls.at(-1)
    assert.equal(call.name, 'page_click')
    assert.equal(call.args.tabId, 'tab-test')
  })
})

test('bp.tab(id) 不存在时列出已有 id', async () => {
  await withServer({}, async (server) => {
    const bp = await launch({ endpoint: server.endpoint })
    await assert.rejects(() => bp.tab('tab-missing'), (error) => {
      assert.ok(error instanceof NotFoundError)
      assert.match(error.message, /tab-test/)
      return true
    })
  })
})

test('cookie 导出与导入', async () => {
  await withServer(
    {
      handlers: {
        ...defaults,
        cookie_list: () => ({
          ok: true,
          cookies: [{ name: 'sid', value: 'abc', domain: '.example.com', path: '/', session: true }]
        })
      }
    },
    async (server) => {
      const bp = await launch({ endpoint: server.endpoint })
      const items = await bp.cookies({ env: 'env-default' })
      assert.equal(items[0].name, 'sid')

      assert.equal(await bp.addCookies(items[0], { env: 'env-default' }), 1)
      const setCall = server.calls.at(-1)
      assert.equal(setCall.name, 'cookie_set')
      assert.equal(setCall.args.name, 'sid')
      assert.equal(setCall.args.env, 'env-default')
      assert.equal('session' in setCall.args, false)

      await bp.clearCookies({ name: 'sid', env: 'env-default' })
      assert.deepEqual(server.calls.at(-1), {
        name: 'cookie_remove',
        args: { name: 'sid', domain: '.example.com', env: 'env-default' }
      })
    }
  )
})

test('page.cookies 绑定本环境的 env，不带 tabId', async () => {
  await withServer({ handlers: { ...defaults, cookie_list: () => ({ ok: true, cookies: [] }) } }, async (server) => {
    await pageOf(server).cookies()
    const call = server.calls.at(-1)
    assert.equal(call.name, 'cookie_list')
    assert.deepEqual(call.args, { env: 'env-default' })
  })
})

// ---------------------------------------------------------------- 弹窗、上传、遮罩、查找、监听

test('弹窗：列表、接受、关闭', async () => {
  let dialogs = [{ type: 'alert' }]
  await withServer(
    {
      handlers: {
        ...defaults,
        page_dialog: (args) => {
          if (args.action === 'list') return { ok: true, dialogs }
          dialogs = []
          return { ok: true, action: args.action }
        }
      }
    },
    async (server) => {
      const page = pageOf(server)
      assert.deepEqual(await page.dialogs(), [{ type: 'alert' }])
      assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', action: 'list' })

      await page.acceptDialog({ once: true, promptText: '确认删除' })
      assert.deepEqual(server.calls.at(-1).args, {
        tabId: 'tab-test',
        action: 'accept',
        once: true,
        promptText: '确认删除'
      })

      await page.dismissDialog()
      assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', action: 'dismiss' })
    }
  )
})

test('上传：paths 和 file input 定位一起传', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.upload(['a.pdf', 'b.png'], page.locator('#file'))
    assert.equal(server.calls.at(-1).name, 'page_upload')
    assert.deepEqual(server.calls.at(-1).args, {
      tabId: 'tab-test',
      paths: ['a.pdf', 'b.png'],
      selector: '#file'
    })

    await page.upload('c.txt')
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', paths: ['c.txt'] })
  })
})

test('遮罩：list 和 dismiss', async () => {
  await withServer(
    { handlers: { ...defaults, page_overlay: () => ({ ok: true, overlays: [{ kind: 'ad' }] }) } },
    async (server) => {
      const page = pageOf(server)
      assert.deepEqual(await page.overlays(), [{ kind: 'ad' }])
      await page.dismissOverlays()
      assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', action: 'dismiss' })
    }
  )
})

test('查找与停止', async () => {
  await withServer({ handlers: { ...defaults, page_find: () => ({ ok: true, matches: 3 }) } }, async (server) => {
    const page = pageOf(server)
    assert.equal((await page.find('订单')).matches, 3)
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', text: '订单', forward: true })

    await page.find('订单', { findNext: true })
    assert.equal(server.calls.at(-1).args.findNext, true)

    await page.findStop()
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', stop: true })
  })
})

test('识别元素：按定位器和按坐标', async () => {
  await withServer({ handlers: { ...defaults, page_inspect: () => ({ ok: true, type: 'button' }) } }, async (server) => {
    const page = pageOf(server)
    assert.equal((await page.inspect({ target: page.locator('#go') })).type, 'button')
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', selector: '#go' })

    await page.inspect({ x: 120.5, y: 64 })
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', x: 120.5, y: 64 })
  })
})

test('监听元素变化：带 timeout 和 interval，文本定位器不支持', async () => {
  await withServer({ handlers: { ...defaults, page_watch: () => ({ ok: true, changed: false }) } }, async (server) => {
    const page = pageOf(server)
    await page.watch('#price', { timeout: 12, interval: 0.2 })
    assert.deepEqual(server.calls.at(-1).args, {
      tabId: 'tab-test',
      selector: '#price',
      timeout: 12,
      interval: 0.2
    })
    await assert.rejects(() => page.watch(page.getByText('价格')), NotFoundError)
  })
})

test('handoff 空 message 也要发字段；upload/watch/inspect 的非法目标直接报错', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.handoff()
    assert.deepEqual(server.calls.at(-1).args, { tabId: 'tab-test', message: '' })

    await assert.rejects(() => page.upload('a.txt', page.getByText('附件')), NotFoundError)
    await assert.rejects(
      () => page.upload('a.txt', page.frame('https://f.test/x').locator('#file')),
      NotFoundError
    )
    await assert.rejects(() => page.watch(page.frame('https://f.test/x').locator('#price')), NotFoundError)
    await assert.rejects(() => page.inspect(), NotFoundError)
  })
})

test('人工交接：lock / unlock / handoff', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    await page.lock()
    assert.deepEqual(server.calls.at(-1), { name: 'page_lock', args: { tabId: 'tab-test' } })
    await page.unlock()
    assert.deepEqual(server.calls.at(-1), { name: 'page_unlock', args: { tabId: 'tab-test' } })
    await page.handoff('该输验证码了')
    assert.deepEqual(server.calls.at(-1), { name: 'page_handoff', args: { tabId: 'tab-test', message: '该输验证码了' } })
  })
})

// ---------------------------------------------------------------- 会话、剪贴板、权限

test('会话保存 / 恢复 / 清空', async () => {
  await withServer(
    { handlers: { ...defaults, session_list: () => ({ ok: true, sessions: [{ id: 's1' }] }) } },
    async (server) => {
      const bp = await launch({ endpoint: server.endpoint })
      assert.deepEqual(await bp.sessions.list('env-default'), [{ id: 's1' }])
      await bp.sessions.save('env-default')
      assert.deepEqual(server.calls.at(-1), { name: 'session_save', args: { env: 'env-default' } })
      await bp.sessions.restore('env-default')
      assert.deepEqual(server.calls.at(-1), { name: 'session_restore', args: { env: 'env-default' } })
      await bp.sessions.clear('env-default')
      assert.deepEqual(server.calls.at(-1), { name: 'session_clear', args: { env: 'env-default' } })
    }
  )
})

test('剪贴板读写', async () => {
  await withServer(
    { handlers: { ...defaults, clipboard_read: () => ({ ok: true, text: '剪贴板内容' }) } },
    async (server) => {
      const bp = await launch({ endpoint: server.endpoint })
      assert.equal(await bp.clipboardRead(), '剪贴板内容')
      await bp.clipboardWrite('新内容')
      assert.deepEqual(server.calls.at(-1), { name: 'clipboard_write', args: { text: '新内容' } })
    }
  )
})

test('权限与已保存登录', async () => {
  await withServer(
    {
      handlers: {
        ...defaults,
        permission_list: () => ({ ok: true, permissions: [{ name: 'camera' }] }),
        password_list: () => ({ ok: true, passwords: [{ site: 'example.com' }] })
      }
    },
    async (server) => {
      const bp = await launch({ endpoint: server.endpoint })
      assert.deepEqual(await bp.permissions('env-default'), [{ name: 'camera' }])
      assert.deepEqual(server.calls.at(-1).args, { env: 'env-default' })
      assert.deepEqual(await bp.passwords('env-default'), [{ site: 'example.com' }])
      assert.deepEqual(server.calls.at(-1).args, { env: 'env-default' })
    }
  )
})
