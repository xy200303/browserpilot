import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import type { UiState } from '../../shared/types'

type RunLog = {
  id: string
  workflowId: string
  at: number
  ok: boolean
  node?: string
  title?: string
  error?: string
  screenshot?: string
  outputs?: Record<string, unknown>
  files?: string[]
}

export function RunsPage({ state: external, tabUrl }: { state?: UiState; tabUrl?: string }) {
  const filterId = tabUrl && tabUrl.includes('workflow=') ? tabUrl.split('workflow=')[1] : undefined
  const [local, setLocal] = useState<UiState | null>(null)
  const [runs, setRuns] = useState<RunLog[]>([])
  useEffect(() => {
    if (external) return
    void window.browser.getState().then(setLocal)
    return window.browser.onState(setLocal)
  }, [external])
  useEffect(() => {
    void window.browser.listRuns(filterId).then((items) => setRuns(items as RunLog[]))
  }, [external ? external.workflows.length : 0, filterId])
  const state = external ?? local
  if (!state) return <div className="h-full bg-white" />
  const nameOf = (id: string): string => state.workflows.find((w) => w.id === id)?.name || id
  return (
    <div className="h-full overflow-auto bg-neutral-50 p-6">
      <div className="mx-auto grid max-w-2xl gap-3">
        <h1 className="text-lg font-semibold">运行记录{filterId ? ` · ${nameOf(filterId)}` : ''}</h1>
        {runs.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white py-16 text-center text-sm text-neutral-400">
            还没有跑过工作流。每次运行的结果、输出和现场截图都会记在这里。
          </div>
        )}
        {runs.map((run) => (
          <div key={run.id} className="grid gap-1 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <div className="flex items-center gap-2">
              {run.ok
                ? <CheckCircle2 size={15} className="shrink-0 text-green-600" />
                : <XCircle size={15} className="shrink-0 text-red-500" />}
              <span className="font-medium">{nameOf(run.workflowId)}</span>
              <span className="text-xs text-neutral-500">{new Date(run.at).toLocaleString()}</span>
              {run.node && <span className="text-xs text-neutral-500">节点 {run.node}</span>}
            </div>
            {run.error && <p className="text-xs text-red-500">{run.error}</p>}
            {run.outputs && Object.keys(run.outputs).length > 0 && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">{JSON.stringify(run.outputs, null, 1)}</pre>
            )}
            {run.files && run.files.length > 0 && <p className="truncate text-xs text-neutral-500">{run.files.join('、')}</p>}
            {run.screenshot && <p className="truncate text-xs text-neutral-400">现场截图：{run.screenshot}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
