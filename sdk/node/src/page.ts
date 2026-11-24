import { writeFileSync } from 'node:fs'
import { NotFoundError, ToolError, type ToolPayload } from './errors.js'
import { Locator, actionArgs, describe, isLocatorSpec, typePlan, waitArgs, type LocatorSpec } from './locator.js'
import type { CallResult, EventRecord, Transport } from './transport.js'

/** 页面能订阅的事件，映射到事件总线里的 type */
export type PageEventName = 'response' | 'request' | 'navigation' | 'console' | 'loading'

const PAGE_EVENT_TYPES: Record<PageEventName, string[]> = {
  response: ['net.response'],
  request: ['net.request'],
  navigation: ['tab.navigation'],
  console: ['page.console'],
  loading: ['tab.loading']
}

function urlMatches(match: string | RegExp, url: string): boolean {
  if (typeof match === 'string') return url.includes(match)
  // 带 g/y 的正则 test() 会留 lastIndex，下一轮可能从中间开始
  match.lastIndex = 0
  return match.test(url)
}

/** 定位目标：CSS 选择器、Locator、或者直接给一份定位描述。 */
export type PageTarget = string | Locator | LocatorSpec

export type ClickOptions = { button?: 'left' | 'right'; count?: number; /** 秒 */ timeout?: number; via?: 'cdp' | 'native' | 'inject' | 'pointer' }

export type ScreenshotOptions = {
  path?: string
  target?: PageTarget
  clip?: { x: number; y: number; width: number; height: number }
  /**
   * 默认关。App 自己默认会画坐标网格（给人用截图点位置），
   * SDK 里那是噪点，需要时再显式打开。
   */
  grid?: boolean | number
  edgeOnly?: boolean
}

export type WaitOptions = { state?: 'appear' | 'gone'; /** 最多等多少秒 */ timeout?: number; /** 轮询间隔，秒 */ poll?: number }

const DEFAULT_MODIFIER = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'

export class Page {
  readonly id: string
  readonly env: string
  private readonly transport: Transport
  /** 这个 Page 当前有几路订阅要抓包；0 时才真的 net_stop */
  private captureUsers = 0
  /** net_start 的进行中 Promise：并发订阅共用一次握手，不各开一遍 */
  private captureReady: Promise<void> | null = null

  constructor(transport: Transport, id: string, env: string) {
    this.transport = transport
    this.id = id
    this.env = env
  }

  /** 原始工具调用，参数里自动带上 tabId。99 个工具没被 SDK 封装的部分从这里走。 */
  async call(name: string, args: Record<string, unknown> = {}, options: { timeout?: number } = {}): Promise<ToolPayload> {
    const result = await this.raw(name, args, options)
    return result.data
  }

  // ---------- 导航 ----------

  /** 打开地址。page_navigate 内部已经等到 load 完成，不用再补等待。 */
  async goto(url: string): Promise<void> {
    await this.raw('page_navigate', { url })
  }

  async reload(): Promise<void> {
    await this.raw('page_reload', {})
  }

  async back(): Promise<void> {
    await this.raw('page_back', {})
  }

  async forward(): Promise<void> {
    await this.raw('page_forward', {})
  }

  /** 等 did-stop-loading。跳转和点链接之后比 sleep 可靠。 */
  async waitForLoad(timeout = 15): Promise<void> {
    await this.raw('page_wait_load', { timeout })
  }

  async url(): Promise<string> {
    return (await this.info()).url
  }

  async title(): Promise<string> {
    return (await this.info()).title
  }

  // ---------- 定位 ----------

  getByRole(role: string, options: { name?: string; exact?: boolean } = {}): Locator {
    return new Locator(this, {
      role,
      name: options.name,
      nameMatch: options.exact === undefined ? undefined : options.exact ? 'exact' : 'contains'
    })
  }

  getByText(text: string, options: { exact?: boolean } = {}): Locator {
    return new Locator(this, { text, textMatch: options.exact === undefined ? undefined : options.exact ? 'exact' : 'contains' })
  }

  getByLabel(label: string): Locator {
    return new Locator(this, { label })
  }

  getByPlaceholder(placeholder: string): Locator {
    return new Locator(this, { placeholder })
  }

  getByTestId(testId: string): Locator {
    return new Locator(this, { testId })
  }

  locator(selector: string): Locator {
    return new Locator(this, { selector })
  }

  xpath(xpath: string): Locator {
    return new Locator(this, { xpath })
  }

  // ---------- 动作 ----------

  async click(target: PageTarget, options: ClickOptions = {}): Promise<void> {
    const args = actionArgs(this.specOf(target))
    if (options.button) args.button = options.button
    if (options.count) args.count = options.count
    if (options.via) args.via = options.via
    await this.raw('page_click', args, { timeout: options.timeout })
  }

  /**
   * 覆盖式输入。selector/xpath 一次 inject 搞定；
   * label / placeholder / role 走「聚焦 → 全选 → 粘贴」三步，因为 page_type 只在光标处插入。
   */
  async fill(target: PageTarget, value: string): Promise<void> {
    const spec = this.specOf(target)
    const plan = typePlan(spec, value)
    if (plan.mode === 'inject') {
      await this.raw('page_type', { ...plan.args, text: value, via: 'inject' })
      return
    }
    await this.raw('page_type', { ...plan.args, text: '' })
    await this.press(DEFAULT_MODIFIER)
    await this.raw('page_type', { ...plan.args, text: value, entry: 'paste' })
  }

  /** 在光标处追加，不清空。 */
  async type(target: PageTarget, value: string): Promise<void> {
    const plan = typePlan(this.specOf(target), value)
    const args = { ...plan.args, text: value }
    if (plan.mode === 'inject') delete (args as Record<string, unknown>).via
    await this.raw('page_type', args)
  }

  /** 快捷键进页面，例如 Control+Enter；不会触发窗口自己的新建/关闭标签。 */
  async press(shortcut: string, options: { via?: 'cdp' | 'native' } = {}): Promise<void> {
    await this.raw('page_key', { shortcut, ...options })
  }

  async hover(target: PageTarget): Promise<void> {
    await this.raw('page_hover', actionArgs(this.specOf(target)))
  }

  async select(target: PageTarget, option: string): Promise<void> {
    const spec = this.specOf(target)
    const located = locateFields(spec)
    if (!located) throw new NotFoundError(`selectOption 只支持 selector 或 xpath，收到 ${describe(spec)}`)
    await this.raw('page_select', { ...located, option })
  }

  async scroll(options: { direction?: 'up' | 'down'; target?: PageTarget; until?: PageTarget } = {}): Promise<void> {
    const args: Record<string, unknown> = { direction: options.direction ?? 'down' }
    if (options.target) Object.assign(args, locateFields(this.specOf(options.target)) ?? {})
    if (options.until) {
      const until = this.specOf(options.until)
      if (until.selector) args.untilSelector = until.selector
      if (until.xpath) args.untilXpath = until.xpath
    }
    await this.raw('page_scroll', args)
  }

  /** 滚到目标能被点到为止。 */
  async scrollTo(target: PageTarget): Promise<void> {
    const spec = this.specOf(target)
    const args: Record<string, unknown> = { direction: 'down' }
    if (spec.selector) args.untilSelector = spec.selector
    else if (spec.xpath) args.untilXpath = spec.xpath
    else throw new NotFoundError(`scrollTo 只支持 selector 或 xpath，收到 ${describe(spec)}`)
    await this.raw('page_scroll', args)
  }

  // ---------- 等待 ----------

  /**
   * 等元素出现/消失。
   * selector/xpath 走 page_wait（原生，最快）；文本走 page_find 轮询；
   * role 走无障碍树轮询。label / placeholder 没有对应通道，请用 selector。
   */
  async waitFor(target: PageTarget, options: WaitOptions = {}): Promise<void> {
    const spec = this.specOf(target)
    const state = options.state ?? 'appear'
    const timeout = options.timeout ?? 10
    const native = waitArgs(spec, state, timeout)
    if (native) {
      await this.raw('page_wait', native)
      return
    }
    if (spec.text) return this.pollText(spec.text, state, timeout, options.poll)
    if (spec.role && spec.name) return this.pollSnapshot(spec.name, state, timeout, options.poll)
    throw new NotFoundError(
      `waitFor 不支持 ${describe(spec)}：用 selector / xpath / getByText / getByRole 都能等，` +
        `label 和 placeholder 请改写成 selector。`
    )
  }

  /** 等页面上出现这段文字，用 Ctrl+F 的原生查找，不走 DOM。 */
  async waitForText(text: string, options: WaitOptions = {}): Promise<void> {
    await this.pollText(text, options.state ?? 'appear', options.timeout ?? 10, options.poll)
  }

  /** waitForText 的别名，读起来更像断言。 */
  async expectText(text: string, options: WaitOptions = {}): Promise<void> {
    await this.waitForText(text, options)
  }

  // ---------- 读取 ----------

  async count(target: PageTarget): Promise<number> {
    const spec = this.specOf(target)
    const located = locateFields(spec)
    if (!located) throw new NotFoundError(`count 只支持 selector 或 xpath，收到 ${describe(spec)}`)
    const data = await this.call('page_query', located)
    return Number(data.total ?? 0)
  }

  async isVisible(target: PageTarget): Promise<boolean> {
    const spec = this.specOf(target)
    const located = locateFields(spec)
    if (!located) throw new NotFoundError(`isVisible 只支持 selector 或 xpath，收到 ${describe(spec)}`)
    const data = await this.call('page_query', located)
    const matches = (data.matches as Array<{ hittable?: boolean }> | undefined) ?? []
    return matches.some((item) => item.hittable === true)
  }

  async textContent(target: PageTarget): Promise<string> {
    const spec = this.specOf(target)
    const located = locateFields(spec)
    if (!located) throw new NotFoundError(`textContent 只支持 selector 或 xpath，收到 ${describe(spec)}`)
    const data = await this.call('page_inspect', located)
    return String(data.text ?? '')
  }

  /** dom 是当前文档，response 是这次导航的原始 HTML。 */
  async content(kind: 'dom' | 'response' = 'dom'): Promise<string> {
    const data = await this.call('page_source', { kind })
    return String(data.html ?? '')
  }

  /** 无障碍树，Agent 看页面主要靠它。 */
  async snapshot(): Promise<string> {
    const data = await this.call('page_snapshot', {})
    return String(data.snapshot ?? '')
  }

  /**
   * 直接下发一条 CDP 命令，返回原始结果。
   *
   *   await page.cdp('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
   *   const metrics = await page.cdp('Page.getLayoutMetrics')
   *
   * 走的是 App 的 `page_cdp_batch`，和抓包共用同一个 debugger 会话。
   */
  async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const results = await this.cdpBatch([{ method, params }])
    return results[0] as T
  }

  /**
   * 一次下发多条命令，共用同一个 debugger 会话。`delay` 是每条之后等多久，秒（上限 5）。
   * 中间某条失败会抛错，前面的命令已经生效。
   */
  async cdpBatch(
    commands: Array<{ method: string; params?: Record<string, unknown>; delay?: number }>
  ): Promise<unknown[]> {
    const data = await this.call('page_cdp_batch', {
      commands: commands.map((command) => ({
        method: command.method,
        params: command.params,
        // 工具的 delay 单位是秒
        delay: command.delay
      }))
    })
    return (data.results as unknown[]) ?? []
  }

  /** 在页面里执行 JS。传函数会被 toString 后执行，返回值原样回来。 */
  async evaluate<T = unknown>(source: string | (() => T), options: { frame?: string } = {}): Promise<T> {
    const code = typeof source === 'function' ? `(${source.toString()})()` : source
    const data = await this.call('page_script', { source: code, ...options })
    return data.value as T
  }

  async consoleLogs(options: { clear?: boolean; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
    if (options.clear) {
      await this.call('page_console', { action: 'clear' })
      return []
    }
    const data = await this.call('page_console', { limit: options.limit ?? 100 })
    return (data.messages as Array<Record<string, unknown>>) ?? []
  }

  // ---------- 事件 ----------

  /**
   * 订阅这个标签的事件，返回取消函数。
   *
   *   const off = await page.on('response', (e) => console.log(e.payload.status, e.payload.url))
   *   ...
   *   off()
   *
   * 是 async 的：返回时抓包已经挂好（response / request），紧接着导航不会漏掉首批请求。
   * 最后一个订阅取消时 net_stop；取消会立刻掐断在途的长轮询。
   */
  async on(event: PageEventName, handler: (event: EventRecord) => void): Promise<() => void> {
    if (!(event in PAGE_EVENT_TYPES)) {
      // JS 调用方没有类型检查，拼错事件名会静默订阅成全部事件
      throw new Error(`不认识的事件 ${String(event)}；可选：${Object.keys(PAGE_EVENT_TYPES).join(', ')}`)
    }
    const controller = new AbortController()
    const needsCapture = event === 'response' || event === 'request'
    if (needsCapture) await this.acquireCapture()
    void this.run(PAGE_EVENT_TYPES[event], handler, controller.signal, needsCapture)
    return () => controller.abort()
  }

  /**
   * 等第一个 URL 匹配的响应，返回事件本身（payload 里有 url / status / mimeType / reqId）。
   * 会先把抓包挂好再开始等，所以「先 waitForResponse 再 goto」不会漏掉首批请求。
   *
   *   const res = await page.waitForResponse('api/user', { timeout: 10 })
   */
  async waitForResponse(
    match: string | RegExp,
    options: { timeout?: number } = {}
  ): Promise<EventRecord> {
    const seconds = options.timeout ?? 30
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, seconds * 1000)
    let acquired = false
    try {
      await this.acquireCapture()
      acquired = true
      for await (const record of this.stream(['net.response'], controller.signal)) {
        const url = String((record.payload as { url?: unknown }).url ?? '')
        if (urlMatches(match, url)) return record
      }
    } catch (error) {
      if (!timedOut) throw error
    } finally {
      clearTimeout(timer)
      if (acquired) await this.releaseCapture()
    }
    throw new NotFoundError(`等了 ${seconds}s，没等到匹配 ${String(match)} 的响应`)
  }

  /**
   * 这个标签的事件流：长轮询续传，直到 signal 取消。
   * 一般不用直接调，用 `on()` / `waitForResponse()` 就行。
   */
  async *stream(types: string[], signal?: AbortSignal): AsyncGenerator<EventRecord, void, void> {
    let since: number | undefined
    for (;;) {
      if (signal?.aborted) return
      const floor = since
      const result = await this.transport.events({ tabId: this.id, types, since, wait: 25, signal })
      // 服务端 waiter 满了会立刻返回 busy，等一下再试，别空转打满 CPU
      if (result.busy) {
        await sleep(100, signal)
        continue
      }
      since = result.seq
      for (const record of result.events) {
        if (signal?.aborted) return
        // 位置失效时服务端会重放缓冲，比自己拿到的位置还旧的丢掉
        if (floor !== undefined && record.seq <= floor) continue
        yield record
      }
    }
  }

  private async run(
    types: string[],
    handler: (event: EventRecord) => void,
    signal: AbortSignal,
    capture: boolean
  ): Promise<void> {
    try {
      for await (const record of this.stream(types, signal)) {
        if (signal.aborted) return
        handler(record)
      }
    } catch {
      /* 取消、App 关了、连接断了：都当作订阅结束，调用方可以重新订阅 */
    } finally {
      // on() 已经把抓包挂上了，这里只负责收尾
      if (capture) await this.releaseCapture()
    }
  }

  private async acquireCapture(): Promise<void> {
    this.captureUsers += 1
    if (!this.captureReady) {
      this.captureReady = this.call('net_start', {})
        .then(() => undefined)
        .catch(() => undefined)
    }
    await this.captureReady
  }

  private async releaseCapture(): Promise<void> {
    this.captureUsers = Math.max(0, this.captureUsers - 1)
    if (this.captureUsers > 0) return
    const ready = this.captureReady
    this.captureReady = null
    // 抓包还在握手就先等它挂上，否则 net_stop 可能跑在 net_start 前面
    if (ready) await ready
    if (this.captureUsers > 0) return
    await this.call('net_stop', {}).catch(() => undefined)
  }

  // ---------- 截图 ----------

  /** 返回图片字节。App 那边也会存一份，路径在载荷里。 */
  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const args: Record<string, unknown> = { grid: options.grid ?? false }
    if (options.edgeOnly) args.edgeOnly = true
    if (options.target) Object.assign(args, locateFields(this.specOf(options.target)) ?? {})
    if (options.clip) Object.assign(args, options.clip)
    const result = await this.raw('page_screenshot', args)
    if (!result.image) throw new ToolError('page_screenshot', { ok: false, error: '截图没有返回图片内容' })
    if (options.path) writeFileSync(options.path, result.image.data)
    return result.image.data
  }

  // ---------- 生命周期 ----------

  async bringToFront(): Promise<void> {
    await this.raw('tab_activate', { tabId: this.id })
  }

  async close(): Promise<void> {
    await this.raw('tab_close', { tabId: this.id })
  }

  toString(): string {
    return `Page(${this.id})`
  }

  // ---------- 内部 ----------

  private specOf(target: PageTarget): LocatorSpec {
    if (target instanceof Locator) return target.spec
    if (typeof target === 'string') return { selector: target }
    if (isLocatorSpec(target)) return target
    throw new TypeError('定位目标必须是 CSS 选择器字符串、Locator 或定位描述对象')
  }

  private async info(): Promise<{ url: string; title: string }> {
    const data = await this.transport.call('tab_list', {})
    const tabs = (data.data.tabs as Array<{ id: string; url: string; title: string }> | undefined) ?? []
    const found = tabs.find((tab) => tab.id === this.id)
    if (!found) throw new NotFoundError(`标签 ${this.id} 已经不在了`)
    return { url: found.url, title: found.title }
  }

  private async raw(name: string, args: Record<string, unknown>, options: { timeout?: number } = {}): Promise<CallResult> {
    return this.transport.call(name, { tabId: this.id, ...args }, options)
  }

  private async pollText(text: string, state: 'appear' | 'gone', timeoutSeconds: number, pollSeconds = 0.3): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000
    try {
      for (;;) {
        const data = await this.call('page_find', { text })
        // page_find 返回的是 { matches, active }，不是 total；total 留给兼容旧载荷
        const total = Number(data.matches ?? data.total ?? 0)
        const present = total > 0
        if (state === 'gone' ? !present : present) return
        if (Date.now() > deadline) {
          throw new NotFoundError(`等了 ${timeoutSeconds}s，页面上${state === 'gone' ? '还' : '没'}出现「${text}」`)
        }
        await sleep(pollSeconds * 1000)
      }
    } finally {
      await this.call('page_find', { stop: true }).catch(() => undefined)
    }
  }

  /**
   * 等 role+name 出现。page_wait 不认 role，这里只能轮询无障碍树。
   * 命中条件是名字出现在树里——比 DOM 准确，但一页大表格会比较费。
   */
  private async pollSnapshot(name: string, state: 'appear' | 'gone', timeoutSeconds: number, pollSeconds = 0.5): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000
    for (;;) {
      const tree = await this.snapshot()
      const present = tree.includes(name)
      if (state === 'gone' ? !present : present) return
      if (Date.now() > deadline) {
        throw new NotFoundError(`等了 ${timeoutSeconds}s，无障碍树里${state === 'gone' ? '还' : '没'}出现「${name}」`)
      }
      await sleep(pollSeconds * 1000)
    }
  }
}

function locateFields(spec: LocatorSpec): Record<string, unknown> | null {
  if (spec.selector) return { selector: spec.selector, ...(spec.pierce ? { pierce: true } : {}) }
  if (spec.xpath) return { xpath: spec.xpath, ...(spec.pierce ? { pierce: true } : {}) }
  return null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
