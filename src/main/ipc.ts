import { clipboard, dialog, ipcMain, session, app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { LayerPayload, Settings, UiState, WorkflowEdge, WorkflowNode, WorkflowParam } from '@shared/types'
import { DEFAULT_ENV, searchEngines } from '@shared/types'
import { workflowPage } from '@shared/market'
import type { StoredEnv } from './services/StorageService'
import { storage } from './services/store'
import { deleteWorkflow, exportWorkflow, findWorkflow, importWorkflow, runWorkflow, workflowParams, workflowUpdate } from './services/RecordService'
import { installMarketFile, installMarketUrl, listMarket } from './services/MarketService'
import { downloadCopyLink, downloadOpen, downloadPause, downloadResume, downloadRetry, downloadShow, downloadCancel, downloadsClear, listDownloads } from './services/DownloadService'
import { windows, type WindowRuntime } from './runtime'
import { bridge } from './runtime'
import {
  activateTab,
  addTab,
  closeOtherTabs,
  closeTab,
  closeWorkflowPages,
  closeTabsBelow,
  duplicateTab,
  emitContextMenu,
  layoutWindow,
  muteTab,
  reloadTab,
  resolveTab,
  restoreTab,
  openEnvironment,
  openMarket,
  openDownloadsPage,
  openRunsPage,
  openSettingsPage,
  openWorkflowPage,
  setBounds,
  shareControl,
  takeoverActive,
  windowFromSender
} from './windows'
import { normalizeUrl, startUrl } from './page'
import { callTool, screenStartWaiters, screenWaiters } from './services/tool-catalog'
import { netList } from './services/NetService'
import { createId } from './ids'

async function cookieDomains(envId: string): Promise<Set<string>> {
  const cookies = await session.fromPartition(`persist:${envId}`).cookies.get({})
  return new Set(cookies.flatMap((cookie) => (cookie.domain ? [cookie.domain.replace(/^\./, '')] : [])))
}

async function envView(item: StoredEnv): Promise<UiState['envs'][number]> {
  const domains = windows.has(item.id) ? await cookieDomains(item.id) : new Set<string>()
  return {
    id: item.id,
    name: item.name,
    remark: item.remark,
    isDefault: item.id === DEFAULT_ENV,
    windowOpen: windows.has(item.id),
    headless: windows.get(item.id)?.headless ?? false,
    sites: item.sites.map((site) => ({
      ...site,
      cookiePresent: [...domains].some((domain) => domain === site.domain || domain.endsWith(`.${site.domain}`))
    }))
  }
}

export async function buildState(runtime: WindowRuntime): Promise<UiState> {
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  const nav = active?.view?.webContents.navigationHistory
  return {
    envId: runtime.envId,
    envName: storage.envs.find((item) => item.id === runtime.envId)?.name ?? runtime.envId,
    headless: runtime.headless,
    layout: storage.settings.tabLayout,
    tabs: runtime.tabs.map((tab) => ({
      id: tab.id,
      envId: tab.envId,
      groupId: tab.groupId,
      kind: tab.kind,
      title: tab.kind === 'settings' ? '设置' : tab.kind === 'market' ? '工作流' : tab.kind === 'workflow' ? (storage.workflows.find((item) => tab.url === workflowPage(item.id))?.app.name ?? tab.title) : tab.title || '新标签页',
      url: tab.url,
      favicon: tab.favicon || '',
      loading: tab.loading,
      active: tab.id === runtime.activeTabId,
      pinned: Boolean(tab.pinned),
      muted: Boolean(tab.muted),
      audible: Boolean(tab.audible),
      control: tab.control === 'handoff' ? 'handoff' : tab.control === 'agent' ? 'agent' : 'shared'
    })),
    groups: storage.groups
      .filter((group) => group.envId === runtime.envId)
      .map((group) => ({
        ...group,
        tabIds: runtime.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id)
      })),
    envs: await Promise.all(storage.envs.map((item) => envView(item))),
    workflows: storage.workflows.map((item) => ({
      id: item.id,
      name: item.app.name,
      remark: item.app.description,
      icon: item.app.icon || '',
      params: workflowParams(item),
      graph: item.workflow.graph
    })),
    captures: active ? netList(active.id) : [],
    canBack: Boolean(nav?.canGoBack()),
    canForward: Boolean(nav?.canGoForward()),
    screenRecording: runtime.screenRecording,
    handoffMessage: active?.control === 'handoff' ? active.handoffMessage : '',
    settings: storage.settings,
    version: app.getVersion(),
    maximized: runtime.win.isMaximized(),
    railPinned: runtime.railPinned,
    downloads: listDownloads()
  }
}

function paramHint(param: WorkflowParam): string {
  if (param.type === 'number') return '数字'
  if (param.type === 'time') return '时间，写成 2026-09-30 11:58'
  if (param.type === 'time-range') return '时间范围，写成 2026-09-30 11:58 ~ 2026-09-30 18:00'
  if (param.type === 'select') return param.options.length ? `单选：${param.options.join('、')}` : '单选'
  if (param.type === 'checkbox') return param.options.length ? `复选，多项用逗号分开：${param.options.join('、')}` : '复选，多项用逗号分开'
  return '文本'
}

export function broadcast(envId?: string): void {
  const list = envId ? [windows.get(envId)].filter((item): item is WindowRuntime => Boolean(item)) : [...windows.values()]
  for (const runtime of list) {
    void buildState(runtime).then((state) => {
      if (!runtime.win.isDestroyed()) runtime.win.webContents.send('state', state)
      if (runtime.popupView && !runtime.popupView.webContents.isDestroyed()) runtime.popupView.webContents.send('state', state)
      if (runtime.railView && !runtime.railView.webContents.isDestroyed()) runtime.railView.webContents.send('state', state)
    })
  }
}

export function wireIpc(): void {
  ipcMain.on('page:contextmenu', (event, point: { x: number; y: number }) => {
    for (const runtime of windows.values()) {
      const tab = runtime.tabs.find((item) => item.view?.webContents === event.sender)
      if (tab) {
        emitContextMenu(runtime, tab, point.x, point.y)
        return
      }
    }
  })

  bridge.broadcast = broadcast
  bridge.layout = layoutWindow
  bridge.ensureWindow = (envId, headless) => openEnvironment(envId, headless ?? false)
  bridge.openTab = (envId, url) => addTab(openEnvironment(envId, windows.get(envId)?.headless ?? false), url || startUrl())

  ipcMain.handle('state:get', async (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return null
    return buildState(runtime)
  })

  ipcMain.handle('bounds:set', (event, bounds) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime || runtime.popupView?.webContents.id === event.sender.id || runtime.railView?.webContents.id === event.sender.id) return
    setBounds(runtime.envId, bounds)
  })

  ipcMain.handle('window:minimize', (event) => {
    windowFromSender(event.sender)?.win.minimize()
  })

  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = windowFromSender(event.sender)?.win
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:close', (event) => {
    windowFromSender(event.sender)?.win.close()
  })

  ipcMain.handle('layer:open', (event, payload: LayerPayload) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime?.popupView) return
    let next = payload
    const rail = runtime.railView
    if (rail && rail.webContents.id === event.sender.id && (payload.kind === 'context' || payload.kind === 'menu')) {
      const box = rail.getBounds()
      next = { ...payload, x: payload.x + box.x, y: payload.y + box.y }
    }
    runtime.popupPayload = next
    runtime.popupOpen = true
    layoutWindow(runtime.envId)
    runtime.popupView.webContents.send('layer:show', next)
  })

  ipcMain.handle('rail:open', (event, open: boolean) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime || runtime.railPinned || runtime.railOpen === open) return
    runtime.railOpen = open
    layoutWindow(runtime.envId)
  })

  ipcMain.handle('rail:pin', (event, hovering: boolean) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    runtime.railPinned = !runtime.railPinned
    runtime.railOpen = runtime.railPinned ? false : Boolean(hovering)
    layoutWindow(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('layer:get', (event) => windowFromSender(event.sender)?.popupPayload ?? null)

  ipcMain.handle('layer:close', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    runtime.popupOpen = false
    runtime.popupPayload = null
    layoutWindow(runtime.envId)
  })

  ipcMain.handle('chrome:navigate', async (event, url: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId && tab.kind === 'page')
    const target = normalizeUrl(url)
    if (!active) {
      addTab(runtime, target)
      return
    }
    await active.view?.webContents.loadURL(target)
  })

  ipcMain.handle('chrome:back', (event) => {
    windowFromSender(event.sender)?.tabs.find((tab) => tab.kind === 'page' && tab.id === windowFromSender(event.sender)?.activeTabId)?.view?.webContents.navigationHistory.goBack()
  })

  ipcMain.handle('chrome:forward', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId)
    tab?.view?.webContents.navigationHistory.goForward()
  })

  ipcMain.handle('chrome:reload', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime?.activeTabId) reloadTab(runtime, runtime.activeTabId)
  })

  ipcMain.handle('chrome:stop', (event) => {
    const runtime = windowFromSender(event.sender)
    runtime?.tabs.find((item) => item.id === runtime.activeTabId)?.view?.webContents.stop()
  })

  ipcMain.handle('tab:new', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) addTab(runtime, startUrl())
  })

  ipcMain.handle('tab:below', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === tabId)
    if (runtime) addTab(runtime, startUrl(), tab?.groupId ?? null, tabId)
  })

  ipcMain.handle('tab:duplicate', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) duplicateTab(runtime, tabId)
  })

  ipcMain.handle('tab:reload', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) reloadTab(runtime, tabId)
  })

  ipcMain.handle('tab:mute', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) muteTab(runtime, tabId)
  })

  ipcMain.handle('tab:closeOthers', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) closeOtherTabs(runtime, tabId)
  })

  ipcMain.handle('tab:closeBelow', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) closeTabsBelow(runtime, tabId)
  })

  ipcMain.handle('tab:restore', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) restoreTab(runtime)
  })

  ipcMain.handle('tab:devtools', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    runtime?.tabs.find((item) => item.id === tabId)?.view?.webContents.openDevTools({ mode: 'detach' })
  })

  ipcMain.handle('tab:close', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) closeTab(runtime, tabId)
  })

  ipcMain.handle('tab:pin', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    const index = runtime.tabs.findIndex((item) => item.id === tabId)
    if (index < 0) return
    const tab = runtime.tabs[index]
    tab.pinned = !tab.pinned
    runtime.tabs.splice(index, 1)
    if (tab.pinned) {
      const lastPinned = runtime.tabs.reduce((at, item, itemIndex) => (item.pinned ? itemIndex : at), -1)
      runtime.tabs.splice(lastPinned + 1, 0, tab)
    } else {
      const firstLoose = runtime.tabs.findIndex((item) => !item.pinned)
      runtime.tabs.splice(firstLoose < 0 ? runtime.tabs.length : firstLoose, 0, tab)
    }
    broadcast(runtime.envId)
  })

  ipcMain.handle('tab:activate', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) activateTab(runtime, tabId)
  })

  ipcMain.handle('tab:copy', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === tabId)
    if (!tab) return
    clipboard.writeText([tab.id, tab.title, tab.url, tab.envId].filter(Boolean).join('\n'))
  })

  ipcMain.handle('env:copy', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) clipboard.writeText(runtime.envId)
  })

  ipcMain.handle('env:create', async (_event, input: { name?: string; remark?: string }) => {
    return callTool('env_create', { name: input.name || '新环境', remark: input.remark || '' })
  })

  ipcMain.handle('env:open', async (_event, envId: string) => callTool('env_open', { env: envId, headless: false }))

  ipcMain.handle('env:update', async (_event, input: { env: string; name?: string; remark?: string }) => callTool('env_update', input))

  ipcMain.handle('env:delete', async (_event, envId: string) => callTool('env_delete', { env: envId }))

  ipcMain.handle('workflow:export', async (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    const appItem = storage.workflows.find((item) => item.id === id)
    if (!appItem) throw new Error(`没有这个工作流 ${id}`)
    const options = {
      title: '导出工作流',
      defaultPath: `${appItem.app.name}.json`,
      filters: [{ name: '工作流', extensions: ['json'] }]
    }
    const picked = runtime ? await dialog.showSaveDialog(runtime.win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { canceled: true }
    return { canceled: false, path: exportWorkflow(id, picked.filePath), name: appItem.app.name }
  })

  ipcMain.handle('workflow:import', async (event) => {
    const runtime = windowFromSender(event.sender)
    const options = {
      title: '导入工作流',
      filters: [{ name: '工作流', extensions: ['json'] }],
      properties: ['openFile'] as 'openFile'[]
    }
    const picked = runtime ? await dialog.showOpenDialog(runtime.win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    const saved = importWorkflow(picked.filePaths[0])
    broadcast()
    return { canceled: false, workflow: saved.id, name: saved.app.name }
  })

  ipcMain.handle('workflow:delete', (_event, id: string) => {
    const removed = deleteWorkflow(id)
    closeWorkflowPages(removed.id)
    broadcast()
    return removed
  })

  ipcMain.handle('workflow:open', (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openWorkflowPage(runtime, id)
  })

  ipcMain.handle('market:open', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openMarket(runtime)
  })

  ipcMain.handle('market:list', () => listMarket())

  ipcMain.handle('market:install', async (_event, input: { file?: string; url?: string }) => {
    const saved = input.url?.trim() ? await installMarketUrl(input.url) : await installMarketFile(String(input.file || ''))
    broadcast()
    return saved
  })

  ipcMain.handle('workflow:run', async (event, input: { workflow: string; inputs?: Record<string, string> }) => {
    const runtime = windowFromSender(event.sender)
    const resolved = resolveTab({ env: runtime?.envId }, true)
    if (runtime && resolved.win.envId === runtime.envId) activateTab(runtime, resolved.tab.id)
    try {
      const result = await runWorkflow(resolved.tab, findWorkflow(input.workflow), input.inputs ?? {})
      if (resolved.tab.control === 'agent') shareControl(resolved.tab, false)
      return result
    } catch (error) {
      if (resolved.tab.control === 'agent') shareControl(resolved.tab, false)
      throw error
    }
  })

  ipcMain.handle('workflow:agent', (_event, id: string) => {
    const appItem = findWorkflow(id)
    const params = workflowParams(appItem)
    const lines = [
      `请用 BrowserPilot 执行已经装好的工作流「${appItem.app.name}」。`,
      `调用 workflow_run，name 为「${appItem.app.name}」。`,
      params.length
        ? `inputs 使用下面这些值。空着的先问我，不要自己编：\n${params.map((item) => `${item.name} (${paramHint(item)}): `).join('\n')}`
        : '这次没有输入参数。',
      '跑完后调用 page_unlock。'
    ]
    clipboard.writeText(lines.join('\n'))
    return { copied: true }
  })

  ipcMain.handle('workflow:update', (_event, input: {
    workflow: string
    nodes?: (WorkflowNode & { parent?: string })[]
    removeNodes?: string[]
    edges?: WorkflowEdge[]
    removeEdges?: string[]
  }) => {
    workflowUpdate(input.workflow, input)
    broadcast()
  })

  ipcMain.handle('menu:devtools', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId && item.kind === 'page')
    tab?.view?.webContents.openDevTools({ mode: 'detach' })
  })

  ipcMain.handle('menu:screen', async (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    if (runtime.screenRecording) return callTool('screen_stop', { env: runtime.envId })
    return callTool('screen_start', { env: runtime.envId })
  })

  ipcMain.handle('menu:settings', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openSettingsPage(runtime, '环境')
  })

  ipcMain.handle('workflow:runs', (_event, id?: string) => (id ? storage.runs.filter((run) => run.workflowId === id) : storage.runs).slice(0, 50))

  ipcMain.handle('downloads:open', (_event, id: string) => downloadOpen(id))
  ipcMain.handle('downloads:show', (_event, id: string) => downloadShow(id))
  ipcMain.handle('downloads:clear', () => downloadsClear())
  ipcMain.handle('downloads:pause', (_event, id: string) => downloadPause(id))
  ipcMain.handle('downloads:resume', (_event, id: string) => downloadResume(id))
  ipcMain.handle('downloads:cancel', (_event, id: string) => downloadCancel(id))
  ipcMain.handle('downloads:retry', (_event, id: string) => downloadRetry(id))
  ipcMain.handle('downloads:copyLink', (_event, id: string) => downloadCopyLink(id))
  ipcMain.handle('menu:runs', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openRunsPage(runtime)
  })

  ipcMain.handle('workflow:runsPage', (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openRunsPage(runtime, id)
  })

  ipcMain.handle('menu:downloads', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openDownloadsPage(runtime)
  })

  ipcMain.handle('group:create', async (event, input: { name: string; color?: string }) => {
    const runtime = windowFromSender(event.sender)
    return callTool('group_create', { ...input, env: runtime?.envId })
  })

  ipcMain.handle('group:assign', async (_event, input: { tabId: string; groupId?: string | null }) => {
    return callTool('tab_group', input)
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
    if (patch.searchEngine !== undefined && !searchEngines.some((item) => item.id === patch.searchEngine)) {
      delete patch.searchEngine
    }
    storage.settings = { ...storage.settings, ...patch }
    storage.saveSettings()
    if (patch.tabLayout !== undefined) {
      for (const runtime of windows.values()) layoutWindow(runtime.envId)
    }
    broadcast()
    const { startMcp } = await import('./services/McpService')
    if (patch.mcpEnabled !== undefined || patch.port !== undefined) await startMcp()
  })

  ipcMain.handle('find:query', (event, text: string) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId)
    tab?.view?.webContents.findInPage(text)
  })

  ipcMain.handle('find:stop', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId)
    tab?.view?.webContents.stopFindInPage('clearSelection')
  })

  ipcMain.on('control:takeover', (event) => {
    takeoverActive(event.sender)
  })

  ipcMain.handle('screen:ready', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    screenStartWaiters.get(runtime.envId)?.resolve()
    screenStartWaiters.delete(runtime.envId)
  })

  ipcMain.handle('screen:failed', (event, message: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    runtime.screenRecording = false
    screenStartWaiters.get(runtime.envId)?.reject(new Error(message || '录屏没有开始'))
    screenStartWaiters.delete(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('screen:save', (event, payload: { data: Uint8Array; mime: string }) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return ''
    if (!payload.mime.includes('mp4') || !(payload.data?.byteLength || payload.data?.length)) {
      runtime.screenRecording = false
      screenWaiters.get(runtime.envId)?.reject(new Error('这次没能写成 mp4'))
      screenWaiters.delete(runtime.envId)
      broadcast(runtime.envId)
      throw new Error('这次没能写成 mp4')
    }
    const path = join(storage.userData(), 'videos', `vid-${createId('clip')}.mp4`)
    writeFileSync(path, Buffer.from(payload.data))
    runtime.screenRecording = false
    screenWaiters.get(runtime.envId)?.resolve(path)
    screenWaiters.delete(runtime.envId)
    broadcast(runtime.envId)
    return path
  })
}
