import type { LayerPayload, Settings, UiState, WorkflowEdge, WorkflowNode } from '../../shared/types'

export type BrowserApi = {
  getState: () => Promise<UiState | null>
  onState: (callback: (state: UiState) => void) => () => void
  onFocusAddress: (callback: () => void) => () => void
  onOpenFind: (callback: () => void) => () => void
  onCloseFind: (callback: () => void) => () => void
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  navigate: (url: string) => Promise<void>
  back: () => Promise<void>
  forward: () => Promise<void>
  reload: () => Promise<void>
  stop: () => Promise<void>
  newTab: () => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  openTabBelow: (tabId: string) => Promise<void>
  duplicateTab: (tabId: string) => Promise<void>
  reloadTab: (tabId: string) => Promise<void>
  muteTab: (tabId: string) => Promise<void>
  closeOtherTabs: (tabId: string) => Promise<void>
  closeTabsBelow: (tabId: string) => Promise<void>
  restoreTab: () => Promise<void>
  devtoolsTab: (tabId: string) => Promise<void>
  activateTab: (tabId: string) => Promise<void>
  pinTab: (tabId: string) => Promise<void>
  copyTab: (tabId: string) => Promise<void>
  copyEnv: () => Promise<void>
  createEnv: (input: { name?: string; remark?: string }) => Promise<unknown>
  openEnv: (envId: string) => Promise<unknown>
  updateEnv: (input: { env: string; name?: string; remark?: string }) => Promise<unknown>
  deleteEnv: (envId: string) => Promise<unknown>
  devtools: () => Promise<void>
  toggleScreen: () => Promise<unknown>
  openSettings: () => Promise<void>
  createGroup: (input: { name: string; color?: string }) => Promise<unknown>
  assignGroup: (input: { tabId: string; groupId?: string | null }) => Promise<unknown>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  exportWorkflow: (id: string) => Promise<{ canceled: boolean; path?: string; name?: string }>
  importWorkflow: () => Promise<{ canceled: boolean; workflow?: string; name?: string }>
  updateWorkflow: (input: {
    workflow: string
    nodes?: (WorkflowNode & { parent?: string })[]
    removeNodes?: string[]
    edges?: WorkflowEdge[]
    removeEdges?: string[]
  }) => Promise<void>
  find: (text: string) => Promise<void>
  stopFind: () => Promise<void>
  onScreenStart: (callback: () => void) => () => void
  onScreenStop: (callback: () => void) => () => void
  screenReady: () => Promise<void>
  screenFailed: (message: string) => Promise<void>
  saveScreen: (data: Uint8Array, mime: string) => Promise<string>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  closeWindow: () => Promise<void>
  openLayer: (payload: LayerPayload) => Promise<void>
  closeLayer: () => Promise<void>
  setRailOpen: (open: boolean) => Promise<void>
  toggleRailPin: () => Promise<void>
  currentLayer: () => Promise<LayerPayload | null>
  onLayer: (callback: (payload: LayerPayload) => void) => () => void
}

declare global {
  interface Window {
    browser: BrowserApi
  }
}
