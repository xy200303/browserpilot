import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronDown, Clock3, Moon, PanelTop, Search, Settings2, Star, X } from 'lucide-react'
import type { AddressSuggestion, LayerPayload, SuggestPayload, TabInfo, UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

export function PopupApp() {
  const [state, setState] = useState<UiState | null>(null)
  const [layer, setLayer] = useState<LayerPayload | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupFor, setGroupFor] = useState<TabInfo | null>(null)
  const [suggestData, setSuggestData] = useState<SuggestPayload | null>(null)
  const layerRef = useRef<LayerPayload | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('popup')
    void window.browser.getState().then(setState)
    void window.browser.currentLayer().then(setLayer)
    const offState = window.browser.onState(setState)
    const offLayer = window.browser.onLayer(setLayer)
    const offSuggest = window.browser.onSuggestData(setSuggestData)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (layerRef.current?.kind === 'suggest') window.browser.hideSuggestions()
      else void window.browser.closeLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offState()
      offLayer()
      offSuggest()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    layerRef.current = layer
  }, [layer])

  const layerKey = layerIdentity(layer)
  useEffect(() => {
    setGroupFor(null)
    setGroupName('')
  }, [layerKey])

  if (!layer) return <div className="h-full" />

  const close = (): void => {
    if (layer?.kind === 'suggest') window.browser.hideSuggestions()
    else void window.browser.closeLayer()
  }

  const dim = layer.kind === 'about' || Boolean(groupFor)

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${dim ? 'bg-black/10' : ''}`}>
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={close} />
      {layer.kind === 'menu' && state && <WindowMenu x={layer.x} y={layer.y} state={state} close={close} />}
      {layer.kind === 'context' && state && !groupFor && (
        <TabMenu x={layer.x} y={layer.y} state={state} tab={layer.tab} close={close} onGroup={() => setGroupFor(layer.tab)} />
      )}
      {layer.kind === 'context' && state && groupFor && (
        <GroupForm state={state} tab={groupFor} name={groupName} setName={setGroupName} close={close} />
      )}
      {layer.kind === 'about' && state && <AboutCard version={state.version} close={close} />}
      {layer.kind === 'tabs' && state && <TabSearch state={state} close={close} />}
      {layer.kind === 'bookmarks' && state && <BookmarksPanel x={layer.x} y={layer.y} state={state} close={close} />}
      {layer.kind === 'suggest' && suggestData && <SuggestionsPanel data={suggestData} />}
      {layer.kind === 'env' && state && <EnvPanel x={layer.x} y={layer.y} envId={layer.envId} state={state} close={close} />}
    </div>
  )
}

function layerIdentity(layer: LayerPayload | null): string {
  if (!layer) return ''
  if (layer.kind === 'context') return `${layer.kind}:${layer.tab.id}`
  return layer.kind
}

async function saveGroup(state: UiState, tab: TabInfo, name: string, close: () => void): Promise<void> {
  const title = name.trim()
  if (!title) return
  const existing = state.groups.find((group) => group.name === title)
  if (existing) {
    await window.browser.assignGroup({ tabId: tab.id, groupId: existing.id })
    close()
    return
  }
  const result = await window.browser.createGroup({ name: title })
  const groupId = (result as { groupId?: string })?.groupId
  if (groupId) await window.browser.assignGroup({ tabId: tab.id, groupId })
  close()
}

function GroupForm({
  state,
  tab,
  name,
  setName,
  close
}: {
  state: UiState
  tab: TabInfo
  name: string
  setName: (value: string) => void
  close: () => void
}) {
  return (
    <form
      className="relative z-10 grid w-80 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
      onMouseDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        void saveGroup(state, tab, name, close)
      }}
    >
      <div>
        <div className="text-base font-medium">加入分组</div>
        <p className="mt-1 text-xs text-muted-foreground">输入分组名称。已有同名分组时，这个标签会放进那一组。</p>
      </div>
      {state.groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {state.groups.map((group) => (
            <Button
              key={group.id}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void window.browser.assignGroup({ tabId: tab.id, groupId: group.id }).finally(close)
              }}
            >
              <span className="size-2 rounded-full" style={{ background: group.color }} />
              {group.name}
            </Button>
          ))}
        </div>
      )}
      <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="分组名称" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>取消</Button>
        <Button type="submit">确定</Button>
      </div>
    </form>
  )
}

function AboutCard({ version, close }: { version: string; close: () => void }) {
  return (
    <div className="relative grid h-full place-items-center" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="relative grid w-80 gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-base font-medium">BrowserPilot</div>
        <div className="text-xs text-muted-foreground">版本 {version}</div>
        <p className="text-sm">给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。</p>
        <div className="flex justify-end">
          <Button type="button" onClick={close}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

function suggestionHighlight(text: string, indices: number[], className: string): ReactNode {
  if (!indices.length) return text
  const nodes: ReactNode[] = []
  let last = 0
  for (const index of indices) {
    if (index < last || index >= text.length) continue
    if (index > last) nodes.push(text.slice(last, index))
    nodes.push(<mark key={index} className={'rounded-sm px-0 text-inherit ' + className}>{text[index]}</mark>)
    last = index + 1
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function suggestionKindLabel(kind: AddressSuggestion['kind']): string {
  if (kind === 'search') return '搜索'
  if (kind === 'bookmark') return '书签'
  if (kind === 'history') return '历史'
  return '标签'
}

function SuggestionsPanel({ data }: { data: SuggestPayload }) {
  return (
    <div className="absolute top-0 overflow-hidden border-b border-neutral-200 bg-white shadow-lg" style={{ left: data.left, width: data.width }}>
      <div className="max-h-[70vh] overflow-y-auto">
        {data.items.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">没有匹配的记录</p>}
        {data.items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={'flex w-full items-center gap-2 px-4 py-2 text-left ' + (index === data.highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50')}
            onClick={() => window.browser.pickSuggestion(item.key)}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {item.kind === 'search' ? (
                <Search size={13} className="text-neutral-500" />
              ) : item.kind === 'bookmark' ? (
                <Star size={13} className="text-amber-500" />
              ) : item.kind === 'history' ? (
                <Clock3 size={13} className="text-neutral-400" />
              ) : item.hibernated ? (
                <Moon size={13} className="text-neutral-400" />
              ) : item.favicon ? (
                <img src={item.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
              ) : (
                <PanelTop size={13} className="text-neutral-400" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-900">{suggestionHighlight(item.title, item.titleIndices, 'bg-amber-100')}</span>
              <span className="block truncate text-xs text-neutral-400">{suggestionHighlight(item.url, item.urlIndices, 'bg-blue-100 text-blue-600')}</span>
            </span>
            <span className="shrink-0 text-[10px] text-neutral-400">{suggestionKindLabel(item.kind)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500">
        <span className="pr-1">筛选搜索：</span>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.history ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('history')}
        ><Clock3 size={12} />历史记录</button>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.bookmarks ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('bookmarks')}
        ><Star size={12} />收藏夹</button>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.tabs ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('tabs')}
        ><PanelTop size={12} />标签页</button>
      </div>
    </div>
  )
}

function EnvPanel({ x, y, envId, state, close }: { x: number; y: number; envId: string; state: UiState; close: () => void }) {
  const env = state.envs.find((item) => item.id === envId)
  const [name, setName] = useState(env?.name ?? '')
  const [remark, setRemark] = useState(env?.remark ?? '')
  const [saving, setSaving] = useState(false)
  const width = 320
  const left = Math.min(Math.max(8, x), window.innerWidth - width - 8)
  const top = Math.min(Math.max(y + 6, 88), Math.max(8, window.innerHeight - 260))

  if (!env) {
    return (
      <div className="absolute z-20 rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-xl" style={{ left, top, width }}>
        找不到这套环境。
      </div>
    )
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = name.trim()
    if (!next) return
    setSaving(true)
    await window.browser.updateEnv({ env: envId, name: next, remark: remark.trim() })
    setSaving(false)
    close()
  }

  return (
    <div className="absolute z-20 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl" style={{ left, top, width }}>
      <form className="grid gap-3 p-3" onSubmit={(event) => void save(event)}>
        <div className="text-sm font-medium">编辑环境</div>
        <label className="grid gap-1 text-xs text-neutral-500">
          名称
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="grid gap-1 text-xs text-neutral-500">
          备注
          <Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="这套环境用来做什么" />
        </label>
        <p className="text-[10px] text-neutral-400">{envId}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>取消</Button>
          <Button type="submit" disabled={!name.trim() || saving}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </div>
  )
}

function BookmarksPanel({ x, y, state, close }: { x: number; y: number; state: UiState; close: () => void }) {
  const width = 320
  const left = Math.max(8, Math.min(x - width, window.innerWidth - width - 8))
  const [folded, setFolded] = useState(false)
  const top = Math.min(y + 6, Math.max(8, window.innerHeight - 360))
  return (
    <div className="absolute z-20 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl" style={{ left, top, width }}>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <Star size={15} className="text-amber-500" />
        <span className="text-sm font-medium">收藏夹</span>
        <span className="text-xs text-neutral-400">{state.bookmarks.length}</span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title="管理书签"
          onClick={() => {
            void window.browser.openBookmarksPage()
            close()
          }}
        >
          <Settings2 />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" title="关闭" onClick={close}><X /></Button>
      </div>
      <button type="button" className="flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm hover:bg-neutral-50" onClick={() => setFolded(!folded)}>
        <ChevronDown size={14} className={`text-neutral-500 transition-transform ${folded ? "-rotate-90" : ""}`} />
        <Star size={14} className="text-amber-500" />
        <span className="font-medium">收藏夹栏</span>
        <span className="text-xs text-neutral-400">{state.bookmarks.length}</span>
      </button>
      {!folded && (
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {state.bookmarks.length === 0 && (
          <div className="px-3 py-8 text-center">
            <Star size={20} className="mx-auto text-neutral-300" />
            <p className="mt-2 text-sm text-neutral-500">还没有收藏的网页</p>
            <p className="mt-1 text-xs text-neutral-400">按 Ctrl+D，或点地址栏右侧的星标。</p>
          </div>
        )}
        {state.bookmarks.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-100"
            title={item.url}
            onClick={() => {
              void window.browser.openBookmark(item.url)
              close()
            }}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {item.favicon ? (
                <img src={item.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
              ) : (
                <Star size={13} className="text-neutral-400" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{item.title || item.url}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  )
}
function TabSearch({ state, close }: { state: UiState; close: () => void }) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  useEffect(() => {
    setHighlight(0)
  }, [query])
  const keyword = query.trim().toLowerCase()
  const tabs = state.tabs.filter(
    (tab) => !keyword || tab.title.toLowerCase().includes(keyword) || tab.url.toLowerCase().includes(keyword)
  )
  const open = (tabId: string): void => {
    void window.browser.activateTab(tabId)
    close()
  }
  return (
    <div className="absolute inset-0 grid place-items-start justify-center bg-black/20 pt-[10vh]" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={close} />
      <div className="relative z-10 w-[min(42rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Search size={16} className="shrink-0 text-neutral-400" />
          <Input
            ref={ref}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标签页"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight((current) => Math.min(current + 1, tabs.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter' && tabs[highlight]) open(tabs[highlight].id)
            }}
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {tabs.length === 0 && <p className="p-4 text-sm text-neutral-500">没有匹配的标签页</p>}
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${index === highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => open(tab.id)}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center">
                {tab.hibernated ? (
                  <Moon size={14} className="text-neutral-400" />
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
                ) : (
                  <span className="grid h-4 w-4 place-items-center rounded-sm bg-neutral-200 text-[9px] text-neutral-500">
                    {(tab.title || '新').slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-900">{tab.title || '新标签页'}</span>
                <span className="block truncate text-xs text-neutral-400">{tab.url}</span>
              </span>
              {tab.active && <span className="shrink-0 text-[10px] text-neutral-400">当前</span>}
            </button>
          ))}
        </div>
        <div className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  )
}

function after(task: Promise<unknown>, close: () => void): void {
  void task.then(() => close())
}

function WindowMenu({ x, y, state, close }: { x: number; y: number; state: UiState; close: () => void }) {
  return (
    <AnchoredMenu x={x} y={y} align="end" className="w-52">
      <DropdownMenuItem onSelect={() => after(window.browser.createEnv({ name: '新环境' }), close)}>新建环境</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.copyEnv(), close)}>复制 Agent 提示词</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.devtools(), close)}>开发者工具</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.toggleScreen(), close)}>{state.screenRecording ? '停止录屏' : '开始录屏'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.openHistoryPage(), close)}>历史记录</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void window.browser.openLayer({ kind: 'bookmarks', x, y })}>书签</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void window.browser.openTabSearch()}>搜索标签页<DropdownMenuShortcut>Ctrl+Shift+A</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.restoreTab(), close)}>重新打开关闭的标签页</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => after(window.browser.openSettings(), close)}>设置</DropdownMenuItem>
    </AnchoredMenu>
  )
}

function TabMenu({
  x,
  y,
  state,
  tab,
  close,
  onGroup
}: {
  x: number
  y: number
  state: UiState
  tab: TabInfo
  close: () => void
  onGroup: () => void
}) {
  const vertical = state.layout === 'left'
  return (
    <AnchoredMenu x={x} y={y} align="start" className="w-72">
      <DropdownMenuItem onSelect={() => { void window.browser.copyTab(tab.id); close() }}>复制标签提示词</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.devtoolsTab(tab.id); close() }}>开发者工具</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.openTabBelow(tab.id); close() }}>在下方新建标签页</DropdownMenuItem>
      <DropdownMenuItem onSelect={onGroup}>将标签页添加到新组</DropdownMenuItem>
      {tab.groupId && <DropdownMenuItem onSelect={() => { void window.browser.assignGroup({ tabId: tab.id, groupId: null }); close() }}>移出分组</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.reloadTab(tab.id); close() }}>刷新<DropdownMenuShortcut>Ctrl+R</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.duplicateTab(tab.id); close() }}>复制标签页<DropdownMenuShortcut>Ctrl+Shift+K</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.pinTab(tab.id); close() }}>{tab.pinned ? '取消固定标签页' : '固定标签页'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.muteTab(tab.id); close() }}>{tab.muted ? '取消标签页静音' : '使标签页静音'}<DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem disabled={tab.hibernated || tab.kind !== 'page' || tab.active} onSelect={() => { void window.browser.hibernateTab(tab.id); close() }}>休眠标签页</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.hibernateOtherTabs(); close() }}>休眠其他标签页</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.closeTab(tab.id); close() }}>关闭标签页<DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeOtherTabs(tab.id); close() }}>关闭其他标签页</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeTabsBelow(tab.id); close() }}>关闭以下标签页</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.restoreTab(); close() }}>重新打开关闭的标签页<DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.updateSettings({ tabLayout: vertical ? 'top' : 'left' }); close() }}>{vertical ? '关闭垂直标签页' : '打开垂直标签页'}<DropdownMenuShortcut>Ctrl+Shift+,</DropdownMenuShortcut></DropdownMenuItem>
    </AnchoredMenu>
  )
}

function AnchoredMenu({
  x,
  y,
  align,
  className,
  children
}: {
  x: number
  y: number
  align: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <span className="fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
