import { useEffect, useMemo, useState } from 'react'
import { Clock3, History, Search, Trash2 } from 'lucide-react'
import type { HistoryEntry } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(key: string): string {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (key === dayKey(today.getTime())) return '今天'
  if (key === dayKey(yesterday.getTime())) return '昨天'
  const [year, month, day] = key.split('-').map(Number)
  return `${year} 年 ${month} 月 ${day} 日`
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function Favicon({ entry }: { entry: HistoryEntry }) {
  const [broken, setBroken] = useState(false)
  if (entry.favicon && !broken) {
    return <img src={entry.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" onError={() => setBroken(true)} />
  }
  return <Clock3 size={16} className="shrink-0 text-neutral-400" />
}

function Row({ entry, remove }: { entry: HistoryEntry; remove: (id: string) => void }) {
  const open = (): void => {
    void window.browser.openHistory(entry.url)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex cursor-default items-start gap-3 px-3 py-2.5 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      title={entry.url}
    >
      <span className="mt-0.5"><Favicon entry={entry} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-900">{entry.title || entry.url}</span>
        <span className="mt-0.5 block truncate text-xs text-neutral-400">{entry.url}</span>
      </span>
      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-neutral-400">{timeLabel(entry.visitedAt)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        title="删除这条记录"
        onClick={(event) => {
          event.stopPropagation()
          remove(entry.id)
        }}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = (): void => {
    void window.browser.listHistory().then((list) => {
      setItems(list)
      setLoaded(true)
    })
  }

  useEffect(() => {
    load()
    let signature = ''
    const off = window.browser.onState((state) => {
      const next = state.tabs
        .filter((tab) => tab.kind === 'page')
        .map((tab) => `${tab.id}:${tab.url}:${tab.title}`)
        .join('|')
      if (next === signature) return
      signature = next
      load()
    })
    return off
  }, [])

  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 5000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((entry) => entry.title.toLowerCase().includes(keyword) || entry.url.toLowerCase().includes(keyword))
  }, [items, query])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const entry of filtered) {
      const key = dayKey(entry.visitedAt)
      const list = map.get(key)
      if (list) list.push(entry)
      else map.set(key, [entry])
    }
    return [...map.entries()]
  }, [filtered])

  const remove = (id: string): void => {
    setItems((current) => current.filter((entry) => entry.id !== id))
    void window.browser.deleteHistory(id)
  }

  const clear = (): void => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setItems([])
    setConfirmClear(false)
    void window.browser.clearHistory()
  }

  return (
    <div className="h-full overflow-auto bg-neutral-50 p-6">
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History size={18} className="text-neutral-500" />
            <h1 className="text-lg font-semibold">历史记录</h1>
            <span className="text-xs text-neutral-400">{items.length} 条</span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={load}>刷新</Button>
            <Button
              type="button"
              variant={confirmClear ? 'destructive' : 'outline'}
              size="sm"
              disabled={items.length === 0}
              onClick={clear}
            >
              {confirmClear ? '确认清空这个环境' : '清空历史'}
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或网址"
            className="bg-white pl-8"
          />
        </div>

        {loaded && filtered.length === 0 && (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-white py-16 text-center">
            <Clock3 size={22} className="text-neutral-300" />
            <p className="text-sm text-neutral-500">{items.length === 0 ? '还没有历史记录' : '没有匹配的记录'}</p>
            <p className="text-xs text-neutral-400">打开网页后，记录会出现在这里。</p>
          </div>
        )}

        {groups.map(([key, entries]) => (
          <section key={key} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-500">{dayLabel(key)}</h2>
            <div className="divide-y divide-neutral-100">
              {entries.map((entry) => <Row key={entry.id} entry={entry} remove={remove} />)}
            </div>
          </section>
        ))}

        {items.length > 0 && (
          <p className="pb-4 text-center text-xs text-neutral-400">历史记录只保存在本机，按环境隔离；最多保留 3000 条。</p>
        )}
      </div>
    </div>
  )
}
