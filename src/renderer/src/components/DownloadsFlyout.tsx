import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, FolderOpen, Loader2, XCircle } from 'lucide-react'
import type { DownloadItem } from '../../../shared/types'
import { Button } from '@/components/ui/button'

function sizeText(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function Row({ item }: { item: DownloadItem }) {
  const pct = item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : -1
  return (
    <div className="grid gap-1 rounded-md border border-neutral-200 p-2">
      <div className="flex items-center gap-2">
        {item.state === 'progressing' && <Loader2 size={14} className="shrink-0 animate-spin text-blue-600" />}
        {item.state === 'completed' && <CheckCircle2 size={14} className="shrink-0 text-green-600" />}
        {(item.state === 'failed' || item.state === 'cancelled') && <XCircle size={14} className="shrink-0 text-red-500" />}
        <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
        {item.state === 'completed' && (
          <span className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon-sm" title="打开" onClick={() => void window.browser.openDownload(item.id)}>
              <Download />
            </Button>
            <Button variant="ghost" size="icon-sm" title="打开所在文件夹" onClick={() => void window.browser.showDownload(item.id)}>
              <FolderOpen />
            </Button>
          </span>
        )}
      </div>
      {item.state === 'progressing' && (
        <div className="h-1 overflow-hidden rounded bg-neutral-200">
          <div
            className={`h-full bg-blue-600 transition-all ${pct < 0 ? 'animate-pulse w-1/3' : ''}`}
            style={pct >= 0 ? { width: `${pct}%` } : undefined}
          />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {item.state === 'progressing' && (
          <span>{pct >= 0 ? `${pct}% · ` : ''}{sizeText(item.receivedBytes)}{item.totalBytes > 0 ? ` / ${sizeText(item.totalBytes)}` : ''}</span>
        )}
        {item.state === 'completed' && <span className="truncate">{sizeText(item.receivedBytes)} · {item.path}</span>}
        {(item.state === 'failed' || item.state === 'cancelled') && <span className="truncate">{item.error || '失败'}</span>}
      </div>
    </div>
  )
}

export function DownloadsFlyout({ downloads }: { downloads: DownloadItem[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const active = downloads.filter((item) => item.state === 'progressing').length

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} className="relative no-drag">
      <Button variant="ghost" size="icon" title="下载" onClick={() => setOpen(!open)} className="relative">
        <Download />
        {active > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-blue-600" />}
      </Button>
      {open && (
        <div className="absolute right-0 top-10 z-50 grid max-h-96 w-80 gap-2 overflow-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium">下载</span>
            {downloads.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void window.browser.clearDownloads()}>清除已完成</Button>
            )}
          </div>
          {downloads.length === 0 && <p className="px-1 py-4 text-center text-xs text-neutral-400">还没有下载</p>}
          {downloads.map((item) => <Row key={item.id} item={item} />)}
        </div>
      )}
    </div>
  )
}
