import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Download, FolderOpen, Loader2, Pause, Play, RotateCcw, XCircle } from 'lucide-react'
import type { DownloadItem, UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'

function sizeText(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function stateText(item: DownloadItem): string {
  if (item.state === 'progressing') {
    const pct = item.totalBytes > 0 ? ` · ${Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))}%` : ''
    return `下载中 ${sizeText(item.receivedBytes)}${item.totalBytes > 0 ? ` / ${sizeText(item.totalBytes)}` : ''}${pct}`
  }
  if (item.state === 'paused') return `已暂停 ${sizeText(item.receivedBytes)}`
  if (item.state === 'completed') return `${sizeText(item.receivedBytes)} · 已完成`
  if (item.state === 'cancelled') return '已取消'
  return item.error ? `失败：${item.error}` : '失败'
}

function Row({ item }: { item: DownloadItem }) {
  const pct = item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : -1
  const active = item.state === 'progressing' || item.state === 'paused'
  return (
    <div className="grid gap-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {item.state === 'progressing' && <Loader2 size={16} className="shrink-0 animate-spin text-blue-600" />}
        {item.state === 'paused' && <Pause size={16} className="shrink-0 text-amber-500" />}
        {item.state === 'completed' && <CheckCircle2 size={16} className="shrink-0 text-green-600" />}
        {(item.state === 'failed' || item.state === 'cancelled') && <XCircle size={16} className="shrink-0 text-red-500" />}
        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
        <span className="flex shrink-0 gap-1">
          {item.state === 'progressing' && item.path === '' && (
            <Button variant="ghost" size="icon-sm" title="暂停" onClick={() => void window.browser.pauseDownload(item.id)}><Pause /></Button>
          )}
          {item.state === 'paused' && (
            <Button variant="ghost" size="icon-sm" title="继续" onClick={() => void window.browser.resumeDownload(item.id)}><Play /></Button>
          )}
          {active && (
            <Button variant="ghost" size="icon-sm" title="取消" onClick={() => void window.browser.cancelDownload(item.id)}><XCircle /></Button>
          )}
          {(item.state === 'failed' || item.state === 'cancelled') && (
            <Button variant="ghost" size="icon-sm" title="重试" onClick={() => void window.browser.retryDownload(item.id)}><RotateCcw /></Button>
          )}
          {item.state === 'completed' && (
            <>
              <Button variant="ghost" size="icon-sm" title="打开" onClick={() => void window.browser.openDownload(item.id)}><Download /></Button>
              <Button variant="ghost" size="icon-sm" title="打开所在文件夹" onClick={() => void window.browser.showDownload(item.id)}><FolderOpen /></Button>
            </>
          )}
          {item.url && (
            <Button variant="ghost" size="icon-sm" title="复制下载链接" onClick={() => void window.browser.copyDownloadLink(item.id)}><Copy /></Button>
          )}
        </span>
      </div>
      {active && (
        <div className="h-1.5 overflow-hidden rounded bg-neutral-200">
          <div
            className={`h-full bg-blue-600 transition-all ${pct < 0 ? 'w-1/3 animate-pulse' : ''}`}
            style={pct >= 0 ? { width: `${pct}%` } : undefined}
          />
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span>{stateText(item)}</span>
        {item.path && <span className="min-w-0 truncate" title={item.path}>{item.path}</span>}
      </div>
    </div>
  )
}

export function DownloadsPage({ state: external }: { state?: UiState }) {
  const [local, setLocal] = useState<UiState | null>(null)
  useEffect(() => {
    if (external) return
    void window.browser.getState().then(setLocal)
    return window.browser.onState(setLocal)
  }, [external])
  const state = external ?? local
  if (!state) return <div className="h-full bg-white" />
  const downloads = state.downloads
  return (
    <div className="h-full overflow-auto bg-neutral-50 p-6">
      <div className="mx-auto grid max-w-2xl gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">下载</h1>
          {downloads.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => void window.browser.clearDownloads()}>清除已完成</Button>
          )}
        </div>
        {downloads.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white py-16 text-center text-sm text-neutral-400">
            还没有下载。网页里下载的文件、右键另存的媒体、Agent 保存的文件都会出现在这里。
          </div>
        )}
        {downloads.map((item) => <Row key={item.id} item={item} />)}
      </div>
    </div>
  )
}
