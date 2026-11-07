import { app, clipboard, shell, type DownloadItem as ElectronDownloadItem } from 'electron'
import { mkdirSync } from 'fs'
import { createId } from '../ids'
import { bridge } from '../runtime'
import { storage } from './store'

export type DownloadItem = {
  id: string
  name: string
  url: string
  path: string
  envId?: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'paused' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  doneAt?: number
}

type Entry = {
  item: DownloadItem
  native?: ElectronDownloadItem
  retry?: () => void
}

const entries = new Map<string, Entry>()
const order: string[] = []

function emit(): void {
  bridge.broadcast()
}

function entryOf(id: string): Entry | undefined {
  return entries.get(id)
}

export function listDownloads(): DownloadItem[] {
  return order.map((id) => entries.get(id)!.item).filter(Boolean)
}

/**
 * 默认下载目录跟着系统走：Windows 的「下载」、macOS 的 Downloads、
 * Linux 的 XDG 下载目录（通常是 ~/Downloads）。
 */
export function defaultDownloadDir(): string {
  return app.getPath('downloads')
}

export function downloadTargetDir(): string {
  const custom = storage.settings.downloadDir.trim()
  if (custom) {
    try {
      mkdirSync(custom, { recursive: true })
      return custom
    } catch {
      // 自定义目录不可用（盘符拔掉、无权限）时退回系统下载目录，不让下载直接失败
    }
  }
  const dir = defaultDownloadDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function downloadBegin(name: string, url: string, path = '', totalBytes = 0, retry?: () => void, native?: ElectronDownloadItem, envId?: string): string {
  const id = createId('dl')
  entries.set(id, {
    item: { id, name, url, path, envId, totalBytes, receivedBytes: 0, state: 'progressing', startedAt: Date.now() },
    native,
    retry
  })
  order.unshift(id)
  while (order.length > 100) {
    const last = order.pop()!
    entries.delete(last)
  }
  emit()
  return id
}

export function downloadProgress(id: string, receivedBytes: number, totalBytes?: number): void {
  const entry = entryOf(id)
  if (!entry || entry.item.state !== 'progressing') return
  entry.item.receivedBytes = receivedBytes
  if (totalBytes) entry.item.totalBytes = totalBytes
  emit()
}

export function downloadDone(id: string, path: string): void {
  const entry = entryOf(id)
  if (!entry) return
  entry.item.state = 'completed'
  entry.item.path = path
  entry.item.doneAt = Date.now()
  emit()
}

export function downloadFail(id: string, error: string): void {
  const entry = entryOf(id)
  if (!entry) return
  entry.item.state = 'failed'
  entry.item.error = error
  entry.item.doneAt = Date.now()
  emit()
}

export function downloadsClear(): void {
  for (const [id, entry] of entries) {
    if (entry.item.state !== 'progressing' && entry.item.state !== 'paused') {
      entries.delete(id)
    }
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (!entries.has(order[i])) order.splice(i, 1)
  }
  emit()
}

export function downloadForget(id: string): boolean {
  const entry = entryOf(id)
  if (!entry) return false
  if (entry.item.state === 'progressing' || entry.item.state === 'paused') return false
  entries.delete(id)
  const at = order.indexOf(id)
  if (at >= 0) order.splice(at, 1)
  emit()
  return true
}

export function downloadOpen(id: string): void {
  const entry = entryOf(id)
  if (entry?.item.path) void shell.openPath(entry.item.path)
}

export function downloadShow(id: string): void {
  const entry = entryOf(id)
  if (entry?.item.path) shell.showItemInFolder(entry.item.path)
}

export function downloadCopyLink(id: string): void {
  const entry = entryOf(id)
  if (entry?.item.url) clipboard.writeText(entry.item.url)
}

export function downloadPause(id: string): void {
  const entry = entryOf(id)
  if (entry?.native && entry.item.state === 'progressing') {
    entry.native.pause()
    entry.item.state = 'paused'
    emit()
  }
}

export function downloadResume(id: string): void {
  const entry = entryOf(id)
  if (entry?.native && entry.item.state === 'paused') {
    entry.native.resume()
    entry.item.state = 'progressing'
    emit()
  }
}

export function downloadCancel(id: string): void {
  const entry = entryOf(id)
  if (!entry) return
  if (entry.native) entry.native.cancel()
  entry.item.state = 'cancelled'
  entry.item.doneAt = Date.now()
  emit()
}

export function downloadRetry(id: string): void {
  const entry = entryOf(id)
  if (entry?.retry) entry.retry()
}

export function registerSessionDownload(item: ElectronDownloadItem, savePath: string, envId?: string): void {
  const fallbackName = (() => {
    try {
      const base = decodeURIComponent(new URL(item.getURL()).pathname.split('/').filter(Boolean).pop() || '')
      if (base) return base
    } catch {
      /* 不是合法 URL */
    }
    return '下载文件'
  })()
  const raw = item.getFilename() || ''
  const id = downloadBegin(raw.includes('?') || !raw ? fallbackName : raw, item.getURL(), savePath, 0, undefined, item, envId)
  const entry = entryOf(id)
  item.on('updated', (_event, state) => {
    if (!entry) return
    if (state === 'interrupted') {
      downloadFail(id, '下载中断')
      return
    }
    if (entry.item.state === 'paused') return
    downloadProgress(id, item.getReceivedBytes(), item.getTotalBytes())
  })
  item.once('done', (_event, state) => {
    if (state === 'completed') downloadDone(id, item.getSavePath())
    else if (state === 'cancelled') {
      const e = entryOf(id)
      if (e && e.item.state !== 'cancelled') downloadFail(id, '已取消')
    } else downloadFail(id, '下载中断')
  })
}
