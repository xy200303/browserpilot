import { ipcMain, session } from 'electron'
import { storage } from '../services/store'
import { clearEnvCache } from '../services/CacheService'
import { broadcast } from './state'
import {
  addTab,
  focusTabSearch,
  hibernateOtherTabs,
  hibernateTab,
  openBookmark,
  openBookmarksPage,
  openHistoryPage,
  toggleBookmark,
  windowFromSender
} from '../windows'

export function registerLibraryIpc(): void {
  ipcMain.handle('menu:history', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openHistoryPage(runtime)
  })

  ipcMain.handle('history:list', (event) => {
    const runtime = windowFromSender(event.sender)
    return runtime ? storage.historyFor(runtime.envId) : []
  })

  ipcMain.handle('history:delete', (event, id: string) => {
    storage.deleteHistory(id)
    const runtime = windowFromSender(event.sender)
    if (runtime) broadcast(runtime.envId)
  })

  ipcMain.handle('history:clear', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    storage.clearHistory(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('history:open', (event, url: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) addTab(runtime, url)
  })

  ipcMain.handle('menu:bookmarks', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openBookmarksPage(runtime)
  })

  ipcMain.handle('menu:tabSearch', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) focusTabSearch(runtime)
  })

  ipcMain.handle('bookmarks:toggle', (event) => {
    const runtime = windowFromSender(event.sender)
    const tab = runtime?.tabs.find((item) => item.id === runtime.activeTabId && item.kind === 'page')
    if (!runtime || !tab) return { bookmarked: false }
    return { bookmarked: toggleBookmark(runtime, tab) }
  })

  ipcMain.handle('bookmarks:delete', (event, id: string) => {
    storage.removeBookmark(id)
    const runtime = windowFromSender(event.sender)
    if (runtime) broadcast(runtime.envId)
  })

  ipcMain.handle('bookmarks:clear', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    storage.clearBookmarks(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('bookmarks:open', (event, url: string) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) openBookmark(runtime, url)
  })

  ipcMain.handle('permissions:revoke', (event, id: string) => {
    storage.revokePermission(id)
    const runtime = windowFromSender(event.sender)
    if (runtime) broadcast(runtime.envId)
  })

  ipcMain.handle('permissions:clear', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    storage.clearPermissions(runtime.envId)
    broadcast(runtime.envId)
  })

  ipcMain.handle('data:clear', async (event, options: { history?: boolean; cookies?: boolean; cache?: boolean }) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return { ok: false }
    if (options.history) storage.clearHistory(runtime.envId)
    if (options.cookies) {
      const ses = session.fromPartition(`persist:${runtime.envId}`)
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'shadercache', 'filesystem']
      })
    }
    if (options.cache) {
      // HTTP 缓存只是零头，Service Worker 缓存才是大头；登录数据不动
      await clearEnvCache(runtime.envId)
    }
    broadcast(runtime.envId)
    return { ok: true }
  })

  ipcMain.handle('data:usage', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return null
    return storage.diskUsage()
  })

  ipcMain.handle('data:prune', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return { files: 0, bytes: 0 }
    return storage.pruneStorage()
  })

  ipcMain.handle('tab:hibernate', (event, tabId: string) => {
    const runtime = windowFromSender(event.sender)
    return { ok: runtime ? hibernateTab(runtime, tabId) : false }
  })

  ipcMain.handle('tab:hibernateOthers', (event) => {
    const runtime = windowFromSender(event.sender)
    return { count: runtime ? hibernateOtherTabs(runtime) : 0 }
  })

}
