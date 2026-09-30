import { app, BrowserWindow, desktopCapturer, session, webContents } from 'electron'
import { join } from 'path'
import { applyUserAgentFallback } from './ua'
import { storage } from './services/store'
import { wireIpc, broadcast } from './ipc'
import { bootDefaultWindow } from './windows'
import { startMcp } from './services/McpService'
import { windows } from './runtime'

applyUserAgentFallback()
app.setPath('userData', join(app.getPath('appData'), 'BrowserPilot'))

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
    storage.load()
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
    await startMcp()
    broadcast()
  })

  app.on('window-all-closed', () => {
    if (windows.size === 0) app.quit()
  })
}
