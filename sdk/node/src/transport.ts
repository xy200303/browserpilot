import { existsSync, readFileSync } from 'node:fs'
import { InstallError, TransportError, ToolError, type ToolPayload } from './errors.js'
import { mcpFile } from './paths.js'
import { APP_VERSION } from './version.js'

export type Endpoint = { url: string; api: string; token: string }

export type ImagePart = { mimeType: string; data: Buffer }

export type CallResult = {
  data: ToolPayload
  /** 截图类工具才有：App 把图片放在同级的 `image` 字段里。 */
  image?: ImagePart
}

export type EventRecord = {
  seq: number
  type: string
  at: number
  env?: string
  tabId?: string
  payload: Record<string, unknown>
}

export type EventWaitOptions = {
  since?: number
  types?: string[]
  env?: string
  tabId?: string
  /** 最多挂起多少秒，默认 25，上限 25 */
  wait?: number
  limit?: number
}

export type EventWaitResult = {
  epoch: string
  seq: number
  events: EventRecord[]
  more?: boolean
  timeout?: boolean
  reset?: boolean
  busy?: boolean
}

/**
 * 读取 App 写下的端点文件。程序面在 `api` 字段里；没有这个字段说明装的是旧版。
 * 不回退到 `/mcp`：跨版本混用会静默降级（没有批量、没有事件），比报错难查。
 */
export function readEndpoint(file = mcpFile()): Endpoint {
  if (!existsSync(file)) {
    throw new TransportError(`没找到 ${file}。要么 BrowserPilot 没启动过，要么 MCP 在设置里被关掉了。`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new TransportError(`${file} 不是合法的 JSON`, { cause: error })
  }
  const saved = raw as { url?: string; api?: string; token?: string }
  if (!saved.token) throw new TransportError(`${file} 里缺 token`)
  if (!saved.api) {
    throw new InstallError(
      `本机装的 BrowserPilot 太旧，没有 /api（对应 SDK v${APP_VERSION}）。请升级，或用 BROWSERPILOT_EXE 指定新版本。`
    )
  }
  return { url: saved.url ?? '', api: saved.api.replace(/\/+$/, ''), token: saved.token }
}

const DEFAULT_TIMEOUT_SECONDS = 120

export class Transport {
  readonly endpoint: Endpoint
  /** 单次调用默认超时，秒 */
  timeout: number
  private closed = false

  constructor(endpoint: Endpoint, options: { timeout?: number } = {}) {
    this.endpoint = endpoint
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS
  }

  /** 探活：能列出工具就算活着。 */
  async ping(timeoutSeconds = 2): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint.api}/tools`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.endpoint.token}` },
        signal: AbortSignal.timeout(timeoutSeconds * 1000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async tools(): Promise<Array<{ name: string; description: string; inputSchema: unknown; group?: string }>> {
    const response = await this.request('GET', '/tools', 10)
    const payload = (await response.json()) as { tools?: Array<{ name: string; description: string; inputSchema: unknown }> }
    return payload.tools ?? []
  }

  async call(name: string, args: Record<string, unknown> = {}, options: { timeout?: number } = {}): Promise<CallResult> {
    const response = await this.request('POST', '/call', options.timeout ?? this.timeout, { tool: name, args })
    const text = await response.text()
    let payload: ToolPayload
    try {
      payload = JSON.parse(text) as ToolPayload
    } catch (error) {
      throw new TransportError(`${name} 返回的不是 JSON：${text.slice(0, 200)}`, { cause: error })
    }
    // 鉴权通过、参数能解析之后一律 200，成败看 ok
    if (payload.ok === false) throw new ToolError(name, payload)
    const { image, ...rest } = payload as ToolPayload & { image?: { mimeType?: string; data?: string } }
    const picture =
      image?.data && image.mimeType ? { mimeType: image.mimeType, data: Buffer.from(image.data, 'base64') } : undefined
    return { data: rest as ToolPayload, image: picture }
  }

  /** 长轮询取事件。`since` 是上次结果里的 seq；`wait` 是最多挂起多少秒。 */
  async events(options: EventWaitOptions = {}): Promise<EventWaitResult> {
    const wait = Math.max(0, Math.min(25, options.wait ?? 25))
    const body: Record<string, unknown> = { wait: Math.round(wait * 1000) }
    if (options.since !== undefined) body.since = options.since
    if (options.types?.length) body.types = options.types
    if (options.env) body.env = options.env
    if (options.tabId) body.tabId = options.tabId
    if (options.limit !== undefined) body.limit = options.limit
    // 客户端要比服务端挂得更久一点，否则先超时的永远是客户端
    const response = await this.request('POST', '/events', wait + 10, body)
    return (await response.json()) as EventWaitResult
  }

  async close(): Promise<void> {
    this.closed = true
  }

  private async request(method: 'GET' | 'POST', path: string, timeoutSeconds: number, body?: unknown): Promise<Response> {
    if (this.closed) throw new TransportError('连接已经关了')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.endpoint.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        signal: controller.signal
      }
      if (body !== undefined) init.body = JSON.stringify(body)
      const response = await fetch(`${this.endpoint.api}${path}`, init)
      if (response.status === 401) throw new TransportError('token 不对，重新读一遍 mcp.json')
      if (response.status === 403) throw new TransportError('被 Origin 校验挡下了')
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new TransportError(`HTTP ${response.status} ${text.slice(0, 200)}`)
      }
      return response
    } catch (error) {
      if (error instanceof TransportError) throw error
      if ((error as Error).name === 'AbortError') throw new TransportError(`等了 ${timeoutSeconds}s 没回应`)
      throw new TransportError(`连不上 ${this.endpoint.api}${path}`, { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }
}
