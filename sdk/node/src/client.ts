import { spawn } from 'node:child_process'
import { BrowserPilotError, InstallError, TransportError } from './errors.js'
import { ensureApp, locateApp, type DownloadProgress } from './install.js'
import { Locator } from './locator.js'
import { Page } from './page.js'
import { mcpFile } from './paths.js'
import { Transport, readEndpoint, type Endpoint, type CallResult, type EventRecord, type EventWaitOptions } from './transport.js'
import { Bookmarks, Downloads, Environments, Groups, History, Net, Network, Settings, Tabs, Workflows } from './api.js'
import { APP_VERSION, SDK_VERSION } from './version.js'

export const DEFAULT_ENV = 'env-default'

export type LaunchOptions = {
  /** 用哪套环境。默认 env-default，登录态就在里面。 */
  env?: string
  /** true 时把窗口切成无头（窗口仍然存在，只是不显示）。 */
  headless?: boolean
  /** 等 App 起来的秒数，默认 60。第一次下载不占这个时间。 */
  timeout?: number
  /** 显式指定 App 可执行文件。 */
  exe?: string
  /** 指定要装的 App 版本，默认跟 SDK 同号。 */
  version?: string
  /** 直接连一个已知端点，跳过发现流程。 */
  endpoint?: Endpoint
  /** 只找不下载。 */
  offline?: boolean
  /** 已装的版本和 SDK 不一致时报错而不是警告。 */
  strictVersion?: boolean
  onDownload?: (progress: DownloadProgress) => void
  log?: (message: string) => void
}

export type ConnectOptions = {
  endpoint?: Endpoint
  timeout?: number
  log?: (message: string) => void
}

type Owned = {
  exe: string
  source: string
  /** SDK 自己开的窗口，close() 时收拾这些。 */
  envs: Set<string>
}

export class Environment {
  readonly id: string
  private readonly client: BrowserPilot

  constructor(client: BrowserPilot, id: string) {
    this.client = client
    this.id = id
  }

  /** 打开这套环境的窗口。已经开着就按这次的显示方式切换。 */
  async open(options: { headless?: boolean } = {}): Promise<void> {
    await this.client.call('env_open', { env: this.id, ...options })
  }

  /** 关窗但保留登录态。 */
  async close(): Promise<void> {
    await this.client.call('env_close', { env: this.id })
  }

  async newPage(options: { url?: string } = {}): Promise<Page> {
    const data = await this.client.call('tab_open', { env: this.id, url: options.url ?? '' })
    return new Page(this.client.transport, String(data.tabId), this.id)
  }

  async pages(): Promise<Page[]> {
    const data = await this.client.call('tab_list', {})
    const tabs = (data.tabs as Array<{ id: string; envId: string }> | undefined) ?? []
    return tabs
      .filter((tab) => tab.envId === this.id)
      .map((tab) => new Page(this.client.transport, tab.id, this.id))
  }
}

export class BrowserPilot {
  readonly transport: Transport
  readonly envId: string
  readonly sdkVersion = SDK_VERSION
  /** 只有 SDK 自己装的那份才知道版本；连别人实例时是 undefined。 */
  readonly appVersion?: string
  // 按用途分组的工具入口，见 api.ts
  readonly envs: Environments
  readonly tabs: Tabs
  readonly groups: Groups
  readonly settings: Settings
  readonly workflow: Workflows
  readonly net: Net
  readonly history: History
  readonly bookmarks: Bookmarks
  readonly downloads: Downloads
  readonly network: Network
  private readonly owned?: Owned

  constructor(transport: Transport, options: { envId?: string; appVersion?: string; owned?: Owned } = {}) {
    this.transport = transport
    this.envId = options.envId ?? DEFAULT_ENV
    this.appVersion = options.appVersion
    this.owned = options.owned
    // 按用途分组的工具入口，见 api.ts；等价于直接 bp.call('env_list', ...)
    this.envs = new Environments(this)
    this.tabs = new Tabs(this)
    this.groups = new Groups(this)
    this.settings = new Settings(this)
    this.workflow = new Workflows(this)
    this.net = new Net(this)
    this.history = new History(this)
    this.bookmarks = new Bookmarks(this)
    this.downloads = new Downloads(this)
    this.network = new Network(this)
  }

  /** 原始工具调用。SDK 没封装的工具都从这里走。 */
  async call(name: string, args: Record<string, unknown> = {}, options: { timeout?: number } = {}): Promise<Record<string, unknown>> {
    const result: CallResult = await this.transport.call(name, args, options)
    return result.data
  }

  async newPage(options: { url?: string; env?: string } = {}): Promise<Page> {
    const env = options.env ?? this.envId
    if (this.owned) this.owned.envs.add(env)
    const data = await this.call('tab_open', { env, url: options.url ?? '' })
    return new Page(this.transport, String(data.tabId), env)
  }

  async pages(): Promise<Page[]> {
    const data = await this.call('tab_list', {})
    const tabs = (data.tabs as Array<{ id: string; envId: string }> | undefined) ?? []
    return tabs.map((tab) => new Page(this.transport, tab.id, tab.envId))
  }

  async environments(): Promise<Array<{ id: string; name: string; remark: string; windowOpen: boolean; headless: boolean }>> {
    const data = await this.call('env_list', {})
    return (data.envs as Array<{ id: string; name: string; remark: string; windowOpen: boolean; headless: boolean }>) ?? []
  }

  environment(id: string): Environment {
    return new Environment(this, id)
  }

  /** 这套环境里的定位器工厂，等价于先 newPage 再取。 */
  async locator(selector: string): Promise<Locator> {
    const pages = await this.pages()
    const page = pages[0]
    if (!page) throw new BrowserPilotError('没有打开的页面，先 newPage()')
    return page.locator(selector)
  }

  /**
   * 长轮询事件流。默认只看新事件；传 `since` 从某个位置开始。
   *
   *   for await (const event of bp.events({ types: ['net.*'] })) { ... }
   *
   * 永远不会自己结束，靠 `break` 退出。
   */
  async *events(options: EventWaitOptions = {}): AsyncGenerator<EventRecord, never, void> {
    let since = options.since
    for (;;) {
      const result = await this.transport.events({ ...options, since })
      since = result.seq
      for (const event of result.events) yield event
      if (result.busy) await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /** 订阅某类事件，返回取消函数。后台跑 `events()`，不需要了记得调。 */
  on(type: string, handler: (event: EventRecord) => void): () => void {
    let stopped = false
    void (async () => {
      for await (const event of this.events({ types: [type] })) {
        if (stopped) return
        handler(event)
      }
    })().catch(() => undefined)
    return () => {
      stopped = true
    }
  }

  /**
   * 收拾自己开的东西。
   * App 是用户日常在用的浏览器：连的是别人的实例时什么都不做，
   * 只有 SDK 自己拉起来的那份才关窗口（关完最后一个窗口 App 自己退出）。
   */
  async close(): Promise<void> {
    try {
      if (this.owned) {
        for (const env of this.owned.envs) {
          await this.transport.call('env_close', { env }).catch(() => undefined)
        }
      }
    } finally {
      await this.transport.close()
    }
  }
}

/**
 * 连上一个已经跑着的 BrowserPilot。不启动任何进程。
 * 没有实例时抛错，适合「必须用用户当前这扇窗口」的场景。
 */
export async function connect(options: ConnectOptions = {}): Promise<BrowserPilot> {
  const endpoint = options.endpoint ?? readEndpoint()
  const transport = new Transport(endpoint)
  if (!(await transport.ping())) {
    throw new TransportError(`${endpoint.url} 没有响应。BrowserPilot 可能已经关了。`)
  }
  return new BrowserPilot(transport, {})
}

/**
 * 拿到一个可用的 BrowserPilot：已经在跑就连上去，没跑就找到装好的那份拉起来，
 * 一份都找不到才下载。
 */
export async function launch(options: LaunchOptions = {}): Promise<BrowserPilot> {
  const log = options.log ?? (process.env.BROWSERPILOT_DEBUG ? (message: string) => console.error(`[browserpilot] ${message}`) : () => {})
  const env = options.env ?? DEFAULT_ENV
  const timeoutMs = (options.timeout ?? 60) * 1000

  // 0. 给了端点就直接用，不发现也不启动。
  if (options.endpoint) {
    const transport = new Transport(options.endpoint)
    if (!(await transport.ping())) throw new TransportError(`${options.endpoint.url} 没有响应`)
    if (options.headless !== undefined) await applyHeadless(transport, env, options.headless)
    return new BrowserPilot(transport, { envId: env })
  }

  // 1. 已经有一个实例在跑：直接连，绝不拉起第二个（单实例锁会让它自己退出）。
  if (!options.exe) {
    const running = await runningEndpoint()
    if (running) {
      log(`连上已经在跑的实例 ${running.url}`)
      const transport = new Transport(running)
      if (options.headless !== undefined) await applyHeadless(transport, env, options.headless)
      return new BrowserPilot(transport, { envId: env })
    }
  }

  // 2. 找一份能用的，必要时下载。
  const located = locateApp({ exe: options.exe, version: options.version })
  const app = located ?? (await ensureApp({ exe: options.exe, version: options.version, offline: options.offline, onDownload: options.onDownload, log }))

  if (options.strictVersion && app.version && app.version !== APP_VERSION) {
    throw new InstallError(`SDK 对应 v${APP_VERSION}，本机装的是 v${app.version}（BROWSERPILOT_STRICT_VERSION 生效）`)
  }
  log(app.source === 'downloaded' ? `装了 v${app.version} 到 ${app.exe}` : `用已有的 ${app.exe}`)

  // 3. 拉起来并等它就绪。
  spawnApp(app.exe)
  const endpoint = await waitForEndpoint(timeoutMs, log)
  const transport = new Transport(endpoint)
  if (options.headless !== undefined) await applyHeadless(transport, env, options.headless)

  const owned: Owned = { exe: app.exe, source: app.source, envs: new Set([env]) }
  return new BrowserPilot(transport, { envId: env, appVersion: app.version, owned })
}

async function applyHeadless(transport: Transport, env: string, headless: boolean): Promise<void> {
  // headless=false 时不主动开窗：那会把用户正在用的窗口拉到前台。
  if (!headless) return
  await transport.call('env_open', { env, headless: true })
}

async function runningEndpoint(): Promise<Endpoint | null> {
  try {
    const endpoint = readEndpoint()
    const transport = new Transport(endpoint, { timeout: 2 })
    return (await transport.ping()) ? endpoint : null
  } catch {
    return null
  }
}

function spawnApp(exe: string): void {
  // detached：脚本崩了不能把用户日常在用的浏览器带走。
  const child = spawn(exe, [], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function waitForEndpoint(timeoutMs: number, log: (message: string) => void): Promise<Endpoint> {
  const deadline = Date.now() + timeoutMs
  const file = mcpFile()
  let announced = false
  for (;;) {
    try {
      const endpoint = readEndpoint(file)
      const transport = new Transport(endpoint, { timeout: 2 })
      if (await transport.ping()) return endpoint
    } catch {
      /* 还没写出来，继续等 */
    }
    if (Date.now() > deadline) {
      throw new InstallError(
        `等了 ${Math.round(timeoutMs / 1000)}s，BrowserPilot 还没把 ${file} 写好或者端口不通。` +
          `打开 BrowserPilot 的 设置 → 通用，确认 MCP 是开着的。`
      )
    }
    if (!announced) {
      announced = true
      log('等 BrowserPilot 起来…')
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

/** 找一份装好的 App，不做任何网络请求。给 doctor 用。 */
export function findInstalled(exe?: string): ReturnType<typeof locateApp> {
  return locateApp({ exe, offline: true })
}