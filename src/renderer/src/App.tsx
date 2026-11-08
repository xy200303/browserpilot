import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import i18n, { applyLanguage } from './i18n'
import { ChevronLeft, ChevronRight, Minus, Moon, Plus, Square, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react'
import type { LanguageSetting, TabInfo, UiState } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { workflowPage } from '../../shared/market'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AddressBar } from './AddressBar'

// 页面按需加载：工作流编辑器带着 @xyflow（约 360KB），不该在启动时就解析
const MarketPage = lazy(() => import('./MarketPage').then((mod) => ({ default: mod.MarketPage })))
const SettingsPage = lazy(() => import('./Settings').then((mod) => ({ default: mod.SettingsPage })))
const WorkflowEditor = lazy(() => import('./Workflow').then((mod) => ({ default: mod.WorkflowEditor })))
const DownloadsPage = lazy(() => import('./DownloadsPage').then((mod) => ({ default: mod.DownloadsPage })))
const RunsPage = lazy(() => import('./RunsPage').then((mod) => ({ default: mod.RunsPage })))
const HistoryPage = lazy(() => import('./HistoryPage').then((mod) => ({ default: mod.HistoryPage })))
const BookmarksPage = lazy(() => import('./BookmarksPage').then((mod) => ({ default: mod.BookmarksPage })))

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
  const [language, setLanguage] = useState<LanguageSetting>('auto')
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
    applyLanguage(language)
  }, [language])

  useEffect(() => {
    void window.browser.getState().then((next) => {
      setState(next)
      if (next) setLanguage(next.settings.language ?? 'auto')
    })
    const offState = window.browser.onState((next) => {
      if (!next) return
      setState(next)
      setLanguage(next.settings.language ?? 'auto')
    })
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
        if (!mime) throw new Error(i18n.t('shell.screen.noMp4'))
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
        const message = error instanceof Error ? error.message : i18n.t('shell.screen.notStarted')
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
  const { t } = useTranslation()
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
        <Button variant="ghost" size="icon" className="no-drag mb-0 h-7 w-5 shrink-0 rounded-full" title={t('shell.tabs.scrollLeft')} onClick={() => scrollStrip(-240)}>
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
        <Button variant="ghost" size="icon" className="no-drag mb-0 h-7 w-5 shrink-0 rounded-full" title={t('shell.tabs.scrollRight')} onClick={() => scrollStrip(240)}>
          <ChevronRight />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="no-drag shrink-0" title={t('shell.tabs.new')} onClick={() => void window.browser.newTab()}>
        <Plus />
      </Button>
    </div>
  )
}

function WindowButtons({ maximized }: { maximized: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="no-drag flex shrink-0">
      <Button variant="ghost" className="h-10 w-12 rounded-none" title={t('shell.window.minimize')} onClick={() => void window.browser.minimize()}><Minus /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none" title={maximized ? t('shell.window.restore') : t('shell.window.maximize')} onClick={() => void window.browser.toggleMaximize()}><Square /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none hover:bg-destructive hover:text-white" title={t('shell.window.close')} onClick={() => void window.browser.closeWindow()}><X /></Button>
    </div>
  )
}

function EnvNameButton({ state, className }: { state: UiState; className: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={'no-drag truncate rounded px-2 text-sm text-neutral-500 hover:bg-black/5 ' + className}
      title={t('shell.env.editTitle')}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        void window.browser.openLayer({ kind: 'env', envId: state.envId, x: rect.left, y: rect.bottom })
      }}
    >
      {state.envName}
    </button>
  )
}

function TitleRow({ state }: { state: UiState }) {
  const buttons = <WindowButtons maximized={state.maximized} />
  if (state.layout === 'left') {
    return (
      <div className="drag flex h-10 items-center bg-[#f3f3f3] pl-3" onDoubleClick={() => void window.browser.toggleMaximize()}>
        <EnvNameButton state={state} className="max-w-48" />
        <div className="drag h-full min-w-8 flex-1" />
        {buttons}
      </div>
    )
  }
  return (
    <div className="drag flex h-10 items-end bg-[#f3f3f3] pl-2" onDoubleClick={() => void window.browser.toggleMaximize()}>
      <TabStrip state={state} />
      <div className="drag h-full w-3 shrink-0" />
      <EnvNameButton state={state} className="max-w-32 self-center" />
      {buttons}
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
  const { t } = useTranslation()
  return (
    <form
      className="flex items-center gap-2 bg-white px-3 py-1"
      onSubmit={(event) => {
        event.preventDefault()
        void window.browser.find(findText)
      }}
    >
      <Input value={findText} onChange={(event) => setFindText(event.target.value)} placeholder={t('shell.find.placeholder')} />
      <Button type="submit" size="sm">{t('shell.find.action')}</Button>
      <Button type="button" variant="ghost" size="icon-sm" title={t('shell.find.close')} onClick={() => { setFindOpen(false); void window.browser.stopFind() }}><X /></Button>
    </form>
  )
}

function errorTitle(error: NonNullable<TabInfo['error']>): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return i18n.t('shell.error.offline')
  if (error.code === -105) return i18n.t('shell.error.notFound')
  if (error.code === -102) return i18n.t('shell.error.refused')
  if (error.code === -118 || error.code === -7) return i18n.t('shell.error.timeout')
  if (error.code <= -200 && error.code >= -207) return i18n.t('shell.error.cert')
  return i18n.t('shell.error.generic')
}

function errorHint(code: number, description: string): string {
  if (code === -106) return i18n.t('shell.error.hint.offline')
  if (code === -105) return i18n.t('shell.error.hint.notFound')
  if (code === -102) return i18n.t('shell.error.hint.refused')
  if (code === -118 || code === -7) return i18n.t('shell.error.hint.timeout')
  if (code <= -200 && code >= -207) return i18n.t('shell.error.hint.cert')
  if (code === -21) return i18n.t('shell.error.hint.changed')
  return description || i18n.t('shell.error.hint.fallback')
}

function PageSurface({ state, active, contentRef, reloadKey }: { state: UiState; active: TabInfo | undefined; contentRef: RefObject<HTMLDivElement | null>; reloadKey: number }) {
  const { t } = useTranslation()
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
              <p className="mt-2 text-xs text-neutral-400">{t('shell.error.code', { code: active.error.code })}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button type="button" onClick={() => void window.browser.reload()}>{t('shell.error.retry')}</Button>
                {state.canBack && <Button type="button" variant="outline" onClick={() => void window.browser.back()}>{t('shell.error.back')}</Button>}
              </div>
            </div>
          </div>
        )}
        <Suspense fallback={null}>
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
        </Suspense>
      </div>
    </div>
  )
}

function WorkflowPage({ state, tab }: { state: UiState; tab: TabInfo }) {
  const { t } = useTranslation()
  const workflow = state.workflows.find((item) => workflowPage(item.id) === tab.url)
  if (!workflow) {
    return (
      <div className="grid content-start gap-3">
        <p className="text-sm">{t('shell.workflow.missing')}</p>
        <div>
          <Button type="button" onClick={() => void window.browser.closeTab(tab.id)}>{t('shell.common.close')}</Button>
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
      {(tab.title || i18n.t('shell.tabs.untitledShort')).slice(0, 1)}
    </span>
  )
}

function TabButton({ tab, hideDivider }: { tab: TabInfo; hideDivider?: boolean }) {
  const { t } = useTranslation()
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
          title={tab.muted ? t('shell.tabs.unmute') : t('shell.tabs.mute')}
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
        {tab.title || t('shell.tabs.untitled')}
      </button>
      {!hideDivider && <span className="pointer-events-none absolute -right-1 top-1/2 h-4 w-px -translate-y-1/2 bg-neutral-300" />}
      <Button
        variant="ghost"
        size="icon-xs"
        title={t('shell.tabs.close')}
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

