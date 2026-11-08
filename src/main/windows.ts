import { app, BrowserWindow, clipboard, dialog, Menu, session, WebContentsView } from 'electron'
import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_ENV, type LayerPayload, type SuggestPayload } from '@shared/types'
import { chromeUserAgent } from './ua'
import { createId } from './ids'
import { BOOKMARKS_PAGE, DOWNLOADS_PAGE, HISTORY_PAGE, MARKET_PAGE, RUNS_PAGE, SETTINGS_PAGE, workflowPage } from '@shared/market'
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
import { downloadBegin, downloadDone, downloadFail, downloadProgress, downloadTargetDir, registerSessionDownload } from './services/DownloadService'
import { watchDialogs } from './dialogs'
import { watchConsole } from './console-log'
import { inspectElement, isSendingToPage, saveMedia, saveMediaInfo, sendCdp, startUrl, watchDocument, type ElementInfo } from './page'
import { mt } from './i18n'

const lockHtml = (): string => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:rgba(32,33,36,.45);font-family:Segoe UI,sans-serif;color:#fff"><div style="text-align:center"><div style="font-size:18px">${mt('main.lock.working')}</div><button id="take" style="margin-top:16px;padding:8px 18px;border:0;border-radius:8px;background:#fff;color:#202124;font-size:14px">${mt('main.lock.takeOver')}</button></div></body></html>`

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

const permissionReady = new Set<string>()

export function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

function permissionLabel(permission: string): string {
  if (permission === 'media') return mt('main.perm.media')
  if (permission === 'geolocation') return mt('main.perm.geolocation')
  if (permission === 'notifications') return mt('main.perm.notifications')
  if (permission === 'clipboard-read') return mt('main.perm.clipboard')
  if (permission === 'display-capture') return mt('main.perm.display')
  if (permission === 'midiSysex') return mt('main.perm.midi')
  if (permission === 'pointerLock') return mt('main.perm.pointerLock')
  if (permission === 'fullscreen') return mt('main.perm.fullscreen')
  if (permission === 'openExternal') return mt('main.perm.openExternal')
  return permission
}

function configurePermissions(ses: Electron.Session, envId: string): void {
  if (permissionReady.has(envId)) return
  permissionReady.add(envId)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || wc.getURL())
    if (!origin) {
      callback(false)
      return
    }
    const name = String(permission)
    const rule = storage.permissionFor(envId, origin, name)
    if (rule) {
      callback(rule === 'allow')
      return
    }
    const runtime = windows.get(envId)
    if (!runtime || runtime.headless) {
      callback(false)
      return
    }
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [mt('main.prompt.allow'), mt('main.prompt.deny')],
      defaultId: 1,
      cancelId: 1,
      title: mt('main.prompt.title'),
      message: mt('main.prompt.message', { origin, permission: permissionLabel(name) }),
      detail: mt('main.prompt.detail'),
      checkboxLabel: mt('main.prompt.remember'),
      checkboxChecked: true
    }
    const ask = dialog.showMessageBox(runtime.win, options)
    void ask
      .then((result) => {
        const allow = result.response === 0
        if (result.checkboxChecked) storage.setPermission({ envId, origin, permission: name, decision: allow ? 'allow' : 'deny' })
        callback(allow)
        bridge.broadcast(envId)
      })
      .catch(() => callback(false))
  })
}

export function createBrowserWindow(envId: string, headless: boolean): WindowRuntime {
  const existing = windows.get(envId)
  if (existing) {
    // 已经是目标状态就什么都不做，避免每次工具调用都把窗口 show + focus 一次
    if (existing.headless !== headless) applyHeadless(existing, headless)
    return existing
  }
  const env = storage.envs.find((item) => item.id === envId)
  if (!env) throw new Error(mt('main.err.noEnv', { id: envId }))
  const ses = session.fromPartition(`persist:${envId}`)
  const ua = chromeUserAgent()
  ses.setUserAgent(ua)
  configurePermissions(ses, envId)
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
      sandbox: true,
      backgroundThrottling: false
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
    screenStartedAt: undefined,
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
  lockView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(lockHtml())}`)
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
    if (runtime.popupPayload?.kind === 'suggest' && runtime.suggestPayload) {
      popupView.webContents.send('suggest:data', runtime.suggestPayload)
    }
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
    const pending = sessionTimers.get(envId)
    if (pending) clearTimeout(pending)
    sessionTimers.delete(envId)
    saveSessionNow(runtime)
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
    throw new Error(mt('main.err.headlessLimit', { limit: storage.settings.headlessLimit }))
  }
  if (headless && headlessCount() >= storage.settings.headlessLimit && !runtime.headless) {
    throw new Error(mt('main.err.headlessLimit', { limit: storage.settings.headlessLimit }))
  }
  const previous = runtime.headless
  runtime.headless = headless
  if (headless) {
    if (!previous) runtime.win.hide()
  } else if (previous) {
    // 只在从无头切回有头时显示并聚焦；已经是有头窗口时不要抢焦点
    runtime.win.show()
    runtime.win.focus()
  }
  const env = storage.envs.find((item) => item.id === runtime.envId)
  if (env) runtime.win.setTitle(`${env.name} · BrowserPilot`)
}

const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()
let restoringSession = false

function sessionTabs(runtime: WindowRuntime): { url: string; title: string; groupId: string | null }[] {
  return runtime.tabs
    .filter((tab) => tab.kind === 'page' && tab.url && !tab.url.startsWith('browserpilot://'))
    .map((tab) => ({ url: tab.url, title: tab.title, groupId: tab.groupId }))
}

export function saveSessionNow(runtime: WindowRuntime): void {
  if (restoringSession) return
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  storage.saveSession(runtime.envId, {
    tabs: sessionTabs(runtime),
    activeUrl: active?.kind === 'page' ? active.url : undefined
  })
}

function scheduleSessionSave(runtime: WindowRuntime): void {
  const old = sessionTimers.get(runtime.envId)
  if (old) clearTimeout(old)
  sessionTimers.set(
    runtime.envId,
    setTimeout(() => {
      sessionTimers.delete(runtime.envId)
      saveSessionNow(runtime)
    }, 500)
  )
}

function addHibernatedTab(runtime: WindowRuntime, item: { url: string; title: string; groupId?: string | null }): TabRuntime {
  const tab: TabRuntime = {
    id: createId('tab'),
    envId: runtime.envId,
    groupId: item.groupId ?? null,
    kind: 'page',
    title: item.title || mt('shell.tabs.untitled'),
    url: item.url,
    loading: false,
    progress: 0,
    control: 'free',
    handoffMessage: '',
    userTookOver: false,
    refs: new Map(),
    documentHtml: '',
    hibernated: true
  }
  runtime.tabs.push(tab)
  return tab
}

function restoreSession(runtime: WindowRuntime): boolean {
  const saved = storage.sessionFor(runtime.envId)
  const tabs = (saved?.tabs ?? [])
    .filter((item) => item && typeof item.url === 'string' && item.url && !item.url.startsWith('browserpilot://'))
    .slice(0, 20)
  if (!tabs.length) return false
  restoringSession = true
  for (const item of tabs) addHibernatedTab(runtime, item)
  const active = runtime.tabs.find((tab) => tab.kind === 'page' && tab.url === saved?.activeUrl) ?? runtime.tabs[runtime.tabs.length - 1]
  restoringSession = false
  if (active) activateTab(runtime, active.id)
  return true
}

export function toggleBookmark(runtime: WindowRuntime, tab: TabRuntime): boolean {
  const added = storage.toggleBookmark({ envId: runtime.envId, url: tab.url, title: tab.title, favicon: tab.favicon })
  bridge.broadcast(runtime.envId)
  return added
}

export function openBookmark(runtime: WindowRuntime, url: string): void {
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  if (active?.kind === 'page') {
    const wc = active.view?.webContents
    // 视图可能已经被休眠、崩溃或回收，这时没有 webContents，直接复用会炸
    if (!active.hibernated && wc && !wc.isDestroyed()) {
      void wc.loadURL(url).catch(() => undefined)
      return
    }
    active.hibernated = false
    active.url = url
    if (restoreTabView(active)) return
    addTab(runtime, url)
    return
  }
  addTab(runtime, url)
}

export function hibernateTab(runtime: WindowRuntime, tabId: string): boolean {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab || tab.kind !== 'page' || tab.hibernated || tab.id === runtime.activeTabId) return false
  const view = tab.view
  tab.view = undefined
  tab.hibernated = true
  tab.loading = false
  tab.progress = 0
  if (view) {
    try {
      view.webContents.close()
    } catch {
      /* 已经关闭 */
    }
    try {
      runtime.win.contentView.removeChildView(view)
    } catch {
      /* 已经不在树上 */
    }
  }
  scheduleSessionSave(runtime)
  bridge.layout(runtime.envId)
  bridge.broadcast(runtime.envId)
  return true
}

export function hibernateOtherTabs(runtime: WindowRuntime): number {
  let count = 0
  for (const tab of runtime.tabs) {
    if (tab.id !== runtime.activeTabId && hibernateTab(runtime, tab.id)) count += 1
  }
  return count
}

export function openEnvironment(envId: string, headless: boolean): WindowRuntime {
  if (headless && !windows.has(envId) && headlessCount() >= storage.settings.headlessLimit) {
    throw new Error(mt('main.err.headlessLimit', { limit: storage.settings.headlessLimit }))
  }
  const runtime = createBrowserWindow(envId, headless)
  if (runtime.tabs.length === 0) {
    if (!restoreSession(runtime)) addTab(runtime, startUrl())
  }
  applyHeadless(runtime, headless)
  bridge.layout(envId)
  bridge.broadcast(envId)
  return runtime
}

export function addTab(runtime: WindowRuntime, url?: string, groupId: string | null = null, afterId?: string | null, focus = true): TabRuntime {
  const tab: TabRuntime = {
    id: createId('tab'),
    envId: runtime.envId,
    groupId,
    kind: 'page',
    title: mt('shell.tabs.untitled'),
    url: url || startUrl(),
    loading: true,
    progress: 0,
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
  activateTab(runtime, tab.id, focus)
  void view.webContents.loadURL(tab.url)
  return tab
}

function openBuiltin(runtime: WindowRuntime, kind: 'market' | 'settings' | 'downloads' | 'runs' | 'history' | 'bookmarks', title: string, url: string): TabRuntime {
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
    progress: 0,
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
    items.push({ label: mt('main.menu.openInNewTab'), click: () => addTab(runtime, info.href!) })
    items.push({ label: mt('main.menu.copyLink'), click: () => clipboard.writeText(info.href!) })
  }
  if (info?.kind === 'image' && info.src) {
    items.push({ label: mt('main.menu.viewImage'), click: () => addTab(runtime, info.src!) })
    items.push({ label: mt('main.menu.saveImageAs'), click: () => void saveMediaAs(runtime, tab, { srcURL: info.src!, mediaType: 'image', x, y }) })
    items.push({ label: mt('main.menu.copyImage'), click: () => wc.copyImageAt(x, y) })
    items.push({ label: mt('main.menu.copyImageAddress'), click: () => clipboard.writeText(info.src!) })
  }
  if ((info?.kind === 'video' || info?.kind === 'audio') && info.src) {
    items.push({
      label: info.kind === 'video' ? mt('main.menu.saveVideoAs') : mt('main.menu.saveAudioAs'),
      click: () => void saveMediaAs(runtime, tab, { srcURL: info.src!, mediaType: info.kind as 'video' | 'audio', x, y })
    })
  }
  if (info?.kind === 'input') {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: mt('main.menu.cut'), role: 'cut' })
    items.push({ label: mt('main.menu.copy'), role: 'copy' })
    items.push({ label: mt('main.menu.paste'), role: 'paste' })
  }
  if (info?.text) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: mt('main.menu.copy'), role: 'copy' })
  }
  if (items.length) items.push({ type: 'separator' })
  items.push({
    label: mt('main.menu.inspect'),
    click: () => {
      wc.openDevTools({ mode: 'detach' })
      wc.inspectElement(x, y)
    }
  })
  items.push({
    label: mt('main.menu.nativeMenu'),
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
  const labels: Record<string, string> = { mp4: mt('main.label.mp4'), m4a: mt('main.label.m4a'), png: mt('main.label.png'), jpg: mt('main.label.jpg'), jpeg: mt('main.label.jpeg'), webp: mt('main.label.webp'), gif: mt('main.label.gif'), svg: mt('main.label.svg') }
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
    title: mt('main.dialog.saveAs'),
    defaultPath: suggested || undefined,
    filters: [{ name: labels[kind] || kind.toUpperCase(), extensions: [kind] }, { name: mt('main.dialog.allFiles'), extensions: ['*'] }]
  })
  if (picked.canceled || !picked.filePath) return
  const filePath = /\.[a-z0-9]{2,5}$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.${kind}`
  try {
    if ((params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
      const dlId = downloadBegin(filePath.split(/[\\/]/).pop() || suggested || params.mediaType, params.srcURL, '', 0, undefined, undefined, runtime.envId)
      try {
        const saved = await saveMediaInfo(
          tab,
          { kind: params.mediaType, tag: params.mediaType.toUpperCase(), src: params.srcURL, rect: { x: params.x, y: params.y, w: 0, h: 0 } },
          downloadTargetDir(),
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
    await saveMedia(tab, { point: { x: params.x, y: params.y } }, downloadTargetDir(), filePath)
  } catch (error) {
    dialog.showErrorBox(mt('main.err.saveFailed'), error instanceof Error ? error.message : String(error))
  }
}

export function openMarket(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'market', mt('address.kind.market'), MARKET_PAGE)
}

export function openSettingsPage(runtime: WindowRuntime, _section = ''): TabRuntime {
  return openBuiltin(runtime, 'settings', mt('address.kind.settings'), SETTINGS_PAGE)
}

export function openDownloadsPage(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'downloads', mt('address.kind.downloads'), DOWNLOADS_PAGE)
}

export function openHistoryPage(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'history', mt('address.kind.history'), HISTORY_PAGE)
}

export function openBookmarksPage(runtime: WindowRuntime): TabRuntime {
  return openBuiltin(runtime, 'bookmarks', mt('address.kind.bookmarks'), BOOKMARKS_PAGE)
}

function mountPopup(runtime: WindowRuntime, payload: LayerPayload): void {
  runtime.popupPayload = payload
  runtime.popupOpen = true
  layoutWindow(runtime.envId)
  runtime.popupView?.webContents.send('layer:show', payload)
}

export function closePopup(runtime: WindowRuntime): void {
  runtime.popupOpen = false
  runtime.popupPayload = null
  runtime.suggestPayload = undefined
  layoutWindow(runtime.envId)
}

export function showSuggestions(runtime: WindowRuntime, payload: SuggestPayload): void {
  runtime.suggestPayload = payload
  mountPopup(runtime, { kind: 'suggest' })
  runtime.popupView?.webContents.send('suggest:data', payload)
}

export function hideSuggestions(runtime: WindowRuntime): void {
  if (runtime.popupPayload?.kind !== 'suggest') return
  closePopup(runtime)
  runtime.win.webContents.send('suggest:hide-ui')
}

export function focusTabSearch(runtime: WindowRuntime): void {
  if (!runtime.headless) showPopup(runtime, { kind: 'tabs' })
}

export function showPopup(runtime: WindowRuntime, payload: LayerPayload): void {
  runtime.suggestPayload = undefined
  mountPopup(runtime, payload)
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
  return openBuiltin(runtime, 'runs', mt('address.kind.runs'), url)
}

export function openWorkflowPage(runtime: WindowRuntime, workflowId: string): TabRuntime {
  const app = storage.workflows.find((item) => item.id === workflowId)
  if (!app) throw new Error(mt('main.err.noWorkflow', { id: workflowId }))
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
    progress: 0,
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

export function activateTab(runtime: WindowRuntime, tabId: string, focus = true): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab) throw new Error(mt('main.err.noTab', { id: tabId }))
  runtime.activeTabId = tabId
  if (tab.kind === 'page' && tab.hibernated) {
    tab.hibernated = false
    restoreTabView(tab)
  }
  scheduleSessionSave(runtime)
  bridge.layout(runtime.envId)
  bridge.broadcast(runtime.envId)
  // Agent 后台操作不要每次都把窗口拽到前台，只有用户主动切换标签时才聚焦
  if (focus && !runtime.headless) runtime.win.focus()
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
  if (index < 0) throw new Error(mt('main.err.noTab', { id: tabId }))
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
  scheduleSessionSave(runtime)
  bridge.layout(runtime.envId)
  bridge.broadcast(runtime.envId)
}

/** 渲染进程崩溃/被销毁后，给标签重建 WebContentsView 并重新加载原地址 */
export function restoreTabView(tab: TabRuntime): boolean {
  const runtime = windows.get(tab.envId)
  if (!runtime || tab.kind !== 'page') return false
  if (tab.view?.webContents && !tab.view.webContents.isDestroyed()) return true
  tab.hibernated = false
  const old = tab.view
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
  if (old) {
    try {
      runtime.win.contentView.removeChildView(old)
    } catch {
      /* 已经不在树上 */
    }
  }
  runtime.win.contentView.addChildView(view)
  bindPage(runtime, tab)
  const active = runtime.activeTabId === tab.id
  view.setVisible(active)
  if (active) view.setBounds(runtime.bounds)
  void view.webContents.loadURL(tab.url)
  bridge.layout(runtime.envId)
  return true
}

export function duplicateTab(runtime: WindowRuntime, tabId: string): TabRuntime | undefined {
  const tab = runtime.tabs.find((item) => item.id === tabId && item.kind === 'page')
  if (!tab) return undefined
  return addTab(runtime, tab.url, tab.groupId, tab.id)
}

export function reloadTab(runtime: WindowRuntime, tabId: string): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  if (!tab) return
  const wc = tab.view?.webContents
  if (wc && !wc.isDestroyed()) {
    wc.reload()
    return
  }
  if (tab.kind === 'page' && tab.hibernated) {
    tab.hibernated = false
    restoreTabView(tab)
    return
  }
  runtime.win.webContents.send('builtin-reload', tab.id)
}

export function muteTab(runtime: WindowRuntime, tabId: string): void {
  const tab = runtime.tabs.find((item) => item.id === tabId)
  const wc = tab?.view?.webContents
  if (!tab || !wc || wc.isDestroyed()) return
  tab.muted = !tab.muted
  wc.setAudioMuted(Boolean(tab.muted))
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
    const show = active?.id === tab.id && active.kind === 'page' && !active.error
    tab.view.setVisible(show)
    if (show) tab.view.setBounds(runtime.bounds)
  }
  placeRail(runtime)
  const lock = runtime.lockView
  if (lock) {
    const showLock = Boolean(active && active.kind === 'page' && active.control === 'agent')
    lock.setVisible(showLock)
    if (showLock) {
      // Electron 44 在 Linux 上先 remove 再 add 会把视图标成 hidden（画面不刷新但输入还进得去）；
      // 只 addChildView 重排即可到最前，不要 remove。
      const children = runtime.win.contentView.children
      if (children[children.length - 1] !== lock) runtime.win.contentView.addChildView(lock)
      lock.setBounds(runtime.bounds)
    }
  }
  const popup = runtime.popupView
  if (!popup) return
  if (runtime.popupOpen) {
    const [width, height] = runtime.win.getContentSize()
    if (runtime.popupPayload?.kind === 'suggest') {
      popup.setBounds({ x: 0, y: runtime.bounds.y, width, height: Math.max(1, height - runtime.bounds.y) })
    } else {
      popup.setBounds({ x: 0, y: 0, width, height })
    }
    popup.setVisible(true)
    const children = runtime.win.contentView.children
    if (children[children.length - 1] !== popup) runtime.win.contentView.addChildView(popup)
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
    // 同上：只重排，不 remove
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

function watchDownloads(ses: Electron.Session, envId: string): void {
  if (watchedSessions.has(ses)) return
  watchedSessions.add(ses)
  ses.on('will-download', (_event, item) => {
    const dir = downloadTargetDir()
    const name = item.getFilename() || mt('main.placeholder.unnamedFile')
    let target = join(dir, name)
    let n = 1
    while (existsSync(target)) {
      const dot = name.lastIndexOf('.')
      target = join(dir, dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`)
      n += 1
    }
    item.setSavePath(target)
    registerSessionDownload(item, target, envId)
  })
}

function bindPage(runtime: WindowRuntime, tab: TabRuntime): void {
  const wc = tab.view!.webContents
  watchDownloads(wc.session, runtime.envId)
  watchDialogs(wc, tab.id)
  watchConsole(wc)
  wc.on('will-prevent-unload', (event) => event.preventDefault())
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
          title: mt('main.placeholder.unnamedFile')
        }
      }
    }
    if (url) addTab(runtime, url)
    return { action: 'deny' }
  })
  const sync = (): void => {
    tab.loading = wc.isLoading()
    if (tab.kind === 'market' || tab.kind === 'settings' || tab.kind === 'downloads' || tab.kind === 'runs') {
      tab.title = tab.kind === 'market' ? mt('address.kind.market') : tab.kind === 'settings' ? mt('address.kind.settings') : tab.kind === 'downloads' ? mt('address.kind.downloads') : mt('address.kind.runs')
      tab.url = tab.kind === 'market' ? MARKET_PAGE : tab.kind === 'settings' ? SETTINGS_PAGE : tab.kind === 'downloads' ? DOWNLOADS_PAGE : tab.url.startsWith(RUNS_PAGE) ? tab.url : RUNS_PAGE
    } else {
      tab.title = wc.getTitle() || tab.title
      tab.url = wc.getURL() || tab.url
      rememberSite(runtime.envId, tab.url)
      scheduleSessionSave(runtime)
    }
    bridge.broadcast(runtime.envId)
  }
  const rememberHistory = (): void => {
    if (tab.kind !== 'page') return
    const url = wc.getURL()
    if (!url || !recordableUrl(url)) return
    storage.addHistory({ envId: runtime.envId, url, title: wc.getTitle() || url, favicon: tab.favicon })
  }
  const setProgress = (value: number): void => {
    if (tab.progress === value) return
    tab.progress = value
    bridge.broadcast(runtime.envId)
  }
  wc.on('page-title-updated', () => {
    rememberHistory()
    sync()
  })
  wc.on('page-favicon-updated', (_event, favicons) => {
    const next = favicons[0] || ''
    if (tab.favicon === next) return
    tab.favicon = next
    bridge.broadcast(runtime.envId)
  })
  wc.on('media-started-playing', () => {
    if (tab.audible) return
    tab.audible = true
    bridge.broadcast(runtime.envId)
  })
  wc.on('media-paused', () => {
    if (!tab.audible) return
    tab.audible = false
    bridge.broadcast(runtime.envId)
  })
  wc.on('did-navigate', () => {
    tab.audible = false
    rememberHistory()
    sync()
  })
  wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return
    if (tab.error) {
      tab.error = undefined
      bridge.layout(runtime.envId)
    }
    tab.progress = 8
    bridge.broadcast(runtime.envId)
  })
  wc.on('did-start-loading', sync)
  wc.on('did-stop-loading', () => {
    setProgress(100)
    sync()
  })
  wc.on('dom-ready', () => setProgress(Math.max(tab.progress, 55)))
  wc.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (isMainFrame) setProgress(Math.max(tab.progress, 85))
  })
  wc.on('did-finish-load', () => {
    setProgress(100)
    rememberHistory()
    sync()
  })
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    tab.error = { code, description, url: url || wc.getURL() || tab.url }
    if (url) tab.url = url
    tab.title = wc.getTitle() || tab.title
    tab.loading = false
    tab.progress = 0
    bridge.layout(runtime.envId)
    bridge.broadcast(runtime.envId)
  })
  wc.on('did-navigate-in-page', () => {
    rememberHistory()
    sync()
  })
}

function recordableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
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
    if (ctrl && key === 'l' && !input.alt) {
      runtime.win.webContents.send('focus-address')
      handled()
      return
    }
    if (ctrl && key === 'd') {
      const page = activePage(runtime)
      if (page) toggleBookmark(runtime, page)
      handled()
      return
    }
    if (!ctrl && input.alt && key === 'd') {
      runtime.win.webContents.send('focus-address')
      handled()
      return
    }
    if (ctrl && key === 'h') {
      openHistoryPage(runtime)
      handled()
      return
    }
    if (ctrl && input.shift && key === 'a') {
      focusTabSearch(runtime)
      handled()
      return
    }
    if (ctrl && input.shift && key === 'o') {
      openBookmarksPage(runtime)
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
    if (!found) throw new Error(mt('main.err.noTab', { id: args.tabId }))
    if (found.tab.kind !== 'page') throw new Error(mt('main.err.notPage'))
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

export function pageFromSender(sender: Electron.WebContents): { runtime: WindowRuntime; tab: TabRuntime } | undefined {
  for (const runtime of windows.values()) {
    const tab = runtime.tabs.find((item) => item.view?.webContents === sender)
    if (tab) return { runtime, tab }
  }
  return undefined
}
