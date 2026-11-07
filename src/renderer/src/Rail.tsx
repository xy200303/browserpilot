import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ChevronDown, Pin, Plus, Search, X } from 'lucide-react'
import type { TabInfo, UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'

export function RailApp() {
  const [state, setState] = useState<UiState | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focusSearch, setFocusSearch] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const pinned = useRef(false)
  const timer = useRef<number | null>(null)
  const expanded = open || Boolean(state?.railPinned)

  useEffect(() => {
    pinned.current = Boolean(state?.railPinned)
  }, [state?.railPinned])

  useEffect(() => {
    void window.browser.getState().then(setState)
    return window.browser.onState(setState)
  }, [])

  useEffect(() => {
    return window.browser.onFocusRailSearch(() => {
      setOpen(true)
      void window.browser.setRailOpen(true)
      setFocusSearch(true)
    })
  }, [])

  useEffect(() => {
    if (!expanded || !focusSearch || !searchRef.current) return
    searchRef.current.focus()
    setFocusSearch(false)
  }, [expanded, focusSearch])

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const show = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    if (pinned.current) return
    setOpen(true)
    void window.browser.setRailOpen(true)
  }

  const expandSearch = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setOpen(true)
    if (!pinned.current) void window.browser.setRailOpen(true)
    setFocusSearch(true)
  }

  const hide = (): void => {
    if (query.trim() || document.activeElement === searchRef.current) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (pinned.current) return
      setOpen(false)
      void window.browser.setRailOpen(false)
    }, 200)
  }

  if (!state) return <div className="h-full bg-[#f3f3f3]" />

  const keyword = query.trim().toLowerCase()
  const visible = (tab: TabInfo): boolean => !keyword || (tab.title || '').toLowerCase().includes(keyword) || (tab.url || '').toLowerCase().includes(keyword)
  const pinnedTabs = state.tabs.filter((tab) => tab.pinned).filter(visible)
  const loose = state.tabs.filter((tab) => !tab.pinned && !tab.groupId).filter(visible)
  const matchCount = state.tabs.filter(visible).length
  return (
    <div className={`flex h-full flex-col bg-[#f3f3f3] ${expanded ? 'w-64' : 'w-12'}`} onMouseEnter={show} onMouseLeave={hide}>
      <div className="relative flex h-9 shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          title="展开标签搜索"
          className="size-9 w-12 rounded-md"
          onClick={expandSearch}
        >
          <ChevronDown />
        </Button>
        {expanded && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={state.railPinned ? '取消固定标签栏' : '固定标签栏'}
            className="mr-1.5 ml-auto"
            onClick={() => void window.browser.toggleRailPin()}
          >
            <Pin className={state.railPinned ? 'fill-current' : ''} />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white px-2">
          <Search size={14} className="shrink-0 text-neutral-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                event.currentTarget.blur()
                if (!state.railPinned) {
                  setOpen(false)
                  void window.browser.setRailOpen(false)
                }
                return
              }
              if (event.key === 'Enter') {
                const keyword = query.trim().toLowerCase()
                const first = state.tabs.find((tab) => !keyword || (tab.title || '').toLowerCase().includes(keyword) || (tab.url || '').toLowerCase().includes(keyword))
                if (first) void window.browser.activateTab(first.id)
              }
            }}
            placeholder="搜索标签页"
            className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-neutral-400"
          />
          {query && (
            <button
              type="button"
              title="清除"
              className="grid size-5 shrink-0 place-items-center rounded text-neutral-400 hover:bg-black/5"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {pinnedTabs.length > 0 && (
        <div className="shrink-0">
          {pinnedTabs.map((tab) => (
            <RailTab key={tab.id} tab={tab} expanded={expanded} />
          ))}
          <div className={`my-1 h-px bg-black/10 ${expanded ? 'mx-3' : 'mx-2'}`} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {state.groups.map((group) => {
          const tabs = state.tabs.filter((tab) => tab.groupId === group.id && !tab.pinned).filter(visible)
          if (!tabs.length) return null
          return (
            <div key={group.id} className="mb-1">
              <div
                className={`flex h-6 items-center text-[11px] ${expanded ? 'px-3' : 'justify-center'}`}
                style={{ color: group.color }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.stopPropagation()
                  const tabId = event.dataTransfer.getData('text/plain')
                  if (tabId) void window.browser.assignGroup({ tabId, groupId: group.id })
                }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: group.color }} />
                {expanded && <span className="ml-2 truncate">{group.name}</span>}
              </div>
              {tabs.map((tab) => (
                <RailTab key={tab.id} tab={tab} expanded={expanded} />
              ))}
            </div>
          )
        })}
        {loose.map((tab) => (
          <RailTab key={tab.id} tab={tab} expanded={expanded} />
        ))}
        {keyword && matchCount === 0 && <p className="px-3 py-4 text-xs text-neutral-400">没有匹配的标签</p>}
      </div>

      <Button
        variant="ghost"
        className={`h-10 shrink-0 rounded-none ${expanded ? 'w-full justify-start px-3' : 'w-12 justify-center'}`}
        onClick={() => void window.browser.newTab()}
      >
        <Plus />
        {expanded && <span className="min-w-0 flex-1 truncate text-left">新建标签页</span>}
        {expanded && <span className="shrink-0 text-xs text-muted-foreground">Ctrl+T</span>}
      </Button>
    </div>
  )
}

function RailTab({ tab, expanded }: { tab: TabInfo; expanded: boolean }) {
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    void window.browser.openLayer({ kind: 'context', x: event.clientX, y: event.clientY, tab })
  }
  if (!expanded) {
    return (
      <button
        type="button"
        title={tab.title || '新标签页'}
        draggable
        className="grid h-9 w-full place-items-center border-0 bg-transparent p-0"
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', tab.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.stopPropagation()
          const tabId = event.dataTransfer.getData('text/plain')
          if (tabId && tabId !== tab.id) void window.browser.assignGroup({ tabId, groupId: tab.groupId })
        }}
        onClick={() => void window.browser.activateTab(tab.id)}
        onContextMenu={openMenu}
      >
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tab.active ? 'bg-white' : 'hover:bg-black/[0.06]'}`}>
          <TabIcon tab={tab} />
        </span>
      </button>
    )
  }
  return (
    <div
      title={tab.title || '新标签页'}
      draggable
      className={`group mx-2 flex h-8 items-center gap-2 rounded-md px-2 ${tab.active ? 'bg-white' : 'hover:bg-black/[0.06]'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.stopPropagation()
        const tabId = event.dataTransfer.getData('text/plain')
        if (tabId && tabId !== tab.id) void window.browser.assignGroup({ tabId, groupId: tab.groupId })
      }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left" onClick={() => void window.browser.activateTab(tab.id)} onContextMenu={openMenu}>
        <TabIcon tab={tab} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-[#1f1f1f]">{tab.title || '新标签页'}</span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        title="关闭"
        className={tab.active ? '' : 'invisible group-hover:visible'}
        onClick={(event) => {
          event.stopPropagation()
          void window.browser.closeTab(tab.id)
        }}
      >
        <X />
      </Button>
    </div>
  )
}

function TabIcon({ tab }: { tab: TabInfo }) {
  const [broken, setBroken] = useState(false)
  if (tab.favicon && !broken) {
    return <img key={tab.favicon} src={tab.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" onError={() => setBroken(true)} />
  }
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-[#d0d0d0] text-[10px] text-[#3c3c3c]">
      {(tab.title || '新').slice(0, 1)}
    </span>
  )
}
