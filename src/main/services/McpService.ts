import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import { chmodSync, readFileSync, existsSync } from 'fs'
import { writeJsonAtomic } from './json-file'
import { join } from 'path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { storage } from './store'
import { advertisedToolMeta, callTool, listToolMeta } from './tool-catalog'
import { waitEvents } from './events'

let httpServer: ReturnType<typeof createServer> | null = null
let token = randomBytes(24).toString('hex')

function endpointFile(): string {
  return join(storage.userData(), 'mcp.json')
}

export function mcpConnectInfo(): { url: string; api: string; token: string; file: string; port: number } {
  const file = endpointFile()
  let url = `http://127.0.0.1:${storage.settings.port}/mcp`
  let api = `http://127.0.0.1:${storage.settings.port}/api`
  let current = token
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { url?: string; api?: string; token?: string }
    if (saved.url) url = saved.url
    if (saved.api) api = saved.api
    if (saved.token) current = saved.token
  } catch {
    /* 还没起过服务，用内存里的 */
  }
  return { url, api, token: current, file, port: storage.settings.port }
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function buildMcp(): Server {
  const server = new Server({ name: 'browserpilot', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: advertisedToolMeta(storage.settings.toolMode) }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(request.params.name, request.params.arguments)
    const { image, ...rest } = result as typeof result & {
      image?: { mimeType?: string; data?: string }
    }
    const content: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [{ type: 'text', text: JSON.stringify(rest) }]
    if (image?.data && image.mimeType) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
    }
    return { content }
  })
  return server
}

export async function startMcp(): Promise<void> {
  await stopMcp()
  if (!storage.settings.mcpEnabled) return
  const existing = existsSync(endpointFile()) ? JSON.parse(readFileSync(endpointFile(), 'utf8')) as { token?: string } : {}
  if (existing.token) token = existing.token
  const port = storage.settings.port
  httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject)
    httpServer!.listen(port, '127.0.0.1', () => resolve())
  })
  writeJsonAtomic(endpointFile(), {
    url: `http://127.0.0.1:${port}/mcp`,
    api: `http://127.0.0.1:${port}/api`,
    token
  })
  if (process.platform !== 'win32') {
    try {
      chmodSync(endpointFile(), 0o600)
    } catch {
      /* 文件系统不支持权限时忽略 */
    }
  }
}

export async function stopMcp(): Promise<void> {
  if (!httpServer) return
  await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  httpServer = null
}

/** 程序面路径前缀。Agent 走 `/mcp`，CLI 和三个 SDK 走 `/api/*`。 */
const API_PREFIX = '/api'

/**
 * MCP 规范要求校验 Origin 防 DNS rebinding。
 * 命令行/SDK 不带头，浏览器和恶意网页会带——所以：没带头放行，带了就只认本机来源。
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  if (origin === 'file://') return true
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)
}

function reply(res: ServerResponse, status: number, payload?: unknown): void {
  if (payload === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (!originAllowed(req.headers.origin)) {
    reply(res, 403)
    return
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401)
    res.end('unauthorized')
    return
  }

  if (url.pathname === '/mcp') return handleMcp(req, res)
  if (url.pathname === `${API_PREFIX}/tools`) return handleApiTools(req, res)
  if (url.pathname === `${API_PREFIX}/call`) return handleApiCall(req, res)
  if (url.pathname === `${API_PREFIX}/events`) return handleApiEvents(req, res)

  reply(res, 404)
}

/** MCP 端点只接 POST。GET/DELETE 一律 405：不提供 SSE 流，也别让客户端把它当流解析。 */
/**
 * 我们实现的协议版本（都是 legacy 时代，靠 initialize 握手）。
 * 2026-07-28 要求 `server/discover` 和 `subscriptions/listen`，还没实现，
 * 所以它出现在列表外——现代客户端会收到 -32022，然后按 supported 退回 2025-11-25。
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-10-07', '2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']

/** 认得的方法。表外的走 404 + -32601，而不是 200 里塞一个错误。 */
const KNOWN_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress'
])

type EnvelopeIssue = { status: number; payload: unknown }

function rpcError(id: unknown, code: number, message: string, data?: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function firstId(body: unknown): unknown {
  const messages = Array.isArray(body) ? body : [body]
  for (const raw of messages) {
    const id = (raw as { id?: unknown } | null)?.id
    if (id !== undefined) return id
  }
  return null
}

/**
 * 2026-07-28 的请求头约定，外加"未知方法返回 404"。
 * 三个头都是可选的：legacy 客户端一个都不发，不能因此拒绝它们。
 */
function envelopeIssue(req: IncomingMessage, body: unknown): EnvelopeIssue | undefined {
  const version = headerOf(req, 'mcp-protocol-version')
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return {
      status: 400,
      payload: rpcError(firstId(body), -32022, 'Unsupported protocol version', {
        supported: SUPPORTED_PROTOCOL_VERSIONS,
        requested: version
      })
    }
  }
  const declaredMethod = headerOf(req, 'mcp-method')
  const declaredName = headerOf(req, 'mcp-name')
  const messages = Array.isArray(body) ? body : [body]
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const message = raw as { id?: unknown; method?: unknown; params?: { name?: unknown } }
    const id = message.id ?? null
    if (declaredMethod && typeof message.method === 'string' && declaredMethod !== message.method) {
      return {
        status: 400,
        payload: rpcError(id, -32020, 'Header mismatch: Mcp-Method does not match the body', {
          header: declaredMethod,
          body: message.method
        })
      }
    }
    if (declaredName && message.params && typeof message.params.name === 'string' && declaredName !== message.params.name) {
      return {
        status: 400,
        payload: rpcError(id, -32020, 'Header mismatch: Mcp-Name does not match the body', {
          header: declaredName,
          body: message.params.name
        })
      }
    }
    if (typeof message.method === 'string' && !KNOWN_METHODS.has(message.method)) {
      return { status: 404, payload: rpcError(id, -32601, `Method not found: ${message.method}`) }
    }
  }
  return undefined
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' })
    res.end()
    return
  }
  const body = await readBody(req)
  const issue = envelopeIssue(req, body)
  if (issue) {
    reply(res, issue.status, issue.payload)
    return
  }
  const server = buildMcp()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

/**
 * 长轮询取事件：有就立刻返回，没有就挂到 `wait` 毫秒（默认 25 秒，上限 25 秒）。
 * `seq` 是客户端的位置；不传表示只看新事件。
 */
async function handleApiEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' })
    res.end()
    return
  }
  let body: unknown
  try {
    body = await readBody(req)
  } catch {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'body is not valid JSON' })
    return
  }
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'body must be an object' })
    return
  }
  const input = (body ?? {}) as {
    since?: unknown
    wait?: unknown
    limit?: unknown
    types?: unknown
    env?: unknown
    tabId?: unknown
  }
  const since = Number(input.since)
  const limit = Number(input.limit)
  const wait = Number(input.wait)
  const result = await waitEvents({
    since: Number.isFinite(since) ? since : undefined,
    types: Array.isArray(input.types) ? input.types.map((item) => String(item)) : undefined,
    env: typeof input.env === 'string' && input.env ? input.env : undefined,
    tabId: typeof input.tabId === 'string' && input.tabId ? input.tabId : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    timeoutMs: Number.isFinite(wait) ? Math.max(0, wait) : 25_000
  })
  reply(res, 200, result)
}

/** 全量工具目录。`tools/list` 在 toolMode=search 下只有核心工具，这里不受影响。 */
function handleApiTools(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' })
    res.end()
    return
  }
  reply(res, 200, { version: app.getVersion(), tools: listToolMeta() })
}

/**
 * 单个工具调用。返回工具载荷本身（不再包成 content part），图片放同级 `image` 字段。
 * 解析成功且鉴权通过之后一律 200，成败看 `ok`。
 */
async function handleApiCall(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' })
    res.end()
    return
  }
  let body: unknown
  try {
    body = await readBody(req)
  } catch {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'body is not valid JSON' })
    return
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'body must be an object' })
    return
  }
  const { tool, args } = body as { tool?: unknown; args?: unknown }
  if (typeof tool !== 'string' || !tool.trim()) {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'tool is required' })
    return
  }
  if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
    reply(res, 400, { ok: false, code: 'bad_request', error: 'args must be an object' })
    return
  }
  try {
    const result = await callTool(tool, args ?? {})
    const { image, ...rest } = result as typeof result & {
      image?: { mimeType?: string; data?: string }
    }
    reply(res, 200, image?.data && image.mimeType ? { ...rest, image } : rest)
  } catch (error) {
    reply(res, 500, { ok: false, code: 'internal', error: error instanceof Error ? error.message : String(error) })
  }
}
