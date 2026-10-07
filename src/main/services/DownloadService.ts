import { clipboard, shell, type DownloadItem as ElectronDownloadItem, type WebContents } from 'electron'
import { createId } from '../ids'
import { bridge } from '../runtime'

export type DownloadItem = {
  id: string
  name: string
  url: string
  path: string
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

export function downloadBegin(name: string, url: string, path = '', totalBytes = 0, retry?: () => void, native?: ElectronDownloadItem): string {
  const id = createId('dl')
  entries.set(id, {
    item: { id, name, url, path, totalBytes, receivedBytes: 0, state: 'progressing', startedAt: Date.now() },
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
  if (entry?.native && entry.item.state === 'progressing' && entry.native.canResume()) {
    entry.native.pause()
    entry.item.state = 'paused'
    emit()
  }
}

export function downloadResume(id: string): void {
  const entry = entryOf(id)
  if (entry?.native && entry.item.state === 'paused' && entry.native.canResume()) {
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

export function registerSessionDownload(item: ElectronDownloadItem, savePath: string): void {
  const id = downloadBegin(item.getFilename() || '下载文件', item.getURL(), savePath, 0, undefined, item)
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
