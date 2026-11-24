import { randomBytes } from 'crypto'

/**
 * 进程内事件总线。
 *
 * `seq` 从启动时刻的 `Date.now()` 开始单调递增——起点不能用 0/1，
 * 否则 App 重启后旧客户端拿着一个"走在未来"的 seq 会被当成正常请求，静默拿到另一批事件。
 */
export type AppEvent = {
  seq: number
  type: string
  at: number
  env?: string
  tabId?: string
  payload: Record<string, unknown>
}

export type EventFilter = {
  /** 支持 `net.*` 这种后缀通配 */
  types?: string[]
  env?: string
  tabId?: string
}

export type WaitRequest = EventFilter & {
  /** 客户端已经拿到的最后一条 seq；不传表示只看新事件 */
  since?: number
  limit?: number
  timeoutMs?: number
}

export type WaitResult = {
  epoch: string
  /** 这批最后一条的 seq；没有新事件时等于入参 since（或当前最新） */
  seq: number
  events: AppEvent[]
  more?: boolean
  timeout?: boolean
  /** 位置失效，客户端应当用工具重建状态 */
  reset?: boolean
  /** 挂起的请求太多，这一轮直接放空 */
  busy?: boolean
}

const MAX_EVENTS = 2000
const MAX_AGE = 5 * 60_000
const MAX_WAITERS = 8
const MAX_LIMIT = 200
const MAX_WAIT_MS = 25_000

const epoch = randomBytes(3).toString('hex')
let next = Date.now()
const buffer: AppEvent[] = []

type Waiter = {
  filter: EventFilter
  since: number
  limit: number
  resolve: (result: WaitResult) => void
  timer: NodeJS.Timeout
}

const waiters = new Set<Waiter>()

export function eventEpoch(): string {
  return epoch
}

/** 当前缓冲里最新一条的 seq；一条都没有时是起点前一位。 */
export function latestSeq(): number {
  return next - 1
}

function matches(event: AppEvent, filter: EventFilter): boolean {
  if (filter.env && event.env !== filter.env) return false
  if (filter.tabId && event.tabId !== filter.tabId) return false
  if (filter.types && filter.types.length) {
    const hit = filter.types.some((pattern) =>
      pattern.endsWith('*') ? event.type.startsWith(pattern.slice(0, -1)) : event.type === pattern
    )
    if (!hit) return false
  }
  return true
}

function trim(): void {
  const cutoff = Date.now() - MAX_AGE
  while (buffer.length && (buffer.length > MAX_EVENTS || buffer[0].at < cutoff)) buffer.shift()
}

function collect(since: number, filter: EventFilter, limit: number): AppEvent[] {
  const out: AppEvent[] = []
  for (const event of buffer) {
    if (event.seq <= since) continue
    if (!matches(event, filter)) continue
    out.push(event)
    if (out.length >= limit) break
  }
  return out
}

function hasMore(lastSeq: number, filter: EventFilter): boolean {
  return buffer.some((event) => event.seq > lastSeq && matches(event, filter))
}

/** 产生一条事件。返回它主要是方便测试和调试。 */
export function emit(
  type: string,
  meta: { env?: string; tabId?: string; payload?: Record<string, unknown> } = {}
): AppEvent {
  const event: AppEvent = {
    seq: next++,
    type,
    at: Date.now(),
    env: meta.env,
    tabId: meta.tabId,
    payload: meta.payload ?? {}
  }
  buffer.push(event)
  trim()
  for (const waiter of [...waiters]) {
    const events = collect(waiter.since, waiter.filter, waiter.limit)
    if (!events.length) continue
    clearTimeout(waiter.timer)
    waiters.delete(waiter)
    const last = events[events.length - 1].seq
    waiter.resolve({ epoch, seq: last, events, more: hasMore(last, waiter.filter) })
  }
  return event
}

/**
 * 取事件：有就立刻返回，没有就挂起到超时。
 * `/api/events` 和 Agent 的 `events_wait` 工具共用这一个实现。
 */
export function waitEvents(request: WaitRequest = {}): Promise<WaitResult> {
  const filter: EventFilter = { types: request.types, env: request.env, tabId: request.tabId }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(request.limit ?? MAX_LIMIT)))
  const latest = latestSeq()
  const start = buffer.length ? buffer[0].seq : next
  const requested = Number(request.since)
  const since = Number.isFinite(requested) ? requested : latest

  // 位置失效：比缓冲还旧，或者走在未来（App 重启过）
  if (since < start - 1 || since > latest) {
    const events = collect(start - 1, filter, limit)
    const last = events.length ? events[events.length - 1].seq : latest
    return Promise.resolve({ epoch, seq: last, events, more: hasMore(last, filter), reset: true })
  }

  const immediate = collect(since, filter, limit)
  if (immediate.length) {
    const last = immediate[immediate.length - 1].seq
    return Promise.resolve({ epoch, seq: last, events: immediate, more: hasMore(last, filter) })
  }

  const timeoutMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.trunc(request.timeoutMs ?? 0)))
  if (timeoutMs === 0) return Promise.resolve({ epoch, seq: since, events: [] })
  if (waiters.size >= MAX_WAITERS) return Promise.resolve({ epoch, seq: since, events: [], busy: true })

  return new Promise<WaitResult>((resolve) => {
    const waiter: Waiter = {
      filter,
      since,
      limit,
      resolve,
      timer: setTimeout(() => {
        waiters.delete(waiter)
        resolve({ epoch, seq: since, events: [], timeout: true })
      }, timeoutMs)
    }
    waiter.timer.unref?.()
    waiters.add(waiter)
  })
}
