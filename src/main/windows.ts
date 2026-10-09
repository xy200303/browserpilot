import { app, BrowserWindow, clipboard, dialog, Menu, session, WebContentsView } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_ENV } from '@shared/types'
import { chromeUserAgent } from './ua'
import { createId } from './ids'
import { DOWNLOADS_PAGE, MARKET_PAGE, RUNS_PAGE, SETTINGS_PAGE, workflowPage } from '@shared/market'
import { storage } from './services/store'
import {
  activePage,
  bridge,
  findTab,
  markUserTookOver,
  windows,
  type Bounds,
  type TabRuntime,
  type WindowRuntime
} from './runtime'
import { downloadBegin, downloadDone, downloadFail, downloadProgress, registerSessionDownload } from './services/DownloadService'
import { inspectElement, isSendingToPage, saveMedia, saveMediaInfo, sendCdp, startUrl, watchDocument, type ElementInfo } from './page'

const LOCK_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:rgba(32,33,36,.45);font-family:Segoe UI,sans-serif;color:#fff"><div style="text-align:center"><div style="font-size:18px">Agent 正在操作浏览器</div><button id="take" style="margin-top:16px;padding:8px 18px;border:0;border-radius:8px;background:#fff;color:#202124;font-size:14px">接管</button></div></body></html>`

const DEFAULT_BOUNDS: Bounds = { x: 0, y: 96, width: 1280, height: 704 }

export function headlessCount(): number {
  let count = 0
  for (const win of windows.values()) if (win.headless) count += 1
  return count
}

function windowIcon(): string | undefined {
  const packaged = join(process.resourcesPath, 'icon.png')
  const dev = join(__dirname, '../../build/icon.png')
  if (existsSync(packaged)) return packaged
  if (existsSync(dev)) return dev
  return undefined
}

export function createBrowserWindow(envId: string, headless: boolean): WindowRuntime {
  const existing = windows.get(envId)
  if (existing) {
    applyHeadless(existing, headless)
    return existing
  }
  const env = storage.envs.find((item) => item.id === envId)
  if (!env) throw new Error(`没有这套环境 ${envId}`)
  const ses = session.fromPartition(`persist:${envId}`)
  const ua = chromeUserAgent()
  ses.setUserAgent(ua)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: `${env.name} · BrowserPilot`,
    icon: windowIcon(),
    autoHideMenuBar: true,
    backgroundColor: '#f3f3f3',
    frame: false,
    thickFrame: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  Menu.setApplicationMenu(null)
  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  const runtime: WindowRuntime = {
    envId,
    win,
    headless,
    tabs: [],
    activeTabId: null,
    closedStack: [],
    screenRecording: false,
    popupOpen: false,
    popupPayload: null,
    railOpen: false,
    railPinned: false,
    bounds: DEFAULT_BOUNDS
  }
  const lockView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      transparent: true
    }
  })
  lockView.setBackgroundColor('#00000000')
  lockView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOCK_HTML)}`)
  lockView.setVisible(false)
  runtime.lockView = lockView
  const popupView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      transparent: true
    }
  })
  popupView.setBackgroundColor('#00000000')
  popupView.setVisible(false)
  runtime.popupView = popupView
  win.contentView.addChildView(popupView)
  void loadPopup(popupView)
  popupView.webContents.on('did-finish-load', () => {
    if (runtime.popupOpen && runtime.popupPayload) popupView.webContents.send('layer:show', runtime.popupPayload)
  })
  const railView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  railView.setBackgroundColor('#f3f3f3')
  railView.setVisible(false)
  runtime.railView = railView
  win.contentView.addChildView(railView)
  void loadLayer(railView, 'rail')
  railView.webContents.on('did-finish-load', () => bindShortcuts(railView.webContents, envId))
  windows.set(envId, runtime)
  win.on('close', () => {
    for (const tab of runtime.tabs) tab.view?.webContents.close()
    windows.delete(envId)
    bridge.broadcast()
  })
  win.on('resize', () => bridge.layout(envId))
  win.on('maximize', () => bridge.broadcast(envId))
  win.on('unmaximize', () => bridge.broadcast(envId))
  bindShortcuts(win.webContents, envId)
  void loadChrome(win)
  if (headless) {
    win.setOpacity(1)
  } else {
    win.show()
  }
  return runtime
}

async function loadChrome(win: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function loadPopup(view: WebContentsView): void {
  loadLayer(view, 'popup')
}

function loadLayer(view: WebContentsView, layer: string, extra?: Record<string, string>): void {
  const query = { layer, ...extra }
  if (process.env.ELECTRON_RENDERER_URL) {
    void view.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  } else {
    void view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

export function applyHeadless(runtime: WindowRuntime, headless: boolean): void {
  if (headless && !runtime.headless && headlessCount() >= storage.settings.headlessLimit) {
    throw new Error(`无头窗口已到上限 ${storage.settings.headlessLimit}`)
  }
  if (headless && headlessCount() >= storage.settings.headlessLimit && !runtime.headless) {
    throw new Error(`无头窗口已到上限 ${storage.settings.headlessLimit}`)
  }
  runtime.headless = headless
  if (headless) runtime.win.hide()
  else {
    runtime.win.show()
    runtime.win.focus()
  }
  const env = storage.envs.find((item) => item.id === runtime.envId)
  if (env) runtime.win.setTitle(`${env.name} · BrowserPilot`)
}

export function openEnvironment(envId: string, headless: boolean): WindowRuntime {
  if (headless && !windows.has(envId) && headlessCount() >= storage.settings.headlessLimit) {
    throw new Error(`无头窗口已到上限 ${storage.settings.headlessLimit}`)
  }
  const runtime = createBrowserWindow(envId, headless)
  if (runtime.tabs.length === 0) addTab(runtime, startUrl())
  applyHeadless(runtime, headless)
  bridge.layout(envId)
  bridge.broadcast(envId)
  return runtime
}

export function addTab(runtime: WindowRuntime, url?: string, groupId: string | null = null, afterId?: string | null): TabRuntime {
  const tab: TabRuntime = {
    id: createId('tab'),
    envId: runtime.envId,
    groupId,
    kind: 'page',
    title: '新标签页',
    url: url || startUrl(),
    loading: true,
    control: 'free',
    handoffMessage: '',
    userTookOver: false,
    refs: new Map(),
    documentHtml: ''
  }
  const ses = session.fromPartition(`persist:${runtime.envId}`)
  ses.setUserAgent(chromeUserAgent())
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/page.js')
    }
  })
  view.webContents.setUserAgent(chromeUserAgent())
  tab.view = view
  runtime.win.contentView.addChildView(view)
  bindPage(runtime, tab)
  if (afterId) {
    const at = runtime.tabs.findIndex((item) => item.id === afterId)
    runtime.tabs.splice(at < 0 ? runtime.tabs.length : at + 1, 0, tab)
  } else {
    runtime.tabs.push(tab)
  }
  activateTab(runtime, tab.id)
  void view.webContents.loadURL(tab.url)
  return tab
}

function openBuiltin(runtime: WindowRuntime, kind: 'market' | 'settings' | 'downloads' | 'runs', title: string, url: string): TabRuntime {
  const existing = runtime.tabs.find((tab) => tab.kind === kind)
  if (existing) {
    activateTab(runtime, existing.id)
    return existing
  }
  const tab: TabRuntime = {
    id: createId('tab'),
    envId: runtime.envId,
    groupId: null,
    kind,
    title,
    url,
    loading: false,
    control: 'free',
    handoffMessage: '',
    userTookOver: false,
    refs: new Map(),
    documentHtml: ''
  }
  runtime.tabs.push(tab)
  activateTab(runtime, tab.id)
  return tab
}

function buildPageMenuItems(runtime: WindowRuntime, tab: TabRuntime, info: ElementInfo | null, x: number, y: number): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = []
  const wc = tab.view!.webContents
  if (info?.href) {
    items.push({ label: '在新标签页打开链接', click: () => addTab(runtime, info.href!) })
    items.push({ label: '复制链接', click: () => clipboard.writeText(info.href!) })
  }
  if (info?.kind === 'image' && info.src) {
    items.push({ label: '在新标签页打开图像', click: () => addTab(runtime, info.src!) })
    items.push({ label: '将图像另存为…', click: () => void saveMediaAs(runtime, tab, { srcURL: info.src!, mediaType: 'image', x, y }) })
    items.push({ label: '复制图像', click: () => wc.copyImageAt(x, y) })
    items.push({ label: '复制图像链接', click: () => clipboard.writeText(info.src!) })
  }
  if ((info?.kind === 'video' || info?.kind === 'audio') && info.src) {
    items.push({
      label: info.kind === 'video' ? '将视频另存为…' : '将音频另存为…',
      click: () => void saveMediaAs(runtime, tab, { srcURL: info.src!, mediaType: info.kind as 'video' | 'audio', x, y })
    })
  }
  if (info?.kind === 'input') {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: '剪切', role: 'cut' })
    items.push({ label: '复制', role: 'copy' })
    items.push({ label: '粘贴', role: 'paste' })
  }
  if (info?.text) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: '复制', role: 'copy' })
  }
  if (items.length) items.push({ type: 'separator' })
  items.push({
    label: '检查',
    click: () => {
      wc.openDevTools({ mode: 'detach' })
      wc.inspectElement(x, y)
    }
  })
  items.push({
    label: '网页自带菜单',
    click: () => {
      contextMenuReplayUntil = Date.now() + 1500
      void (async () => {
        await sendCdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1, pointerType: 'mouse' })
        await sendCdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1, pointerType: 'mouse' })
      })()
    }
  })
  return items
}

let contextMenuReplayUntil = 0
let lastContextMenuAt = 0

export function emitContextMenu(runtime: WindowRuntime, tab: TabRuntime, x: number, y: number): void {
  if (tab.control === 'agent') return
  if (Date.now() < contextMenuReplayUntil) return
  if (Date.now() - lastContextMenuAt < 300) return
  lastContextMenuAt = Date.now()
  void showPageMenu(runtime, tab, x, y)
}

async function showPageMenu(runtime: WindowRuntime, tab: TabRuntime, x: number, y: number): Promise<void> {
  const info = await inspectElement(tab, { point: { x, y } }).catch(() => null)
  const items = buildPageMenuItems(runtime, tab, info, Math.round(x), Math.round(y))
  Menu.buildFromTemplate(items).popup({ window: runtime.win })
}

async function saveMediaAs(runtime: WindowRuntime, tab: TabRuntime, params: { srcURL: string; mediaType: 'image' | 'video' | 'audio'; x: number; y: number }): Promise<void> {
  const urlExt = (() => {
    try {
      const ext = new URL(params.srcURL).pathname.split('.').pop() || ''
      return /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : ''
    } catch {
      return ''
    }
  })()
  // 视频统一出 mp4（抓轨后合并），图像按源地址扩展名
  const kind = params.mediaType === 'video' ? 'mp4' : params.mediaType === 'audio' ? urlExt || 'm4a' : urlExt || 'png'
  const labels: Record<string, string> = { mp4: 'MP4 视频', m4a: '音频', png: 'PNG 图像', jpg: 'JPEG 图像', jpeg: 'JPEG 图像', webp: 'WebP 图像', gif: 'GIF 图像', svg: 'SVG 图像' }
  const suggested = (() => {
    try {
      const name = decodeURIComponent(new URL(params.srcURL).pathname.split('/').pop() || '')
      if (!name) return ''
      return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${kind}`
    } catch {
      return ''
    }
  })()
  const picked = await dialog.showSaveDialog(runtime.win, {
    title: '另存为',
    defaultPath: suggested || undefined,
    filters: [{ name: labels[kind] || kind.toUpperCase(), extensions: [kind] }, { name: '所有文件', extensions: ['*'] }]
  })
  if (picked.canceled || !picked.filePath) return
  const filePath = /\.[a-z0-9]{2,5}$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.${kind}`
  try {
    if ((params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
      const dlId = downloadBegin(filePath.split(/[\\/]/).pop() || suggested || params.mediaType, params.srcURL)
      try {
        const saved = await saveMediaInfo(
          tab,
          { kind: params.mediaType, tag: params.mediaType.toUpperCase(), src: params.srcURL, rect: { x: params.x, y: params.y, w: 0, h: 0 } },
          storage.dir('media'),
          filePath,
          (received, total) => downloadProgress(dlId, received, total ?? 0)
        )
        downloadDone(dlId, saved.path)
      } catch (inner) {
        downloadFail(dlId, inner instanceof Error ? inner.message : String(inner))
        throw inner
      }
      return
    }
    await saveMedia(tab, { point: { x: params.x, y: params.y } }, storage.dir('media'), filePath)
  } catch (error) {
    dialog.showErrorBox('保存失败', error instanceof Error ? error.message : String(error))
  }
}

export function openMarket(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'market', '工作流', MARKET_PAGE)
}

export function openSettingsPage(runtime: WindowRuntime, _section = '环境'): TabRuntime {
  return openBuiltin(runtime, 'settings', '设置', SETTINGS_PAGE)
}

export function openDownloadsPage(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'downloads', '下载', DOWNLOADS_PAGE)
}

export function openRunsPage(runtime: WindowRuntime, workflowId?: string): TabRuntime {
  const url = workflowId ? `${RUNS_PAGE}?workflow=${workflowId}` : RUNS_PAGE
  const existing = runtime.tabs.find((tab) => tab.kind === 'runs')
  if (existing) {
    existing.url = url
    activateTab(runtime, existing.id)
    bridge.broadcast(runtime.envId)
    return existing
  }
  return openBuiltin(runtime, 'runs', '运行记录', url)
}

export function openWorkflowPage(runtime: WindowRuntime, workflowId: string): TabRuntime {
  const app = storage.workflows.find((item) => item.id === workflowId)
  if (!app) throw new Error(`没有这个工作流 ${workflowId}`)
  const url = workflowPage(workflowId)
  const existing = runtime.tabs.find((tab) => tab.kind === 'workflow' && tab.url === url)
  if (existing) {
    existing.title = app.app.name
    activateTab(runtime, existing.id)
    return existing
  }
  const tab: TabRuntime = {
    id: createId('tab'),
    envId: runtime.envId,
    groupId: null,
    kind: 'workflow',
    title: app.app.name,
    url,
    loading: false,
    control: 'free',
    handoffMessage: '',
    userTookOver: false,
    refs: new Map(),
    documentHtml: ''
  }
  runtime.tabs.push(tab)
  activateTab(runtime, tab.id)
  return tab
}

export function activateTab(runtime: WindowRuntime, tabId: string): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab) throw new Error(`没有这个标签 ${tabId}`)
  runtime.activeTabId = tabId
  bridge.layout(runtime.envId)
  bridge.broadcast(runtime.envId)
  if (!runtime.headless) runtime.win.focus()
}

export function closeWorkflowPages(workflowId: string): void {
  const url = workflowPage(workflowId)
  for (const runtime of windows.values()) {
    const ids = runtime.tabs.filter((tab) => tab.kind === 'workflow' && tab.url === url).map((tab) => tab.id)
    for (const tabId of ids) closeTab(runtime, tabId)
  }
}

export function closeTab(runtime: WindowRuntime, tabId: string): void {
  const index = runtime.tabs.findIndex((item) => item.id === tabId)
  if (index < 0) throw new Error(`没有这个标签 ${tabId}`)
  const tab = runtime.tabs[index]
  if (tab.kind === 'page' && tab.url && !tab.url.startsWith('data:')) {
    runtime.closedStack.unshift({ url: tab.url, title: tab.title, groupId: tab.groupId })
    runtime.closedStack = runtime.closedStack.slice(0, 20)
  }
  tab.view?.webContents.close()
  if (tab.view) runtime.win.contentView.removeChildView(tab.view)
  runtime.tabs.splice(index, 1)
  if (runtime.activeTabId === tabId) {
    const next = runtime.tabs[index] ?? runtime.tabs[index - 1]
    runtime.activeTabId = next?.id ?? null
  }
  if (!runtime.tabs.some((item) => item.kind === 'page')) addTab(runtime, startUrl())
  bridge.layout(runtime.envId)
  bridge.broadcast(runtime.envId)
}

export function duplicateTab(runtime: WindowRuntime, tabId: string): TabRuntime | undefined {
  const tab = runtime.tabs.find((item) => item.id === tabId && item.kind === 'page')
  if (!tab) return undefined
  return addTab(runtime, tab.url, tab.groupId, tab.id)
}

export function reloadTab(runtime: WindowRuntime, tabId: string): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab) return
  if (tab.view) {
    tab.view.webContents.reload()
    return
  }
  runtime.win.webContents.send('builtin-reload', tab.id)
}

export function muteTab(runtime: WindowRuntime, tabId: string): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab?.view) return
  tab.muted = !tab.muted
  tab.view.webContents.setAudioMuted(Boolean(tab.muted))
  bridge.broadcast(runtime.envId)
}

function shownOrder(runtime: WindowRuntime): TabRuntime[] {
  const pinned = runtime.tabs.filter((tab) => tab.pinned)
  const seen = new Set(pinned.map((tab) => tab.id))
  const grouped: TabRuntime[] = []
  for (const group of storage.groups.filter((item) => item.envId === runtime.envId)) {
    for (const tab of runtime.tabs) {
      if (tab.groupId === group.id && !tab.pinned && !seen.has(tab.id)) {
        grouped.push(tab)
        seen.add(tab.id)
      }
    }
  }
  const loose = runtime.tabs.filter((tab) => !seen.has(tab.id))
  return [...pinned, ...grouped, ...loose]
}

export function closeOtherTabs(runtime: WindowRuntime, tabId: string): void {
  const ids = runtime.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)
  for (const id of ids) {
    if (runtime.tabs.some((tab) => tab.id === id)) closeTab(runtime, id)
  }
}

export function closeTabsBelow(runtime: WindowRuntime, tabId: string): void {
  const order = shownOrder(runtime)
  const index = order.findIndex((tab) => tab.id === tabId)
  if (index < 0) return
  const ids = order.slice(index + 1).map((tab) => tab.id)
  for (const id of ids) {
    if (runtime.tabs.some((tab) => tab.id === id)) closeTab(runtime, id)
  }
}

export function restoreTab(runtime: WindowRuntime): TabRuntime | undefined {
  const closed = runtime.closedStack.shift()
  if (!closed) return undefined
  return addTab(runtime, closed.url, closed.groupId)
}

export function layoutWindow(envId: string): void {
  const runtime = windows.get(envId)
  if (!runtime) return
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  for (const tab of runtime.tabs) {
    if (!tab.view) continue
    const show = active?.id === tab.id && active.kind === 'page'
    tab.view.setVisible(show)
    if (show) tab.view.setBounds(runtime.bounds)
  }
  placeRail(runtime)
  const lock = runtime.lockView
  if (lock) {
    const showLock = Boolean(active && active.kind === 'page' && active.control === 'agent')
    lock.setVisible(showLock)
    if (showLock) {
      runtime.win.contentView.removeChildView(lock)
      runtime.win.contentView.addChildView(lock)
      lock.setBounds(runtime.bounds)
    }
  }
  const popup = runtime.popupView
  if (!popup) return
  if (runtime.popupOpen) {
    const [width, height] = runtime.win.getContentSize()
    popup.setBounds({ x: 0, y: 0, width, height })
    popup.setVisible(true)
    runtime.win.contentView.removeChildView(popup)
    runtime.win.contentView.addChildView(popup)
  } else {
    popup.setVisible(false)
  }
}

const RAIL_NARROW = 48
const RAIL_WIDE = 256

function placeRail(runtime: WindowRuntime): void {
  const rail = runtime.railView
  if (!rail) return
  const vertical = storage.settings.tabLayout === 'left' && !runtime.headless
  if (!vertical) {
    rail.setVisible(false)
    return
  }
  const wide = runtime.railPinned || runtime.railOpen
  const gutter = runtime.railPinned ? RAIL_WIDE : RAIL_NARROW
  rail.setBounds({
    x: Math.max(0, runtime.bounds.x - gutter),
    y: runtime.bounds.y,
    width: wide ? RAIL_WIDE : RAIL_NARROW,
    height: Math.max(0, runtime.bounds.height)
  })
  rail.setVisible(true)
  const children = runtime.win.contentView.children
  const pages = runtime.tabs.map((tab) => tab.view).filter((view): view is WebContentsView => Boolean(view))
  const railIndex = children.indexOf(rail)
  const covered = pages.some((view) => children.indexOf(view) > railIndex)
  if (covered) {
    runtime.win.contentView.removeChildView(rail)
    runtime.win.contentView.addChildView(rail)
  }
}

export function setBounds(envId: string, bounds: Bounds): void {
  const runtime = windows.get(envId)
  if (!runtime) return
  runtime.bounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  }
  layoutWindow(envId)
}

export function showAgentMask(tab: TabRuntime): void {
  tab.control = 'agent'
  tab.handoffMessage = ''
  bridge.layout(tab.envId)
  bridge.broadcast(tab.envId)
}

export function shareControl(tab: TabRuntime, byUser: boolean): void {
  tab.control = 'shared'
  tab.handoffMessage = ''
  if (byUser) {
    tab.userTookOver = true
    markUserTookOver()
  }
  bridge.layout(tab.envId)
  bridge.broadcast(tab.envId)
}

export function beginHandoff(tab: TabRuntime, message: string): void {
  tab.control = 'handoff'
  tab.handoffMessage = message
  const runtime = windows.get(tab.envId)
  if (runtime?.headless) applyHeadless(runtime, false)
  bridge.layout(tab.envId)
  bridge.broadcast(tab.envId)
}

export function beginAgentAction(tab: TabRuntime): void {
  if (tab.control === 'shared') return
  showAgentMask(tab)
}

const watchedSessions = new Set<Electron.Session>()

function watchDownloads(ses: Electron.Session): void {
  if (watchedSessions.has(ses)) return
  watchedSessions.add(ses)
  ses.on('will-download', (_event, item) => {
    const dir = storage.dir('downloads')
    mkdirSync(dir, { recursive: true })
    const name = item.getFilename() || '下载文件'
    let target = join(dir, name)
    let n = 1
    while (existsSync(target)) {
      const dot = name.lastIndexOf('.')
      target = join(dir, dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`)
      n += 1
    }
    item.setSavePath(target)
    registerSessionDownload(item, target)
  })
}

function bindPage(runtime: WindowRuntime, tab: TabRuntime): void {
  const wc = tab.view!.webContents
  watchDownloads(wc.session)
  bindShortcuts(wc, runtime.envId)
  watchDocument(wc, (html) => {
    tab.documentHtml = html
  })
  wc.on('context-menu', (_event, params) => {
    emitContextMenu(runtime, tab, params.x, params.y)
  })
  wc.setWindowOpenHandler(({ url, features, disposition, frameName }) => {
    // 带尺寸/名称的 window.open（登录授权、支付这类靠 window.opener 回传的）开成真正的小窗
    if (disposition === 'new-window' || disposition === 'other' || frameName || /width|height/i.test(features || '')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560,
          height: 720,
          autoHideMenuBar: true,
          title: '弹窗'
        }
      }
    }
    if (url) addTab(runtime, url)
    return { action: 'deny' }
  })
  const sync = (): void => {
    tab.loading = wc.isLoading()
    if (tab.kind === 'market' || tab.kind === 'settings' || tab.kind === 'downloads' || tab.kind === 'runs') {
      tab.title = tab.kind === 'market' ? '工作流' : tab.kind === 'settings' ? '设置' : tab.kind === 'downloads' ? '下载' : '运行记录'
      tab.url = tab.kind === 'market' ? MARKET_PAGE : tab.kind === 'settings' ? SETTINGS_PAGE : tab.kind === 'downloads' ? DOWNLOADS_PAGE : tab.url.startsWith(RUNS_PAGE) ? tab.url : RUNS_PAGE
    } else {
      tab.title = wc.getTitle() || tab.title
      tab.url = wc.getURL() || tab.url
      rememberSite(runtime.envId, tab.url)
    }
    bridge.broadcast(runtime.envId)
  }
  wc.on('page-title-updated', sync)
  wc.on('page-favicon-updated', (_event, favicons) => {
    const next = favicons[0] || ''
    if (tab.favicon === next) return
    tab.favicon = next
    bridge.broadcast(runtime.envId)
  })
  wc.on('did-start-loading', sync)
  wc.on('did-stop-loading', sync)
  wc.on('did-navigate', sync)
  wc.on('did-navigate-in-page', sync)
}

function rememberSite(envId: string, url: string): void {
  try {
    const host = new URL(url).hostname
    if (!host) return
    const env = storage.envs.find((item) => item.id === envId)
    if (!env) return
    const site = env.sites.find((item) => item.domain === host)
    if (site) site.lastOpenedAt = Date.now()
    else env.sites.unshift({ domain: host, lastOpenedAt: Date.now() })
    env.sites = env.sites.slice(0, 100)
    storage.saveEnvs()
  } catch {
    /* ignore data urls */
  }
}

function bindShortcuts(wc: Electron.WebContents, envId: string): void {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || isSendingToPage()) return
    const runtime = windows.get(envId)
    if (!runtime) return
    const ctrl = input.control || input.meta
    const key = input.key.toLowerCase()
    const handled = (): void => event.preventDefault()
    if (ctrl && input.shift && key === 't') {
      restoreTab(runtime)
      handled()
      return
    }
    if (ctrl && key === 't') {
      addTab(runtime, startUrl())
      handled()
      return
    }
    if (ctrl && input.shift && key === 'k') {
      if (runtime.activeTabId) duplicateTab(runtime, runtime.activeTabId)
      handled()
      return
    }
    if (ctrl && !input.shift && key === 'm') {
      if (runtime.activeTabId) muteTab(runtime, runtime.activeTabId)
      handled()
      return
    }
    if (ctrl && input.shift && key === ',') {
      storage.settings.tabLayout = storage.settings.tabLayout === 'left' ? 'top' : 'left'
      storage.saveSettings()
      for (const item of windows.values()) bridge.layout(item.envId)
      bridge.broadcast()
      handled()
      return
    }
    if (ctrl && key === 'w') {
      if (runtime.activeTabId) closeTab(runtime, runtime.activeTabId)
      handled()
      return
    }
    if (ctrl && key === 'tab') {
      cycleTab(runtime, input.shift ? -1 : 1)
      handled()
      return
    }
    if (ctrl && key >= '1' && key <= '9') {
      const index = key === '9' ? runtime.tabs.length - 1 : Number(key) - 1
      const tab = runtime.tabs[index]
      if (tab) activateTab(runtime, tab.id)
      handled()
      return
    }
    if (ctrl && (key === 'l' || key === 'd') && !input.alt) {
      runtime.win.webContents.send('focus-address')
      handled()
      return
    }
    if (!ctrl && input.alt && key === 'd') {
      runtime.win.webContents.send('focus-address')
      handled()
      return
    }
    if (ctrl && key === 'f') {
      runtime.win.webContents.send('open-find')
      handled()
      return
    }
    if (ctrl && (key === '=' || key === '+')) {
      zoom(runtime, 0.1)
      handled()
      return
    }
    if (ctrl && key === '-') {
      zoom(runtime, -0.1)
      handled()
      return
    }
    if (ctrl && key === '0') {
      activePage(runtime)?.view?.webContents.setZoomFactor(1)
      handled()
      return
    }
    if (key === 'f11') {
      runtime.win.setFullScreen(!runtime.win.isFullScreen())
      handled()
      return
    }
    if (key === 'f5' || (ctrl && key === 'r')) {
      if (runtime.activeTabId) reloadTab(runtime, runtime.activeTabId)
      handled()
      return
    }
    if (key === 'escape') {
      const page = activePage(runtime)
      if (page?.view?.webContents.isLoading()) page.view.webContents.stop()
      runtime.win.webContents.send('close-find')
      handled()
      return
    }
    if (input.alt && key === 'arrowleft') {
      const nav = activePage(runtime)?.view?.webContents.navigationHistory
      if (nav?.canGoBack()) nav.goBack()
      handled()
      return
    }
    if (input.alt && key === 'arrowright') {
      const nav = activePage(runtime)?.view?.webContents.navigationHistory
      if (nav?.canGoForward()) nav.goForward()
      handled()
    }
  })
}

function cycleTab(runtime: WindowRuntime, delta: number): void {
  if (runtime.tabs.length === 0) return
  const index = runtime.tabs.findIndex((tab) => tab.id === runtime.activeTabId)
  const next = (index + delta + runtime.tabs.length) % runtime.tabs.length
  activateTab(runtime, runtime.tabs[next].id)
}

function zoom(runtime: WindowRuntime, delta: number): void {
  const wc = activePage(runtime)?.view?.webContents
  if (!wc) return
  wc.setZoomFactor(Math.min(3, Math.max(0.3, wc.getZoomFactor() + delta)))
}

export function takeoverActive(sender: Electron.WebContents): void {
  const runtime = [...windows.values()].find((item) => item.lockView?.webContents.id === sender.id || item.win.webContents.id === sender.id)
  const fromWindow = [...windows.values()].find((item) => item.win.webContents.id === sender.id)
  const host = fromWindow ?? runtime
  if (!host) return
  const tab = host.tabs.find((item) => item.id === host.activeTabId && item.control === 'agent')
    ?? host.tabs.find((item) => item.control === 'agent')
  if (tab) shareControl(tab, true)
}

export function windowFromSender(sender: Electron.WebContents): WindowRuntime | undefined {
  return [...windows.values()].find(
    (item) =>
      item.win.webContents.id === sender.id
      || item.popupView?.webContents.id === sender.id
      || item.lockView?.webContents.id === sender.id
      || item.railView?.webContents.id === sender.id
  )
}

export function resolveTab(args: { tabId?: string; env?: string }, create = false): { win: WindowRuntime; tab: TabRuntime } {
  if (args.tabId) {
    const found = findTab(args.tabId)
    if (!found) throw new Error(`没有这个标签 ${args.tabId}`)
    if (found.tab.kind !== 'page') throw new Error('设置页不能这样操作')
    return found
  }
  const envId = args.env || DEFAULT_ENV
  const win = openEnvironment(envId, windows.get(envId)?.headless ?? false)
  let tab = activePage(win)
  if (!tab && create) tab = addTab(win, startUrl())
  if (!tab) tab = addTab(win, startUrl())
  return { win, tab }
}

export function bootDefaultWindow(): void {
  openEnvironment(DEFAULT_ENV, false)
}
