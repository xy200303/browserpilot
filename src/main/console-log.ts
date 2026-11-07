import type { WebContents } from 'electron'

export type ConsoleEntry = {
  level: string
  message: string
  line?: number
  source?: string
  stack?: string
  at: number
}

const logs = new Map<number, ConsoleEntry[]>()

type ConsoleMessageEvent = {
  level?: unknown
  message?: unknown
  lineNumber?: unknown
  sourceId?: unknown
}

export function watchConsole(wc: WebContents): void {
  if (logs.has(wc.id)) return
  logs.set(wc.id, [])
  // Electron 45 起只传一个事件对象；旧版是位置参数，这里两种都接住
  const onMessage = (...args: unknown[]): void => {
    const list = logs.get(wc.id)
    if (!list) return
    const first = args[0]
    const event =
      first && typeof first === 'object' && 'message' in first ? (first as ConsoleMessageEvent) : undefined
    const level = event ? event.level : args[1]
    const message = event ? event.message : args[2]
    const line = event ? event.lineNumber : args[3]
    const source = event ? event.sourceId : args[4]
    const entry: ConsoleEntry = {
      level: String(level ?? 'log'),
      message: String(message ?? ''),
      line: typeof line === 'number' ? line : undefined,
      source: typeof source === 'string' ? source : undefined,
      at: Date.now()
    }
    const labels: Record<string, string> = { '0': 'verbose', '1': 'info', '2': 'warning', '3': 'error' }
    entry.level = labels[entry.level] ?? entry.level
    list.unshift(entry)
    if (list.length > 300) list.length = 300
  }
  wc.on('console-message', onMessage as never)
  wc.once('destroyed', () => logs.delete(wc.id))
}

export function recordConsole(wc: WebContents, entry: ConsoleEntry): void {
  const list = logs.get(wc.id)
  if (!list) return
  const normalize = (text: string): string => text.replace('Uncaught (in promise) ', 'Uncaught ')
  const duplicate = list.find(
    (item) =>
      normalize(item.message) === normalize(entry.message) &&
      (item.source ?? '') === (entry.source ?? '') &&
      item.line === entry.line &&
      Math.abs(item.at - entry.at) < 500
  )
  if (duplicate) {
    if (entry.stack && !duplicate.stack) duplicate.stack = entry.stack
    return
  }
  list.unshift(entry)
  if (list.length > 300) list.length = 300
}

export function consoleFor(wc: WebContents): ConsoleEntry[] {
  return logs.get(wc.id) ?? []
}

export function clearConsole(wc: WebContents): void {
  logs.set(wc.id, [])
}
