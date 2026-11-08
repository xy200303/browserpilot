import { ipcMain } from 'electron'
import type { LayerPayload, SuggestPayload } from '@shared/types'
import { broadcast } from './state'
import {
  activateTab,
  closePopup,
  hideSuggestions,
  layoutWindow,
  openBookmark,
  showPopup,
  showSuggestions,
  windowFromSender
} from '../windows'

export function registerLayerIpc(): void {
  ipcMain.handle('layer:open', (event, payload: LayerPayload) => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    let next = payload
    const rail = runtime.railView
    if (rail && rail.webContents.id === event.sender.id && (payload.kind === 'context' || payload.kind === 'menu')) {
      const box = rail.getBounds()
      next = { ...payload, x: payload.x + box.x, y: payload.y + box.y }
    }
    showPopup(runtime, next)
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
    if (runtime) closePopup(runtime)
  })

  ipcMain.on('suggest:update', (event, payload: SuggestPayload) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) showSuggestions(runtime, payload)
  })

  ipcMain.on('suggest:hide', (event) => {
    const runtime = windowFromSender(event.sender)
    if (runtime) hideSuggestions(runtime)
  })

  ipcMain.on('suggest:pick', (event, key: string) => {
    const runtime = windowFromSender(event.sender)
    const item = runtime?.suggestPayload?.items.find((entry) => entry.key === key)
    if (!runtime || !item) return
    hideSuggestions(runtime)
    if (item.kind === 'tab' && item.tabId) {
      activateTab(runtime, item.tabId)
      runtime.win.webContents.focus()
      return
    }
    openBookmark(runtime, item.url)
    runtime.win.webContents.focus()
  })

  ipcMain.on('suggest:filter', (event, key: 'history' | 'bookmarks' | 'tabs') => {
    const runtime = windowFromSender(event.sender)
    if (!runtime) return
    runtime.win.webContents.send('suggest:filter-ui', key)
    runtime.win.webContents.focus()
  })
}
