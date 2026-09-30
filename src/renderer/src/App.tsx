import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, Minus, MoreVertical, Plus, RotateCw, Square, X } from 'lucide-react'
import { searchEngineOf, type TabInfo, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  const active = state?.tabs.find((tab) => tab.active)

  useEffect(() => {
    void window.browser.getState().then(setState)
    const offState = window.browser.onState(setState)
    const offFocus = window.browser.onFocusAddress(() => addressRef.current?.focus())
    const offFind = window.browser.onOpenFind(() => setFindOpen(true))
    const offClose = window.browser.onCloseFind(() => setFindOpen(false))
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
      offStart()
      offStop()
    }
  }, [])

  useEffect(() => {
    if (active?.kind === 'page') setAddress(active.url.startsWith('data:') ? '' : active.url)
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

  const vertical = state.layout === 'left'

  const pinnedTabs = state.tabs.filter((tab) => tab.pinned)
  const looseTabs = state.tabs.filter((tab) => !tab.pinned && !tab.groupId)
  const tabs = (
    <div
      className="drag flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const tabId = event.dataTransfer.getData('text/plain')
        if (tabId) void window.browser.assignGroup({ tabId, groupId: null })
      }}
    >
      {pinnedTabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} />
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
              <TabButton key={tab.id} tab={tab} />
            ))}
          </div>
        )
      })}
      {looseTabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} />
      ))}
      <Button variant="ghost" size="icon" className="no-drag" title="新标签" onClick={() => void window.browser.newTab()}>
        <Plus />
      </Button>
    </div>
  )

  const caption = (
    <div className="no-drag flex shrink-0">
      <Button variant="ghost" className="h-10 w-12 rounded-none" title="最小化" onClick={() => void window.browser.minimize()}><Minus /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none" title={state.maximized ? '还原' : '最大化'} onClick={() => void window.browser.toggleMaximize()}><Square /></Button>
      <Button variant="ghost" className="h-10 w-12 rounded-none hover:bg-destructive hover:text-white" title="关闭" onClick={() => void window.browser.closeWindow()}><X /></Button>
    </div>
  )

  const toolbar = (
    <div className="flex h-12 items-center gap-1 bg-[#f3f3f3] px-2">
      <Button variant="ghost" size="icon" className="no-drag" title="后退" disabled={!state.canBack} onClick={() => void window.browser.back()}><ArrowLeft /></Button>
      <Button variant="ghost" size="icon" className="no-drag" title="前进" disabled={!state.canForward} onClick={() => void window.browser.forward()}><ArrowRight /></Button>
      <Button variant="ghost" size="icon" className="no-drag" title="刷新" onClick={() => void (active?.loading ? window.browser.stop() : window.browser.reload())}><RotateCw className={active?.loading ? 'animate-spin' : ''} /></Button>
      <form
        className="mx-1 flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void window.browser.navigate(address)
        }}
      >
        <SearchEngineIcon id={state.settings.searchEngine} />
        <Input
          ref={addressRef}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={`在${searchEngineOf(state.settings.searchEngine).name}中搜索，或输入网址`}
        />
      </form>
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

  return (
    <div className="flex h-full flex-col">
      {vertical ? (
        <div className="drag flex h-10 items-center bg-[#f3f3f3] pl-3" onDoubleClick={() => void window.browser.toggleMaximize()}>
          <span className="drag pointer-events-none truncate text-sm text-neutral-600">{state.envName}</span>
          <div className="drag h-full min-w-8 flex-1" />
          {caption}
        </div>
      ) : (
        <div className="drag flex h-10 items-end bg-[#f3f3f3] pl-2" onDoubleClick={() => void window.browser.toggleMaximize()}>
          {tabs}
          <div className="drag h-full w-3 shrink-0" />
          <span className="drag pointer-events-none max-w-32 self-center truncate px-2 text-sm text-neutral-500">{state.envName}</span>
          {caption}
        </div>
      )}
      {toolbar}
      {state.handoffMessage && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-900">{state.handoffMessage}</div>}
      {findOpen && (
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
      )}
      <div className="flex min-h-0 flex-1">
        {vertical && <div className={`shrink-0 bg-[#f3f3f3] ${state.railPinned ? 'w-64' : 'w-12'}`} />}
        <div ref={contentRef} className="relative min-w-0 flex-1 bg-[#f3f3f3]" />
      </div>
    </div>
  )
}

function TabButton({ tab }: { tab: TabInfo }) {
  const openMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    void window.browser.openLayer({ kind: 'context', x: event.clientX, y: event.clientY, tab })
  }
  return (
    <div
      draggable
      className={`no-drag mb-0 flex h-8 max-w-56 min-w-0 items-center gap-2 rounded-t-lg px-3 ${tab.active ? 'bg-white' : 'hover:bg-black/5'}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', tab.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => void window.browser.activateTab(tab.id)}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={openMenu}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{tab.title || '新标签页'}</span>
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

