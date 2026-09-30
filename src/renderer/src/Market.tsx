import { useState } from 'react'
import type { UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type RunResult = { ok?: boolean; error?: string; outputs?: Record<string, unknown> }

export function WorkflowRun({ workflow }: { workflow: UiState['workflows'][number] }) {
  const [open, setOpen] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  return (
    <div>
      <div className="flex gap-2 px-4 py-3">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          手动执行
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void window.browser.copyAgentPrompt(workflow.id).then(() => setNotice('已复制给 Agent 的说明')).catch((reason: unknown) => {
              setNotice(reason instanceof Error ? reason.message : '复制失败')
            })
          }}
        >
          交给 Agent
        </Button>
      </div>
      {open && (
        <form
          className="grid gap-2 px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            setNotice('')
            void window.browser.runWorkflow({ workflow: workflow.id, inputs }).then((result) => {
              setNotice(summarize(result))
            }).catch((reason: unknown) => {
              setNotice(reason instanceof Error ? reason.message : '执行失败')
            }).finally(() => setBusy(false))
          }}
        >
          {workflow.params.length === 0 && <p className="text-xs text-muted-foreground">这次没有参数。</p>}
          {workflow.params.map((param) => (
            <Label key={param.name} className="grid gap-1 text-xs text-muted-foreground">
              {param.description || param.name}
              <Input
                value={inputs[param.name] ?? ''}
                onChange={(event) => setInputs((current) => ({ ...current, [param.name]: event.target.value }))}
              />
            </Label>
          ))}
          <Button type="submit" disabled={busy}>{busy ? '执行中' : '执行'}</Button>
        </form>
      )}
      {notice && <p className="px-4 pb-3 text-xs text-muted-foreground">{notice}</p>}
    </div>
  )
}

function summarize(result: RunResult): string {
  if (result.ok === false) return result.error || '执行失败'
  const outputs = result.outputs ?? {}
  const text = Object.entries(outputs).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('；')
  return text ? text.slice(0, 240) : '执行完了'
}
