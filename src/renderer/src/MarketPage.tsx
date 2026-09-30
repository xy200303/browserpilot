import { useEffect, useState } from 'react'
import type { UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkflowRun } from './Market'

type MarketItem = {
  slug: string
  name: string
  description: string
  author: string
  file: string
}

export function MarketPage({ state: external }: { state?: UiState }) {
  const [local, setLocal] = useState<UiState | null>(null)
  const [items, setItems] = useState<MarketItem[]>([])
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = (): void => {
    void window.browser.listMarket().then((result) => {
      setItems(result.items)
      setSource(result.source)
      setError('')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '市场连不上 GitHub')
    })
  }

  useEffect(() => {
    if (external) return
    void window.browser.getState().then(setLocal)
    return window.browser.onState(setLocal)
  }, [external])

  useEffect(() => {
    load()
  }, [])

  const state = external ?? local

  const install = (input: { file?: string; url?: string }, key: string) => {
    setBusy(key)
    setError('')
    setNotice('')
    void window.browser.installMarket(input).then((saved) => {
      setNotice(`已下载 ${saved.name}`)
      if (key === 'url') setUrl('')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '下载失败')
    }).finally(() => setBusy(''))
  }

  return (
    <div className="h-full overflow-y-auto bg-white text-foreground">
      <div>
        <div className="border-b px-4 py-4">
          <h1 className="text-base font-medium">工作流市场</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {source ? '打开时读取最新目录' : '正在读取目录…'}
          </p>
        </div>
        <form
          className="flex items-center gap-2 border-b px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!url.trim()) return
            install({ url }, 'url')
          }}
        >
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="GitHub 上的工作流 JSON 地址"
            className="min-w-0 flex-1 bg-background"
          />
          <Button type="submit" disabled={busy === 'url'}>下载</Button>
        </form>
        {notice && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{notice}</p>}
        {error && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{error}</p>}
        {items.map((item) => {
          const installed = state?.workflows.find((workflow) => workflow.name === item.name)
          return (
            <div key={item.slug} className="divide-y border-b bg-white">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.author}</div>
                </div>
                {installed ? (
                  <span className="shrink-0 text-xs text-muted-foreground">已下载</span>
                ) : (
                  <Button type="button" size="sm" disabled={busy === item.slug} onClick={() => install({ file: item.file }, item.slug)}>
                    下载
                  </Button>
                )}
              </div>
              {installed && <WorkflowRun workflow={installed} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
