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

test('截图默认关掉坐标网格，并返回图片字节', async () => {
  await withServer({}, async (server) => {
    const page = pageOf(server)
    const buffer = await page.screenshot()
    assert.equal(server.calls[0].args.grid, false)
    assert.equal(buffer.toString(), 'png-bytes')

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
