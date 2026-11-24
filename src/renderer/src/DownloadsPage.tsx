import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, Download, FolderOpen, Loader2, Pause, Play, RotateCcw, XCircle } from 'lucide-react'
import type { DownloadItem, UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { TipButton } from '@/components/ui/tip-button'
import i18n from './i18n'

function sizeText(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function stateText(item: DownloadItem): string {
  if (item.state === 'progressing') {
    const pct = item.totalBytes > 0 ? ` · ${Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))}%` : ''
    return i18n.t('downloads.progress', { done: sizeText(item.receivedBytes), total: item.totalBytes > 0 ? ` / ${sizeText(item.totalBytes)}` : '', pct })
  }
  if (item.state === 'paused') return i18n.t('downloads.paused', { done: sizeText(item.receivedBytes) })
  if (item.state === 'completed') return i18n.t('downloads.completed', { done: sizeText(item.receivedBytes) })
  if (item.state === 'cancelled') return i18n.t('downloads.cancelled')
  return item.error ? i18n.t('downloads.failed', { error: item.error }) : i18n.t('downloads.failedPlain')
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
            <TipButton label={i18n.t('downloads.action.pause')} variant="ghost" size="icon-sm" onClick={() => void window.browser.pauseDownload(item.id)}><Pause /></TipButton>
          )}
          {item.state === 'paused' && (
            <TipButton label={i18n.t('downloads.action.resume')} variant="ghost" size="icon-sm" onClick={() => void window.browser.resumeDownload(item.id)}><Play /></TipButton>
          )}
          {active && (
            <TipButton label={i18n.t('downloads.action.cancel')} variant="ghost" size="icon-sm" onClick={() => void window.browser.cancelDownload(item.id)}><XCircle /></TipButton>
          )}
          {(item.state === 'failed' || item.state === 'cancelled') && (
            <TipButton label={i18n.t('downloads.action.retry')} variant="ghost" size="icon-sm" onClick={() => void window.browser.retryDownload(item.id)}><RotateCcw /></TipButton>
          )}
          {item.state === 'completed' && (
            <>
              <TipButton label={i18n.t('downloads.action.open')} variant="ghost" size="icon-sm" onClick={() => void window.browser.openDownload(item.id)}><Download /></TipButton>
              <TipButton label={i18n.t('downloads.action.show')} variant="ghost" size="icon-sm" onClick={() => void window.browser.showDownload(item.id)}><FolderOpen /></TipButton>
            </>
          )}
          {item.url && (
            <TipButton label={i18n.t('downloads.action.copyLink')} variant="ghost" size="icon-sm" onClick={() => void window.browser.copyDownloadLink(item.id)}><Copy /></TipButton>
          )}
        </span>
      </div>
      {active && (
        pct >= 0 ? (
          <Progress value={pct} className="h-1.5" />
        ) : (
          <Progress className="h-1.5 [&>[data-slot=progress-indicator]]:w-1/3 [&>[data-slot=progress-indicator]]:animate-pulse" />
        )
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
          <h1 className="text-lg font-semibold">{i18n.t('downloads.title')}</h1>
          {downloads.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => void window.browser.clearDownloads()}>{i18n.t('downloads.clear')}</Button>
          )}
        </div>
        {downloads.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white py-16 text-center text-sm text-neutral-400">
            {i18n.t('downloads.empty')}
          </div>
        )}
        {downloads.map((item) => <Row key={item.id} item={item} />)}
      </div>
    </div>
  )
}
