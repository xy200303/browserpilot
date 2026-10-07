import { shell } from 'electron'
import { createId } from '../ids'
import { bridge } from '../runtime'

export type DownloadItem = {
  id: string
  name: string
  url: string
  path: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  doneAt?: number
}

const downloads: DownloadItem[] = []

function emit(): void {
  bridge.broadcast()
}

export function listDownloads(): DownloadItem[] {
  return downloads
}

export function downloadBegin(name: string, url: string, path = '', totalBytes = 0): string {
  const item: DownloadItem = {
    id: createId('dl'),
    name,
    url,
    path,
    totalBytes,
    receivedBytes: 0,
    state: 'progressing',
    startedAt: Date.now()
  }
  downloads.unshift(item)
  if (downloads.length > 100) downloads.pop()
  emit()
  return item.id
}

export function downloadProgress(id: string, receivedBytes: number, totalBytes?: number): void {
  const item = downloads.find((entry) => entry.id === id)
  if (!item || item.state !== 'progressing') return
  item.receivedBytes = receivedBytes
  if (totalBytes) item.totalBytes = totalBytes
  emit()
}

export function downloadDone(id: string, path: string): void {
  const item = downloads.find((entry) => entry.id === id)
  if (!item) return
  item.state = 'completed'
  item.path = path
  item.doneAt = Date.now()
  emit()
}

export function downloadFail(id: string, error: string): void {
  const item = downloads.find((entry) => entry.id === id)
  if (!item) return
  item.state = 'failed'
  item.error = error
  item.doneAt = Date.now()
  emit()
}

export function downloadsClear(): void {
  for (let i = downloads.length - 1; i >= 0; i -= 1) {
    if (downloads[i].state !== 'progressing') downloads.splice(i, 1)
  }
  emit()
}

export function downloadOpen(id: string): void {
  const item = downloads.find((entry) => entry.id === id)
  if (item?.path) void shell.openPath(item.path)
}

export function downloadShow(id: string): void {
  const item = downloads.find((entry) => entry.id === id)
  if (item?.path) shell.showItemInFolder(item.path)
}
