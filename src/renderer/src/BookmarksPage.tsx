import { useMemo, useState } from 'react'
import { Bookmark, Search, Star, Trash2 } from 'lucide-react'
import type { UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function Favicon({ favicon }: { favicon?: string }) {
  const [broken, setBroken] = useState(false)
  if (favicon && !broken) {
    return <img src={favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" onError={() => setBroken(true)} />
  }
  return <Star size={15} className="shrink-0 text-neutral-400" />
}

export function BookmarksPage({ state }: { state: UiState }) {
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const items = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return state.bookmarks
    return state.bookmarks.filter((item) => item.title.toLowerCase().includes(keyword) || item.url.toLowerCase().includes(keyword))
  }, [query, state.bookmarks])

  const clear = (): void => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    void window.browser.clearBookmarks()
  }

  return (
    <div className="h-full overflow-auto bg-neutral-50 p-6">
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bookmark size={18} className="text-neutral-500" />
            <h1 className="text-lg font-semibold">书签</h1>
            <span className="text-xs text-neutral-400">{state.bookmarks.length} 条</span>
          </div>
          <Button
            type="button"
            variant={confirmClear ? 'destructive' : 'outline'}
            size="sm"
            disabled={state.bookmarks.length === 0}
            onClick={clear}
          >
            {confirmClear ? '确认清空这个环境' : '清空书签'}
          </Button>
        </div>

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书签" className="bg-white pl-8" />
        </div>

        {state.bookmarks.length === 0 && (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-white py-16 text-center">
            <Star size={22} className="text-neutral-300" />
            <p className="text-sm text-neutral-500">还没有书签</p>
            <p className="text-xs text-neutral-400">在网页上按 Ctrl+D，或点地址栏右侧的星标。</p>
          </div>
        )}

        {state.bookmarks.length > 0 && items.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-500">没有匹配的书签</p>
        )}

        {items.length > 0 && (
          <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className="group flex cursor-default items-start gap-3 px-3 py-2.5 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
                title={item.url}
                onClick={() => void window.browser.openBookmark(item.url)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void window.browser.openBookmark(item.url)
                  }
                }}
              >
                <span className="mt-0.5"><Favicon favicon={item.favicon} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-neutral-900">{item.title || item.url}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-400">{item.url}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  title="删除书签"
                  onClick={(event) => {
                    event.stopPropagation()
                    void window.browser.deleteBookmark(item.id)
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}

        {state.bookmarks.length > 0 && (
          <p className="pb-4 text-center text-xs text-neutral-400">书签只保存在本机，按环境隔离。</p>
        )}
      </div>
    </div>
  )
}
