import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, ChevronLeft, ChevronRight, Clock3, Download, FolderOpen, Minus, Moon, MoreVertical, Plus, RotateCw, Square, Star, TriangleAlert, Volume2, VolumeX, Workflow, X } from 'lucide-react'
import { searchEngineOf, type DownloadItem, type HistoryEntry, type TabInfo, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { MarketPage } from './MarketPage'
import { SettingsPage } from './Settings'
import { WorkflowEditor } from './Workflow'
import { workflowPage } from '../../shared/market'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DownloadsPage } from './DownloadsPage'
import { RunsPage } from './RunsPage'
import { HistoryPage } from './HistoryPage'
import { BookmarksPage } from './BookmarksPage'

let recorder: MediaRecorder | null = null
let recordChunks: Blob[] = []
let recordMime = 'video/mp4'
let recordPreview: HTMLVideoElement | null = null

function pickMime(): string | null {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export function App() {
  const [state, setState] = useState<UiState | null>(null)
  const [address, setAddress] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const active = state?.tabs.find((tab) => tab.active)
  const bumpReload = (tabId: string): void => {
    setReloads((current) => ({ ...current, [tabId]: (current[tabId] ?? 0) + 1 }))
  }

  useEffect(() => {
    void window.browser.getState().then(setState)
    const offState = window.browser.onState(setState)
    const offFocus = window.browser.onFocusAddress(() => {
      addressRef.current?.focus()
      addressRef.current?.select()
    })
    const offFind = window.browser.onOpenFind(() => setFindOpen(true))
    const offClose = window.browser.onCloseFind(() => setFindOpen(false))
    const offReload = window.browser.onBuiltinReload?.((tabId) => {
      setReloads((current) => ({ ...current, [tabId]: (current[tabId] ?? 0) + 1 }))
    }) ?? (() => undefined)
    const offStart = window.browser.onScreenStart(async () => {
      try {
        const mime = pickMime()
        if (!mime) throw new Error('这次没能写成 mp4')
        recordMime = mime
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
        // 这条轨道不接到一个正在播放的 video 上时，录出来是空的。
        recordPreview = document.createElement('video')
        recordPreview.srcObject = stream
        recordPreview.muted = true
        recordPreview.playsInline = true
        recordPreview.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'
        document.body.appendChild(recordPreview)
        await recordPreview.play()
        recordChunks = []
        recorder = new MediaRecorder(stream, { mimeType: mime })
        recorder.ondataavailable = (event) => {
          if (event.data.size) recordChunks.push(event.data)
        }
        recorder.onstop = async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          const blob = new Blob(recordChunks, { type: recordMime })
          const data = new Uint8Array(await blob.arrayBuffer())
          stream.getTracks().forEach((track) => track.stop())
          recordPreview?.remove()
          recordPreview = null
          await window.browser.saveScreen(data, data.byteLength ? recordMime : 'empty')
          recorder = null
          recordChunks = []
        }
        recorder.start(200)
        await window.browser.screenReady()
      } catch (error) {
        const failed = recorder
        recorder = null
        failed?.stream.getTracks().forEach((track) => track.stop())
        recordPreview?.remove()
        recordPreview = null
        const message = error instanceof Error ? error.message : '录屏没有开始'
        await window.browser.screenFailed(message)
      }
    })
    const offStop = window.browser.onScreenStop(() => {
      if (recorder && recorder.state === 'recording') {
        recorder.requestData()
        recorder.stop()
      }
    })
    return () => {
      offState()
      offFocus()
      offFind()
      offClose()
      offReload()
      offStart()
      offStop()
    }
  }, [])

  useEffect(() => {
    if (active?.kind === 'page') setAddress(active.url.startsWith('data:') ? '' : active.url)
    if (active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow' || active?.kind === 'downloads' || active?.kind === 'runs' || active?.kind === 'history' || active?.kind === 'bookmarks') setAddress('')
  }, [active?.id, active?.url, active?.kind])

  useEffect(() => {
    const node = contentRef.current
    if (!node) return
    const send = (): void => {
      const rect = node.getBoundingClientRect()
      void window.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    send()
    const observer = new ResizeObserver(send)
    observer.observe(node)
    window.addEventListener('resize', send)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [state?.layout, state?.railPinned, active?.kind, findOpen, state?.handoffMessage])

  if (!state) return <div className="h-full bg-white" />

  return (
    <div className="flex h-full flex-col">
      <TitleRow state={state} />
      <AddressBar state={state} active={active} address={address} setAddress={setAddress} addressRef={addressRef} onReloadBuiltin={bumpReload} />
      {state.handoffMessage && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-900">{state.handoffMessage}</div>}
      {findOpen && <FindBar findText={findText} setFindText={setFindText} setFindOpen={setFindOpen} />}
      <PageSurface state={state} active={active} contentRef={contentRef} reloadKey={active ? reloads[active.id] ?? 0 : 0} />
    </div>
  )
}

function TabStrip({ state }: { state: UiState }) {
  const pinnedTabs = state.tabs.filter((tab) => tab.pinned)
  const looseTabs = state.tabs.filter((tab) => !tab.pinned && !tab.groupId)
  const stripRef = useRef<HTMLDivElement>(null)
  const orderedTabs = [
    ...pinnedTabs,
    ...state.groups.flatMap((group) => state.tabs.filter((tab) => tab.groupId === group.id && !tab.pinned)),
    ...looseTabs
  ]
  const lastTabId = orderedTabs.length ? orderedTabs[orderedTabs.length - 1].id : ''
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const update = (): void => {
      setCanLeft(el.scrollLeft > 1)
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update)
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [state.tabs, state.groups])
  const scrollStrip = (delta: number): void => {
    stripRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }
  return (
    <div className="flex min-w-0 flex-1 items-end">
      {canLeft && (
        <Button variant="ghost" size="icon" className="no-drag mb-0 h-7 w-5 shrink-0 rounded-full" title="向左滚动" onClick={() => scrollStrip(-240)}>
          <ChevronLeft />
        </Button>
      )}
      <div
        ref={stripRef}
        className="drag flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          const el = stripRef.current
          if (!el || event.deltaY === 0) return
          el.scrollLeft += event.deltaY
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const tabId = event.dataTransfer.getData('text/plain')
          if (tabId) void window.browser.assignGroup({ tabId, groupId: null })
        }}
      >
        {pinnedTabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} hideDivider={tab.id === lastTabId} />
        ))}
        {state.groups.map((group) => {
          const members = state.tabs.filter((tab) => tab.groupId === group.id && !tab.pinned)
          return (
            <div
              key={group.id}
              className="no-drag mb-0 flex items-end gap-1 rounded-t-lg px-1"
              style={{ boxShadow: `inset 0 -2px 0 ${group.color}` }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation()
                const tabId = event.dataTransfer.getData('text/plain')
                if (tabId) void window.browser.assignGroup({ tabId, groupId: group.id })
              }}
            >
              <span className="mb-1 max-w-16 truncate px-1 text-xs" style={{ color: group.color }}>{group.name}</span>
              {members.map((tab) => (
                <TabButton key={tab.id} tab={tab} hideDivider={tab.id === lastTabId} />
              ))}
            </div>
          )
        })}
        {looseTabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} hideDivider={tab.id === lastTabId} />
        ))}
      </div>
      {canRight && (
        <Button variant="ghost" size="icon" className="no-drag mb-0 h-7 w-5 shrink-0 rounded-full" title="向右滚动" onClick={() => scrollStrip(240)}>
          <ChevronRight />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="no-drag shrink-0" title="新标签" onClick={() => void window.browser.newTab()}>
        <Plus />
      </Button>
    </div>
  )
}

function WindowButtons({ maximized }: { maximized: boolean }) {
  return (
    <div className="no-drag flex shrink-0">
      <Button variant="ghost" className="h-10 w-12 rounded-none" title="最小化" onClick={() => void window.browser.minimize()}><Minus /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none" title={maximized ? '还原' : '最大化'} onClick={() => void window.browser.toggleMaximize()}><Square /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none hover:bg-destructive hover:text-white" title="关闭" onClick={() => void window.browser.closeWindow()}><X /></Button>
    </div>
  )
}

function TitleRow({ state }: { state: UiState }) {
  const buttons = <WindowButtons maximized={state.maximized} />
  if (state.layout === 'left') {
    return (
      <div className="drag flex h-10 items-center bg-[#f3f3f3] pl-3" onDoubleClick={() => void window.browser.toggleMaximize()}>
        <span className="drag pointer-events-none truncate text-sm text-neutral-600">{state.envName}</span>
        <div className="drag h-full min-w-8 flex-1" />
        {buttons}
      </div>
    )
  }
  return (
    <div className="drag flex h-10 items-end bg-[#f3f3f3] pl-2" onDoubleClick={() => void window.browser.toggleMaximize()}>
      <TabStrip state={state} />
      <div className="drag h-full w-3 shrink-0" />
      <span className="drag pointer-events-none max-w-32 self-center truncate px-2 text-sm text-neutral-500">{state.envName}</span>
      {buttons}
    </div>
  )
}

function addressPlaceholder(active: TabInfo | undefined, engineName: string): string {
  if (active?.kind === 'market') return '工作流'
  if (active?.kind === 'settings') return '设置'
  if (active?.kind === 'downloads') return '下载'
  if (active?.kind === 'runs') return '运行记录'
  if (active?.kind === 'history') return '历史记录'
  if (active?.kind === 'bookmarks') return '书签'
  if (active?.kind === 'workflow') return active.title
  return `在${engineName}中搜索，或输入网址`
}

function LoadProgress({ tab }: { tab: TabInfo | undefined }) {
  const [width, setWidth] = useState(0)
  const loading = Boolean(tab?.loading)
  useEffect(() => {
    if (!loading) {
      setWidth(100)
      const timer = setTimeout(() => setWidth(0), 260)
      return () => clearTimeout(timer)
    }
    setWidth(Math.max(8, tab?.progress ?? 0))
    const timer = setInterval(() => {
      setWidth((current) => (current >= 90 ? current : Math.min(90, current + Math.max(1.5, (90 - current) * 0.12))))
    }, 200)
    return () => clearInterval(timer)
  }, [loading, tab?.id, tab?.progress])
  return (
    <div className={`nav-progress ${loading ? 'active' : ''}`} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </div>
  )
}

function AddressBar({
  state,
  active,
  address,
  setAddress,
  addressRef,
  onReloadBuiltin
}: {
  state: UiState
  active: TabInfo | undefined
  address: string
  setAddress: (value: string) => void
  addressRef: RefObject<HTMLInputElement | null>
  onReloadBuiltin: (tabId: string) => void
}) {
  const builtin = active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow' || active?.kind === 'downloads' || active?.kind === 'runs' || active?.kind === 'history' || active?.kind === 'bookmarks'
  const bookmarked = active?.kind === 'page' && state.bookmarks.some((item) => item.url === active.url)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const suggestions = useMemo(() => {
    const keyword = address.trim().toLowerCase()
    const source = [
      ...state.bookmarks.map((item) => ({ key: `bm:${item.id}`, title: item.title || item.url, url: item.url, favicon: item.favicon, kind: 'bookmark' as const })),
      ...history.map((item) => ({ key: `h:${item.id}`, title: item.title || item.url, url: item.url, favicon: item.favicon, kind: 'history' as const }))
    ]
    const seen = new Set<string>()
    const filtered = source.filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      if (!keyword) return true
      return item.title.toLowerCase().includes(keyword) || item.url.toLowerCase().includes(keyword)
    })
    if (!keyword) return filtered.slice(0, 7)
    const score = (item: (typeof filtered)[number]): number =>
      (item.url.toLowerCase().startsWith(keyword) ? 3 : 0) +
      (item.title.toLowerCase().startsWith(keyword) ? 2 : 0) +
      (item.kind === 'bookmark' ? 1 : 0)
    return filtered.sort((a, b) => score(b) - score(a)).slice(0, 7)
  }, [address, history, state.bookmarks])

  const loadHistory = (): void => {
    void window.browser.listHistory().then(setHistory).catch(() => undefined)
  }
  const choose = (url: string): void => {
    setAddress(url)
    setSuggestOpen(false)
    setHighlight(-1)
    void window.browser.navigate(url)
  }

  useEffect(() => {
    setSuggestOpen(false)
    setHighlight(-1)
  }, [active?.id, active?.url])

  return (
    <>
      <div className="relative flex h-12 items-center gap-1 bg-[#f3f3f3] px-2">
        <Button variant="ghost" size="icon" className="no-drag" title="后退" disabled={!state.canBack} onClick={() => void window.browser.back()}><ArrowLeft /></Button>
        <Button variant="ghost" size="icon" className="no-drag" title="前进" disabled={!state.canForward} onClick={() => void window.browser.forward()}><ArrowRight /></Button>
        <Button variant="ghost" size="icon" className="no-drag" title={active?.loading ? '停止加载' : '刷新'} onClick={() => {
          if (active?.loading) {
            void window.browser.stop()
            return
          }
          if (active && active.kind !== 'page') onReloadBuiltin(active.id)
          else void window.browser.reload()
        }}>{active?.loading ? <X /> : <RotateCw />}</Button>
        <form
          className="mx-1 flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (highlight >= 0 && suggestions[highlight]) {
              choose(suggestions[highlight].url)
              return
            }
            setSuggestOpen(false)
            void window.browser.navigate(address)
          }}
        >
          {!builtin && <SearchEngineIcon id={state.settings.searchEngine} />}
          <Input
            ref={addressRef}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setHighlight(-1)
              if (!builtin) setSuggestOpen(true)
            }}
            onFocus={(event) => {
              event.currentTarget.select()
              if (builtin) return
              loadHistory()
              setSuggestOpen(true)
            }}
            onBlur={() => {
              setTimeout(() => setSuggestOpen(false), 120)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSuggestOpen(true)
                setHighlight((current) => Math.min(current + 1, suggestions.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((current) => Math.max(current - 1, -1))
                return
              }
              if (event.key === 'Escape') {
                setSuggestOpen(false)
                setHighlight(-1)
                return
              }
              if (event.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
                event.preventDefault()
                choose(suggestions[highlight].url)
              }
            }}
            placeholder={addressPlaceholder(active, searchEngineOf(state.settings.searchEngine).name)}
            readOnly={builtin}
          />
        </form>
        <LoadProgress tab={active} />
        <Button variant="ghost" size="icon" className="no-drag" title={bookmarked ? '取消书签' : '添加书签'} onClick={() => void window.browser.toggleBookmark()}><Star fill={bookmarked ? 'currentColor' : 'none'} className={bookmarked ? 'text-amber-500' : ''} /></Button>
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          title="收藏夹"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.browser.openLayer({ kind: 'bookmarks', x: rect.right, y: rect.bottom })
          }}
        >
          <Bookmark />
        </Button>
        <Button variant="ghost" size="icon" className="no-drag relative" title="下载" onClick={() => void window.browser.openDownloads()}><Download />{state.downloads.some((d) => d.state === 'progressing') && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-blue-600" />}</Button>
        <Button variant="ghost" className="no-drag" title="工作流" onClick={() => void window.browser.openMarket()}><Workflow />工作流</Button>
        {state.screenRecording && <span className="rounded-md bg-destructive px-1.5 py-0.5 text-xs text-white">录屏</span>}
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          title="菜单"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.browser.openLayer({ kind: 'menu', x: rect.right, y: rect.bottom })
          }}
        >
          <MoreVertical />
        </Button>
      </div>
      {suggestOpen && !builtin && suggestions.length > 0 && (
        <div
          className="mx-2 max-h-72 overflow-y-auto overflow-x-hidden rounded-b-lg border border-t-0 border-neutral-200 bg-white shadow-sm"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(item.url)}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center">
                {item.kind === 'bookmark' ? <Star size={13} className="text-amber-500" /> : <Clock3 size={13} className="text-neutral-400" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-900">{item.title}</span>
                <span className="block truncate text-xs text-neutral-400">{item.url}</span>
              </span>
              <span className="shrink-0 text-[10px] text-neutral-400">{item.kind === 'bookmark' ? '书签' : '历史'}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function FindBar({
  findText,
  setFindText,
  setFindOpen
}: {
  findText: string
  setFindText: (value: string) => void
  setFindOpen: (open: boolean) => void
}) {
  return (
    <form
      className="flex items-center gap-2 bg-white px-3 py-1"
      onSubmit={(event) => {
        event.preventDefault()
        void window.browser.find(findText)
      }}
    >
      <Input value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="在当前页查找" />
      <Button type="submit" size="sm">查找</Button>
      <Button type="button" variant="ghost" size="icon-sm" title="关闭查找" onClick={() => { setFindOpen(false); void window.browser.stopFind() }}><X /></Button>
    </form>
  )
}

function errorTitle(error: NonNullable<TabInfo['error']>): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '网络连接已断开'
  if (error.code === -105) return '找不到这个网站'
  if (error.code === -102) return '连接被拒绝'
  if (error.code === -118 || error.code === -7) return '连接超时'
  if (error.code <= -200 && error.code >= -207) return '证书有问题'
  return '无法访问此网站'
}

function errorHint(code: number, description: string): string {
  if (code === -106) return '检查网线、Wi-Fi 或代理设置，然后重试。'
  if (code === -105) return '检查网址拼写，或确认域名是否仍然存在。'
  if (code === -102) return '目标服务器拒绝了连接，可能服务没有启动或端口不对。'
  if (code === -118 || code === -7) return '服务器没有在预期时间内响应，稍后重试。'
  if (code <= -200 && code >= -207) return '网站证书无法验证。不要在这种页面输入密码或支付信息。'
  if (code === -21) return '网络连接发生了变化，重试通常可以恢复。'
  return description || '页面加载失败，可以重试或返回上一页。'
}

function PageSurface({ state, active, contentRef, reloadKey }: { state: UiState; active: TabInfo | undefined; contentRef: RefObject<HTMLDivElement | null>; reloadKey: number }) {
  return (
    <div className="flex min-h-0 flex-1">
      {state.layout === 'left' && <div className={`shrink-0 bg-[#f3f3f3] ${state.railPinned ? 'w-64' : 'w-12'}`} />}
      <div className="relative min-w-0 flex-1 bg-white">
        <div ref={contentRef} className="absolute inset-0" />
        {active?.kind === 'page' && active.error && (
          <div className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-white px-6">
            <div className="w-full max-w-lg text-center">
              <TriangleAlert size={40} className="mx-auto text-neutral-300" />
              <h1 className="mt-4 text-xl font-semibold text-neutral-900">{errorTitle(active.error)}</h1>
              <p className="mt-2 text-sm text-neutral-500">{errorHint(active.error.code, active.error.description)}</p>
              <p className="mt-4 break-all rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-500">{active.error.url}</p>
              <p className="mt-2 text-xs text-neutral-400">错误代码 {active.error.code}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button type="button" onClick={() => void window.browser.reload()}>重试</Button>
                {state.canBack && <Button type="button" variant="outline" onClick={() => void window.browser.back()}>返回上一页</Button>}
              </div>
            </div>
          </div>
        )}
        {active?.kind === 'market' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <MarketPage key={reloadKey} state={state} />
          </div>
        )}
        {active?.kind === 'downloads' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <DownloadsPage key={reloadKey} state={state} />
          </div>
        )}
        {active?.kind === 'runs' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <RunsPage key={reloadKey} state={state} tabUrl={active.url} />
          </div>
        )}
        {active?.kind === 'history' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <HistoryPage key={reloadKey} />
          </div>
        )}
        {active?.kind === 'bookmarks' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <BookmarksPage key={reloadKey} state={state} />
          </div>
        )}
        {active?.kind === 'settings' && (
          <div className="absolute inset-0 overflow-hidden bg-white">
            <SettingsPage key={reloadKey} state={state} />
          </div>
        )}
        {active?.kind === 'workflow' && (
          <div className="absolute inset-0 flex overflow-hidden bg-white p-4">
            <div className="min-h-0 min-w-0 flex-1">
              <WorkflowPage key={reloadKey} state={state} tab={active} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowPage({ state, tab }: { state: UiState; tab: TabInfo }) {
  const workflow = state.workflows.find((item) => workflowPage(item.id) === tab.url)
  if (!workflow) {
    return (
      <div className="grid content-start gap-3">
        <p className="text-sm">没有这个工作流。</p>
        <div>
          <Button type="button" onClick={() => void window.browser.closeTab(tab.id)}>关闭</Button>
        </div>
      </div>
    )
  }
  return <WorkflowEditor workflow={workflow} onBack={() => void window.browser.closeTab(tab.id)} />
}

function TabIcon({ tab }: { tab: TabInfo }) {
  const [broken, setBroken] = useState(false)
  if (tab.hibernated) return <Moon size={15} className="shrink-0 text-neutral-400" />
  if (tab.favicon && !broken) {
    return <img key={tab.favicon} src={tab.favicon} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" onError={() => setBroken(true)} />
  }
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-[#d0d0d0] text-[10px] text-[#3c3c3c]">
      {(tab.title || '新').slice(0, 1)}
    </span>
  )
}

function TabButton({ tab, hideDivider }: { tab: TabInfo; hideDivider?: boolean }) {
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    void window.browser.openLayer({ kind: 'context', x: event.clientX, y: event.clientY, tab })
  }
  return (
    <div
      draggable
      className={`no-drag relative mb-0 flex h-8 max-w-56 min-w-28 shrink-0 items-center gap-2 rounded-t-lg px-3 ${tab.active ? 'bg-white' : 'hover:bg-black/5'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {tab.audible ? (
        <button
          type="button"
          className="grid h-4 w-4 shrink-0 place-items-center text-neutral-500 hover:text-neutral-900"
          title={tab.muted ? '取消静音' : '静音'}
          onClick={(event) => {
            event.stopPropagation()
            void window.browser.muteTab(tab.id)
          }}
        >
          {tab.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <TabIcon tab={tab} />
      )}
      <button type="button" className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm" onClick={() => void window.browser.activateTab(tab.id)} onContextMenu={openMenu}>
        {tab.title || '新标签页'}
      </button>
      {!hideDivider && <span className="pointer-events-none absolute -right-1 top-1/2 h-4 w-px -translate-y-1/2 bg-neutral-300" />}
      <Button
        variant="ghost"
        size="icon-xs"
        title="关闭"
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

