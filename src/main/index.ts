import { app, BrowserWindow, desktopCapturer, session, webContents } from 'electron'
import { join } from 'path'
import { applyUserAgentFallback } from './ua'
import { storage } from './services/store'
import { wireIpc, broadcast } from './ipc'
import { bootDefaultWindow, reapIdle } from './windows'
import { startMcp } from './services/McpService'
import { cleanupEnvs, cleanupIfDue, cacheCleanupDue, waitCacheCleanup } from './services/CacheService'
import { runDepth, windows } from './runtime'
import { applyMainLanguage } from './i18n'

applyUserAgentFallback()
app.setPath('userData', join(app.getPath('appData'), 'BrowserPilot'))

// 主进程里一个没接住的异常会弹系统错误框并打断使用。记进日志，别让整个应用停在这里。
process.on('uncaughtException', (error) => {
  console.error('[main uncaught]', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main rejection]', reason)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = windows.get('env-default')?.win ?? BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    app.on('browser-window-created', (_event, win) => {
      // OAuth/支付弹窗要立刻到最前，不然用户看不到
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return
        win.show()
        win.focus()
      })
    })
    storage.load()
    applyMainLanguage(storage.settings.language)
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      const contents = request.frame ? webContents.fromFrame(request.frame) : undefined
      const win = contents ? BrowserWindow.fromWebContents(contents) : null
      if (!win) {
        callback({})
        return
      }
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const source = sources.find((item) => item.id === win.getMediaSourceId())
      callback(source ? { video: { id: source.id, name: source.name } } : {})
    })
    wireIpc()
    bootDefaultWindow()
    // 一分钟看一次空闲：非活动标签休眠、最小化的窗口关掉
    setInterval(reapIdle, 60_000).unref()
    storage.pruneStorage('auto')
    // 长会话也要定期收敛截图和运行记录，不能只靠下次启动
    setInterval(() => storage.pruneStorage('auto'), 24 * 60 * 60_000).unref()
    // 启动时先清没开着的环境；开着的那扇等两分钟，避开刚启动的页面加载
    const due = cacheCleanupDue()
    void cleanupIfDue(new Set(windows.keys())).then((count) => {
      if (count) console.log('[cache] cleaned', count, 'environments')
    })
    if (due) {
      setTimeout(() => {
        if (runDepth > 0) return
        void cleanupEnvs([...windows.keys()]).then((count) => {
          if (count) console.log('[cache] cleaned', count, 'open environments')
        })
      }, 120_000).unref()
    }
    await startMcp()
    broadcast()
  })

  app.on('window-all-closed', () => {
    if (windows.size !== 0) return
    // 关窗清理可能还在排队，等它跑完再退，最多 3 秒
    void waitCacheCleanup().finally(() => app.quit())
  })
}
