import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, FolderOpen, Minus, MoreVertical, Plus, RotateCw, Square, Volume2, VolumeX, Workflow, X } from 'lucide-react'
import { searchEngineOf, type DownloadItem, type TabInfo, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { MarketPage } from './MarketPage'
import { SettingsPage } from './Settings'
import { WorkflowEditor } from './Workflow'
import { workflowPage } from '../../shared/market'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DownloadsPage } from './DownloadsPage'
import { RunsPage } from './RunsPage'

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
    const offFocus = window.browser.onFocusAddress(() => addressRef.current?.focus())
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
    if (active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow' || active?.kind === 'downloads' || active?.kind === 'runs') setAddress('')
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
  if (active?.kind === 'workflow') return active.title
  return `在${engineName}中搜索，或输入网址`
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
  const builtin = active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow' || active?.kind === 'downloads' || active?.kind === 'runs'
  return (
    <div className="flex h-12 items-center gap-1 bg-[#f3f3f3] px-2">
      <Button variant="ghost" size="icon" className="no-drag" title="后退" disabled={!state.canBack} onClick={() => void window.browser.back()}><ArrowLeft /></Button>
      <Button variant="ghost" size="icon" className="no-drag" title="前进" disabled={!state.canForward} onClick={() => void window.browser.forward()}><ArrowRight /></Button>
      <Button variant="ghost" size="icon" className="no-drag" title="刷新" onClick={() => {
        if (active?.loading) {
          void window.browser.stop()
          return
        }
        if (active && active.kind !== 'page') onReloadBuiltin(active.id)
        else void window.browser.reload()
      }}><RotateCw className={active?.loading ? 'animate-spin' : ''} /></Button>
      <form
        className="mx-1 flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void window.browser.navigate(address)
        }}
      >
        {!builtin && <SearchEngineIcon id={state.settings.searchEngine} />}
        <Input
          ref={addressRef}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={addressPlaceholder(active, searchEngineOf(state.settings.searchEngine).name)}
          readOnly={builtin}
        />
      </form>
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

function PageSurface({ state, active, contentRef, reloadKey }: { state: UiState; active: TabInfo | undefined; contentRef: RefObject<HTMLDivElement | null>; reloadKey: number }) {
  return (
    <div className="flex min-h-0 flex-1">
      {state.layout === 'left' && <div className={`shrink-0 bg-[#f3f3f3] ${state.railPinned ? 'w-64' : 'w-12'}`} />}
      <div className="relative min-w-0 flex-1 bg-white">
        <div ref={contentRef} className="absolute inset-0" />
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

