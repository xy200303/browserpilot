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

export function watchConsole(wc: WebContents): void {
  if (logs.has(wc.id)) return
  logs.set(wc.id, [])
  wc.on('console-message', ((_event: unknown, level: unknown, message?: string, line?: number, sourceId?: string) => {
    const list = logs.get(wc.id)
    if (!list) return
    const entry: ConsoleEntry =
      typeof level === 'object' && level
        ? {
            level: String((level as { level?: string }).level ?? 'log'),
            message: String((level as { message?: string }).message ?? ''),
            line: (level as { lineNumber?: number }).lineNumber,
            source: (level as { sourceId?: string }).sourceId,
            at: Date.now()
          }
        : { level: String(level), message: String(message ?? ''), line, source: sourceId, at: Date.now() }
    const labels: Record<string, string> = { '0': 'verbose', '1': 'info', '2': 'warning', '3': 'error' }
    entry.level = labels[entry.level] ?? entry.level
    list.unshift(entry)
    if (list.length > 300) list.length = 300
  }) as never)
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
