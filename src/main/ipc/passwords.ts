import { ipcMain } from 'electron'
import { storage } from '../services/store'
import {
  autofillFor,
  markPasswordUsed,
  clearPasswords,
  listPasswords,
  removePassword,
  revealPassword,
  savePassword
} from '../services/PasswordService'
import { originOf, pageFromSender, windowFromSender } from '../windows'
import { broadcast } from './state'

export function registerPasswordIpc(): void {
  ipcMain.on('page:credentials', (event, payload: { username?: string; password?: string }) => {
    if (!storage.settings.passwordSave) return
    const found = pageFromSender(event.sender)
    if (!found) return
    // 只认发送页自己的 origin，页面脚本传什么都不算
    const origin = originOf(event.sender.getURL())
    if (!origin) return
    const username = typeof payload?.username === 'string' ? payload.username : ''
    const password = typeof payload?.password === 'string' ? payload.password : ''
    if (!password) return
    const saved = savePassword(found.runtime.envId, origin, username, password)
    if (saved) broadcast(found.runtime.envId)
  })

  ipcMain.handle('page:autofill', (event) => {
    if (!storage.settings.passwordAutofill) return null
    const found = pageFromSender(event.sender)
    if (!found) return null
    const origin = originOf(event.sender.getURL())
    if (!origin) return null
    return autofillFor(found.runtime.envId, origin)
  })

  ipcMain.on('page:autofilled', (event, origin: string) => {
    const found = pageFromSender(event.sender)
    if (!found) return
    const own = originOf(event.sender.getURL())
    if (!own || own !== origin) return
    markPasswordUsed(found.runtime.envId, own)
  })

  ipcMain.handle('passwords:list', (event) => {
    const runtime = windowFromSender(event.sender)
    return runtime ? listPasswords(runtime.envId) : []
  })

  ipcMain.handle('passwords:reveal', (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return null
    const item = storage.passwords.find((entry) => entry.id === id && entry.envId === runtime.envId)
    return item ? revealPassword(item.id) : null
  })

  ipcMain.handle('passwords:delete', (event, id: string) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return { ok: false }
    const item = storage.passwords.find((entry) => entry.id === id && entry.envId === runtime.envId)
    const ok = item ? removePassword(item.id) : false
    if (ok) broadcast(runtime.envId)
    return { ok }
  })

  ipcMain.handle('passwords:clear', (event) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return { ok: false }
    clearPasswords(runtime.envId)
    broadcast(runtime.envId)
    return { ok: true }
  })
}
