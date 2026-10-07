import { contextBridge, ipcRenderer } from 'electron'
import type { LayerPayload, Settings, UiState, WorkflowEdge, WorkflowNode } from '../shared/types'

const api = {
  getState: (): Promise<UiState | null> => ipcRenderer.invoke('state:get'),
  onState: (callback: (state: UiState) => void): (() => void) => {
    const listener = (_event: unknown, state: UiState): void => callback(state)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
  onFocusAddress: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('focus-address', listener)
    return () => ipcRenderer.removeListener('focus-address', listener)
  },
  onOpenFind: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('open-find', listener)
    return () => ipcRenderer.removeListener('open-find', listener)
  },
  onCloseFind: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('close-find', listener)
    return () => ipcRenderer.removeListener('close-find', listener)
  },
  onBuiltinReload: (callback: (tabId: string) => void): (() => void) => {
    const listener = (_event: unknown, tabId: string): void => callback(tabId)
    ipcRenderer.on('builtin-reload', listener)
    return () => ipcRenderer.removeListener('builtin-reload', listener)
  },
  setBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> => ipcRenderer.invoke('bounds:set', bounds),
  navigate: (url: string): Promise<void> => ipcRenderer.invoke('chrome:navigate', url),
  back: (): Promise<void> => ipcRenderer.invoke('chrome:back'),
  forward: (): Promise<void> => ipcRenderer.invoke('chrome:forward'),
  reload: (): Promise<void> => ipcRenderer.invoke('chrome:reload'),
  stop: (): Promise<void> => ipcRenderer.invoke('chrome:stop'),
  newTab: (): Promise<void> => ipcRenderer.invoke('tab:new'),
  closeTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:close', tabId),
  openTabBelow: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:below', tabId),
  duplicateTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:duplicate', tabId),
  reloadTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:reload', tabId),
  muteTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:mute', tabId),
  closeOtherTabs: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:closeOthers', tabId),
  closeTabsBelow: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:closeBelow', tabId),
  restoreTab: (): Promise<void> => ipcRenderer.invoke('tab:restore'),
  devtoolsTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:devtools', tabId),
  activateTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:activate', tabId),
  pinTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:pin', tabId),
  copyTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:copy', tabId),
  copyEnv: (): Promise<void> => ipcRenderer.invoke('env:copy'),
  createEnv: (input: { name?: string; remark?: string }): Promise<unknown> => ipcRenderer.invoke('env:create', input),
  openEnv: (envId: string): Promise<unknown> => ipcRenderer.invoke('env:open', envId),
  updateEnv: (input: { env: string; name?: string; remark?: string }): Promise<unknown> => ipcRenderer.invoke('env:update', input),
  deleteEnv: (envId: string): Promise<unknown> => ipcRenderer.invoke('env:delete', envId),
  devtools: (): Promise<void> => ipcRenderer.invoke('menu:devtools'),
  toggleScreen: (): Promise<unknown> => ipcRenderer.invoke('menu:screen'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('menu:settings'),
  openDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:open', id),
  showDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:show', id),
  clearDownloads: (): Promise<void> => ipcRenderer.invoke('downloads:clear'),
  pauseDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:cancel', id),
  retryDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:retry', id),
  copyDownloadLink: (id: string): Promise<void> => ipcRenderer.invoke('downloads:copyLink', id),
  openDownloads: (): Promise<void> => ipcRenderer.invoke('menu:downloads'),
  createGroup: (input: { name: string; color?: string }): Promise<unknown> => ipcRenderer.invoke('group:create', input),
  assignGroup: (input: { tabId: string; groupId?: string | null }): Promise<unknown> => ipcRenderer.invoke('group:assign', input),
  updateSettings: (patch: Partial<Settings>): Promise<void> => ipcRenderer.invoke('settings:update', patch),
  exportWorkflow: (id: string): Promise<{ canceled: boolean; path?: string; name?: string }> => ipcRenderer.invoke('workflow:export', id),
  importWorkflow: (): Promise<{ canceled: boolean; workflow?: string; name?: string }> => ipcRenderer.invoke('workflow:import'),
  deleteWorkflow: (id: string): Promise<{ id: string; name: string }> => ipcRenderer.invoke('workflow:delete', id),
  openWorkflow: (id: string): Promise<void> => ipcRenderer.invoke('workflow:open', id),
  openMarket: (): Promise<void> => ipcRenderer.invoke('market:open'),
  listMarket: (): Promise<{ items: { slug: string; name: string; description: string; author: string; category: string; site: string; icon: string; file: string }[]; source: string }> => ipcRenderer.invoke('market:list'),
  installMarket: (input: { file?: string; url?: string }): Promise<{ workflow: string; name: string }> => ipcRenderer.invoke('market:install', input),
  runWorkflow: (input: { workflow: string; inputs?: Record<string, string> }): Promise<{ ok?: boolean; error?: string; outputs?: Record<string, unknown> }> => ipcRenderer.invoke('workflow:run', input),
  copyAgentPrompt: (id: string): Promise<{ copied: boolean }> => ipcRenderer.invoke('workflow:agent', id),
  updateWorkflow: (input: {
    workflow: string
    nodes?: (WorkflowNode & { parent?: string })[]
    removeNodes?: string[]
    edges?: WorkflowEdge[]
    removeEdges?: string[]
  }): Promise<void> => ipcRenderer.invoke('workflow:update', input),
  find: (text: string): Promise<void> => ipcRenderer.invoke('find:query', text),
  stopFind: (): Promise<void> => ipcRenderer.invoke('find:stop'),
  onScreenStart: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('screen:start', listener)
    return () => ipcRenderer.removeListener('screen:start', listener)
  },
  onScreenStop: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('screen:stop', listener)
    return () => ipcRenderer.removeListener('screen:stop', listener)
  },
  screenReady: (): Promise<void> => ipcRenderer.invoke('screen:ready'),
  screenFailed: (message: string): Promise<void> => ipcRenderer.invoke('screen:failed', message),
  saveScreen: (data: Uint8Array, mime: string): Promise<string> => ipcRenderer.invoke('screen:save', { data, mime }),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  openLayer: (payload: LayerPayload): Promise<void> => ipcRenderer.invoke('layer:open', payload),
  closeLayer: (): Promise<void> => ipcRenderer.invoke('layer:close'),
  setRailOpen: (open: boolean): Promise<void> => ipcRenderer.invoke('rail:open', open),
  toggleRailPin: (): Promise<void> => ipcRenderer.invoke('rail:pin', true),
  currentLayer: (): Promise<LayerPayload | null> => ipcRenderer.invoke('layer:get'),
  onLayer: (callback: (payload: LayerPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: LayerPayload): void => callback(payload)
    ipcRenderer.on('layer:show', listener)
    return () => ipcRenderer.removeListener('layer:show', listener)
  }
}

contextBridge.exposeInMainWorld('browser', api)

window.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('take')
  button?.addEventListener('click', () => ipcRenderer.send('control:takeover'))
})

export type BrowserApi = typeof api
