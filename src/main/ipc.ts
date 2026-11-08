import { clipboard, dialog, ipcMain } from 'electron'
import { appendFileSync, copyFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Settings, WorkflowEdge, WorkflowNode, WorkflowParam } from '@shared/types'
import { searchEngines } from '@shared/types'
import { storage } from './services/store'
import { buildEnvPrompt, buildTabPrompt } from './services/PromptService'
import { deleteWorkflow, exportWorkflow, findWorkflow, importWorkflow, runWorkflow, workflowParams, workflowUpdate } from './services/RecordService'
import { installMarketFile, installMarketUrl, listMarket } from './services/MarketService'
import { copyConnectInfo } from './services/ConnectService'
import { downloadCopyLink, downloadOpen, downloadPause, downloadResume, downloadRetry, downloadShow, downloadCancel, downloadTargetDir, downloadsClear } from './services/DownloadService'
import { runFfmpeg } from './services/ffmpeg'
import { windows } from './runtime'
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
  enforceLiveTabLimits,
  layoutWindow,
  muteTab,
  reloadTab,
  resolveTab,
  restoreTab,
  restoreTabView,
  openEnvironment,
  openMarket,
  openDownloadsPage,
  openRunsPage,
  openSettingsPage,
  openWorkflowPage,
  pageFromSender,
  setBounds,
  shareControl,
  takeoverActive,
  windowFromSender
} from './windows'
import { normalizeUrl, startUrl } from './page'
import { screenStartWaiters, screenWaiters } from './services/screen-waiters'
import { createId } from './ids'
import { buildState, broadcast } from './ipc/state'
import { registerLayerIpc } from './ipc/layers'
import { registerLibraryIpc } from './ipc/library'
import { registerPasswordIpc } from './ipc/passwords'
import { applyMainLanguage, mt } from './i18n'

export { buildState, broadcast }

function paramHint(param: WorkflowParam): string {
  if (param.type === 'number') return mt('main.paramHint.number')
  if (param.type === 'time') return mt('main.paramHint.time')
  if (param.type === 'time-range') return mt('main.paramHint.timeRange')
  if (param.type === 'select') return param.options.length ? mt('main.paramHint.select', { options: param.options.join(', ') }) : mt('main.paramHint.selectAny')
  if (param.type === 'checkbox') return param.options.length ? mt('main.paramHint.checkbox', { options: param.options.join(', ') }) : mt('main.paramHint.checkboxAny')
  return mt('main.paramHint.text')
}

const screenParts = new Map<string, { path: string; bytes: number }>()

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return (await import('./services/tool-catalog')).callTool(name, args)
}

export function wireIpc(): void {
  registerLayerIpc()
  registerLibraryIpc()
  registerPasswordIpc()

  ipcMain.on('page:contextmenu', (event, point: { x: number; y: number }) => {
    const found = pageFromSender(event.sender)
    if (found) emitContextMenu(found.runtime, found.tab, point.x, point.y)
  })

  bridge.broadcast = broadcast
  bridge.layout = layoutWindow
  bridge.activateTab = (tabId: string) => {
    for (const runtime of windows.values()) {
      if (runtime.tabs.some((item) => item.id === tabId)) {
        activateTab(runtime, tabId, false)
        return
      }
    }
  }
  bridge.ensureWindow = (envId, headless) => openEnvironment(envId, headless ?? false)
  bridge.openTab = (envId, url) => addTab(openEnvironment(envId, windows.get(envId)?.headless ?? false), url || startUrl())
  bridge.restoreTabView = restoreTabView

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

  ipcMain.handle('chrome:navigate', async (event, url: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId && tab.kind === 'page')
    const target = normalizeUrl(url)
    if (!active) {
      addTab(runtime, target)
      return
    }
    if (active.hibernated) {
      active.hibernated = false
      active.url = target
      restoreTabView(active)
      return
    }
    await active.view?.webContents?.loadURL(target)
  })

  ipcMain.handle('chrome:back', (event) => {
    windowFromSender(event.sender)?.tabs.find((tab) => tab.kind === 'page' && tab.id === windowFromSender(event.sender)?.activeTabId)?.view?.webContents?.navigationHistory.goBack()
  })

  ipcMain.handle('chrome:forward', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId)
    tab?.view?.webContents?.navigationHistory.goForward()
  })

  ipcMain.handle('chrome:reload', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime?.activeTabId) reloadTab(runtime, runtime.activeTabId)
  })

  ipcMain.handle('chrome:stop', (event) => {
    const runtime = windowFromSender(event.sender)
    runtime?.tabs.find((item) => item.id === runtime.activeTabId)?.view?.webContents?.stop()
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
    runtime?.tabs.find((item) => item.id === tabId)?.view?.webContents?.openDevTools({ mode: 'detach' })
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
    if (!runtime || !tab) return
    const env = storage.envs.find((item) => item.id === runtime.envId)
    clipboard.writeText(buildTabPrompt(
      { id: runtime.envId, name: env?.name || runtime.envId, remark: env?.remark },
      { id: tab.id, title: tab.title, url: tab.url, page: tab.kind === 'page' }
    ))
  })

  ipcMain.handle('env:copy', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    const env = storage.envs.find((item) => item.id === runtime.envId)
    clipboard.writeText(buildEnvPrompt({ id: runtime.envId, name: env?.name || runtime.envId, remark: env?.remark }))
  })

  ipcMain.handle('env:create', async (_event, input: { name?: string; remark?: string }) => {
    return callTool('env_create', { name: input.name || mt('main.placeholder.newEnv'), remark: input.remark?.trim() || mt('main.placeholder.noRemark') })
  })

  ipcMain.handle('env:open', async (_event, envId: string) => callTool('env_open', { env: envId, headless: false }))

  ipcMain.handle('env:update', async (_event, input: { env: string; name?: string; remark?: string }) => callTool('env_update', input))

  ipcMain.handle('env:delete', async (_event, envId: string) => callTool('env_delete', { env: envId }))

  ipcMain.handle('workflow:export', async (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    const appItem = storage.workflows.find((item) => item.id === id)
    if (!appItem) throw new Error(mt('main.err.noWorkflow', { id }))
    const options = {
      title: mt('main.dialog.exportWorkflow'),
      defaultPath: `${appItem.app.name}.json`,
      filters: [{ name: mt('main.dialog.json'), extensions: ['json'] }]
    }
    const picked = runtime ? await dialog.showSaveDialog(runtime.win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { canceled: true }
    return { canceled: false, path: exportWorkflow(id, picked.filePath), name: appItem.app.name }
  })

  ipcMain.handle('workflow:import', async (event) => {
    const runtime = windowFromSender(event.sender)
    const options = {
      title: mt('main.dialog.importWorkflow'),
      filters: [{ name: mt('main.dialog.json'), extensions: ['json'] }],
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
      mt('main.agent.runInstalled', { name: appItem.app.name }),
      mt('main.agent.runHint', { name: appItem.app.name }),
      params.length
        ? mt('main.agent.inputs', { list: params.map((item) => `${item.name} (${paramHint(item)}): `).join('\n') })
        : mt('main.agent.noParams'),
      mt('main.agent.unlock')
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
    tab?.view?.webContents?.openDevTools({ mode: 'detach' })
  })

  ipcMain.handle('menu:screen', async (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    if (runtime.screenRecording) return callTool('screen', { env: runtime.envId, action: 'stop' })
    return callTool('screen', { env: runtime.envId, action: 'start' })
  })

  ipcMain.handle('menu:settings', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openSettingsPage(runtime)
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

  ipcMain.handle('settings:pickDownloadDir', async (event) => {
    const runtime = windowFromSender(event.sender)
    const options = {
      title: mt('main.dialog.selectDownloadDir'),
      defaultPath: storage.settings.downloadDir || downloadTargetDir(),
      properties: ['openDirectory', 'createDirectory'] as 'openDirectory'[]
    }
    const picked = runtime ? await dialog.showOpenDialog(runtime.win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    storage.settings = { ...storage.settings, downloadDir: picked.filePaths[0] }
    storage.saveSettings()
    broadcast()
    return { canceled: false, dir: picked.filePaths[0] }
  })

  ipcMain.handle('agent:connect', async () => {
    const data = await copyConnectInfo()
    return { copied: true, url: data.url, file: data.file, cliPath: data.cliPath }
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
    if (patch.searchEngine !== undefined && !searchEngines.some((item) => item.id === patch.searchEngine)) {
      delete patch.searchEngine
    }
    if (patch.maxLiveTabs !== undefined) {
      patch.maxLiveTabs = Math.min(20, Math.max(1, Math.round(Number(patch.maxLiveTabs) || 1)))
    }
    if (patch.tabHibernateMinutes !== undefined) {
      patch.tabHibernateMinutes = Math.min(240, Math.max(0, Math.round(Number(patch.tabHibernateMinutes) || 0)))
    }
    if (patch.closeIdleMinutes !== undefined) {
      patch.closeIdleMinutes = Math.min(1440, Math.max(0, Math.round(Number(patch.closeIdleMinutes) || 0)))
    }
    if (patch.cacheCleanup !== undefined && !['off', 'onClose', 'weekly'].includes(patch.cacheCleanup)) {
      delete patch.cacheCleanup
    }
    storage.settings = { ...storage.settings, ...patch }
    storage.saveSettings()
    if (patch.language !== undefined) applyMainLanguage(storage.settings.language)
    if (patch.maxLiveTabs !== undefined) enforceLiveTabLimits()
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
    tab?.view?.webContents?.findInPage(text)
  })

  ipcMain.handle('find:stop', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId)
    tab?.view?.webContents?.stopFindInPage('clearSelection')
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
    runtime.screenStartedAt = undefined
    const part = screenParts.get(runtime.envId)
    screenParts.delete(runtime.envId)
    if (part) {
      try {
        unlinkSync(part.path)
      } catch {
        /* 临时文件可能已经没了 */
      }
    }
    screenStartWaiters.get(runtime.envId)?.reject(new Error(message || mt('main.screen.notStarted')))
    screenStartWaiters.delete(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('screen:append', (event, data: Uint8Array) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime || !data?.byteLength) return 0
    let part = screenParts.get(runtime.envId)
    if (!part) {
      const path = join(downloadTargetDir(), `screen-${createId('clip')}.mp4`)
      part = { path: `${path}.part`, bytes: 0 }
      screenParts.set(runtime.envId, part)
    }
    const buf = Buffer.from(data)
    appendFileSync(part.path, buf)
    part.bytes += buf.length
    return part.bytes
  })

  ipcMain.handle('screen:finish', async (event, payload: { mime?: string }) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return ''
    const part = screenParts.get(runtime.envId)
    screenParts.delete(runtime.envId)
    if (!part || !part.bytes || !String(payload?.mime || '').includes('mp4')) {
      runtime.screenRecording = false
      runtime.screenStartedAt = undefined
      screenWaiters.get(runtime.envId)?.reject(new Error(mt('main.screen.notMp4')))
      screenWaiters.delete(runtime.envId)
      broadcast(runtime.envId)
      throw new Error(mt('main.screen.notMp4'))
    }
    const path = part.path.replace(/\.part$/, '')
    try {
      await runFfmpeg(['-y', '-i', part.path, '-c', 'copy', '-movflags', '+faststart', path], 120_000)
    } catch {
      copyFileSync(part.path, path)
    }
    try {
      unlinkSync(part.path)
    } catch {
      /* 临时文件删不掉不影响结果 */
    }
    runtime.screenRecording = false
    runtime.screenStartedAt = undefined
    screenWaiters.get(runtime.envId)?.resolve(path)
    screenWaiters.delete(runtime.envId)
    broadcast(runtime.envId)
    return path
  })

  ipcMain.handle('screen:save', async (event, payload: { data: Uint8Array; mime: string }) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return ''
    if (!payload.mime.includes('mp4') || !(payload.data?.byteLength || payload.data?.length)) {
      runtime.screenRecording = false
      runtime.screenStartedAt = undefined
      screenWaiters.get(runtime.envId)?.reject(new Error(mt('main.screen.notMp4')))
      screenWaiters.delete(runtime.envId)
      broadcast(runtime.envId)
      throw new Error(mt('main.screen.notMp4'))
    }
    const path = join(downloadTargetDir(), `screen-${createId('clip')}.mp4`)
    const temp = `${path}.part`
    writeFileSync(temp, Buffer.from(payload.data))
    try {
      // MediaRecorder 直接写出的 mp4 常常没有总时长，播放器不显示结束时间也不能拖进度；
      // 用 ffmpeg 重封装一次，补上 moov/mvhd 的时长信息。
      await runFfmpeg(['-y', '-i', temp, '-c', 'copy', '-movflags', '+faststart', path], 120_000)
    } catch {
      // 没有 ffmpeg 时退回原始文件，至少能播
      copyFileSync(temp, path)
    }
    try {
      unlinkSync(temp)
    } catch {
      /* 临时文件删不掉不影响结果 */
    }
    runtime.screenRecording = false
    runtime.screenStartedAt = undefined
    screenWaiters.get(runtime.envId)?.resolve(path)
    screenWaiters.delete(runtime.envId)
    broadcast(runtime.envId)
    return path
  })
}
