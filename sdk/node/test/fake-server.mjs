// 一个假的程序面端点，用来验证 SDK 发出的工具调用。
// 协议照着 src/main/services/McpService.ts 的 /api/* 抄：
// Bearer 鉴权、`{tool, args}` 进、工具载荷直接出、图片放同级 `image` 字段。
import { createServer } from 'node:http'

export function startFakeServer(options = {}) {
  const token = options.token ?? 'test-token'
  const calls = []
  const handlers = options.handlers ?? {}
  const queue = []

  const readBody = (req) =>
    new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : undefined)
        } catch {
          resolve(undefined)
        }
      })
    })

  const json = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401)
      res.end('unauthorized')
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/api/tools' && req.method === 'GET') {
      json(res, 200, { version: '0.19.0', tools: [{ name: 'page_click', description: 'click', inputSchema: {} }] })
      return
    }

    if (url.pathname === '/api/call' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body || typeof body.tool !== 'string') {
        json(res, 400, { ok: false, code: 'bad_request', error: 'tool is required' })
        return
      }
      calls.push({ name: body.tool, args: body.args ?? {} })
      let data
      try {
        data = handlers[body.tool] ? handlers[body.tool](body.args ?? {}, calls) : { ok: true }
      } catch (error) {
        data = { ok: false, control: 'shared', error: error.message }
      }
      json(res, 200, data)
      return
    }

    if (url.pathname === '/api/events' && req.method === 'POST') {
      const body = (await readBody(req)) ?? {}
      const wait = Number(body.wait ?? 0)
      const deadline = Date.now() + Math.min(wait, 3000)
      // 有就往出给，没有就挂到超时（上限 3 秒，测试不用等太久）
      for (;;) {
        const since = Number(body.since)
        const ready = queue.filter((event) => !Number.isFinite(since) || event.seq > since)
        if (ready.length) {
          json(res, 200, {
            epoch: 'test',
            seq: ready[ready.length - 1].seq,
            events: ready.slice(0, Number(body.limit ?? 200))
          })
          return
        }
        if (Date.now() >= deadline) {
          json(res, 200, { epoch: 'test', seq: Number.isFinite(since) ? since : 0, events: [], timeout: true })
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const base = `http://127.0.0.1:${port}`
      resolve({
        url: `${base}/mcp`,
        api: `${base}/api`,
        token,
        calls,
        /** 往事件队列里塞一条，供 /api/events 取 */
        pushEvent: (event) => {
          const seq = (queue.length ? queue[queue.length - 1].seq : 100) + 1
          queue.push({ seq, at: Date.now(), type: 'test', payload: {}, ...event, seq: event?.seq ?? seq })
        },
        endpoint: { url: `${base}/mcp`, api: `${base}/api`, token },
        close: () => new Promise((done) => server.close(done))
      })
    })
  })
}

/** 预置一批合理的返回值，让测试只关心「发了什么」。 */
export const defaults = {
  tab_open: () => ({ ok: true, tabId: 'tab-test', env: 'env-default' }),
  tab_list: () => ({ ok: true, tabs: [{ id: 'tab-test', envId: 'env-default', url: 'https://example.com', title: 'Example' }] }),
  page_navigate: (args) => ({ ok: true, tabId: args.tabId, url: args.url }),
  page_click: (args) => ({ ok: true, tabId: args.tabId, control: 'agent' }),
  page_type: (args) => ({ ok: true, tabId: args.tabId }),
  page_key: (args) => ({ ok: true, tabId: args.tabId }),
  page_wait: (args) => ({ ok: true, tabId: args.tabId, state: args.state ?? 'appear' }),
  page_query: () => ({ ok: true, total: 2, matches: [{ index: 0, hittable: true }, { index: 1, hittable: false }] }),
  page_inspect: () => ({ ok: true, text: '按钮文字' }),
  page_source: () => ({ ok: true, html: '<html></html>' }),
  page_script: () => ({ ok: true, value: 42 }),
  page_snapshot: () => ({ ok: true, snapshot: 'button 登录' }),
  page_console: () => ({ ok: true, messages: [{ level: 'error', message: 'boom' }] }),
  page_screenshot: () => ({ ok: true, width: 800, height: 600, path: '/tmp/a.jpg', image: { mimeType: 'image/png', data: Buffer.from('png-bytes').toString('base64') } })
}
