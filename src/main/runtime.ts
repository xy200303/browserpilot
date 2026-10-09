import type { BrowserWindow, WebContentsView } from 'electron'
import type { Control, LayerPayload } from '@shared/types'

export type InternalControl = 'free' | 'agent' | 'shared' | 'handoff'

export type AxRef = {
  role: string
  name: string
  backendNodeId?: number
}

export type TabRuntime = {
  id: string
  envId: string
  groupId: string | null
  kind: 'page' | 'settings' | 'market' | 'workflow' | 'downloads' | 'runs'
  title: string
  url: string
  favicon?: string
  loading: boolean
  pinned?: boolean
  muted?: boolean
  audible?: boolean
  control: InternalControl
  handoffMessage: string
  userTookOver: boolean
  refs: Map<string, AxRef>
  documentHtml: string
  view?: WebContentsView
}

export type ClosedTab = { url: string; title: string; groupId: string | null }

export type Bounds = { x: number; y: number; width: number; height: number }

export type WindowRuntime = {
  envId: string
  win: BrowserWindow
  headless: boolean
  tabs: TabRuntime[]
  activeTabId: string | null
  closedStack: ClosedTab[]
  screenRecording: boolean
  lockView?: WebContentsView
  popupView?: WebContentsView
  popupOpen: boolean
  popupPayload: LayerPayload | null
  railView?: WebContentsView
  railOpen: boolean
  railPinned: boolean
  bounds: Bounds
}

export const windows = new Map<string, WindowRuntime>()

export let runDepth = 0
export let tookOverDuringRun = false

export function enterRun(): void {
  if (runDepth === 0) tookOverDuringRun = false
  runDepth += 1
}

export function leaveRun(): boolean {
  runDepth = Math.max(0, runDepth - 1)
  const taken = tookOverDuringRun
  if (runDepth === 0) tookOverDuringRun = false
  return taken
}

export function markUserTookOver(): void {
  if (runDepth > 0) tookOverDuringRun = true
}

export function publicControl(tab?: TabRuntime | null): Control {
  if (!tab || tab.control === 'free' || tab.control === 'shared') return 'shared'
  if (tab.control === 'handoff') return 'handoff'
  return 'agent'
}

export function findTab(tabId: string): { win: WindowRuntime; tab: TabRuntime } | undefined {
  for (const win of windows.values()) {
    const tab = win.tabs.find((item) => item.id === tabId)
    if (tab) return { win, tab }
  }
  return undefined
}

export function activePage(win: WindowRuntime): TabRuntime | undefined {
  const active = win.tabs.find((tab) => tab.id === win.activeTabId && tab.kind === 'page')
  if (active) return active
  return win.tabs.find((tab) => tab.kind === 'page')
}

export const bridge = {
  broadcast(_envId?: string): void {},
  layout(_envId: string): void {},
  openTab(_envId: string, _url?: string): TabRuntime {
    throw new Error('窗口还没准备好')
  },
  ensureWindow(_envId: string, _headless = false): WindowRuntime {
    throw new Error('窗口还没准备好')
  },
  restoreTabView(_tab: TabRuntime): boolean {
    return false
  }
}
