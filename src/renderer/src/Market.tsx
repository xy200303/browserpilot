import { useState } from 'react'
import type { UiState, WorkflowParam } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type RunResult = { ok?: boolean; error?: string; outputs?: Record<string, unknown> }
type Field =
  | { kind: 'time-range'; start: WorkflowParam; end: WorkflowParam }
  | { kind: 'single'; param: WorkflowParam }

export function WorkflowUse({ workflow }: { workflow: UiState['workflows'][number] }) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const fields = groupParams(workflow.params)
  const setValue = (name: string, value: string): void => {
    setInputs((current) => ({ ...current, [name]: value }))
  }

  return (
    <form
      className="grid gap-3"
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
      {fields.length === 0 && <p className="text-xs text-muted-foreground">这次没有参数。</p>}
      {fields.map((field) => field.kind === 'time-range'
        ? (
          <div key={`${field.start.name}-${field.end.name}`} className="grid gap-2 sm:grid-cols-2">
            <TimeField label={field.start.description || field.start.name} value={inputs[field.start.name] ?? ''} onChange={(value) => setValue(field.start.name, value)} />
            <TimeField label={field.end.description || field.end.name} value={inputs[field.end.name] ?? ''} onChange={(value) => setValue(field.end.name, value)} />
          </div>
        )
        : <ParamField key={field.param.name} param={field.param} value={inputs[field.param.name] ?? ''} onChange={(value) => setValue(field.param.name, value)} />)}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? '执行中' : '执行'}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void window.browser.copyAgentPrompt(workflow.id).then(() => setNotice('已复制给 Agent 的说明')).catch((reason: unknown) => {
              setNotice(reason instanceof Error ? reason.message : '复制失败')
            })
          }}
        >
          交给 Agent
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void window.browser.openWorkflowRuns(workflow.id)}
        >
          运行记录
        </Button>
      </div>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
    </form>
  )
}

function ParamField({ param, value, onChange }: { param: WorkflowParam; value: string; onChange: (value: string) => void }) {
  const label = param.description || param.name
  if (param.type === 'number') {
    return (
      <Label className="grid gap-1 text-xs text-muted-foreground">
        {label}
        <Input type="number" className="solid-field" value={value} onChange={(event) => onChange(event.target.value)} />
      </Label>
    )
  }
  if (param.type === 'time') return <TimeField label={label} value={value} onChange={onChange} />
  if (param.type === 'time-range') return <TimeRangeField label={label} value={value} onChange={onChange} />
  if (param.type === 'select' && param.options.length) {
    return (
      <fieldset className="grid gap-2">
        <legend className="text-xs text-muted-foreground">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {param.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name={param.name} checked={value === option} onChange={() => onChange(option)} />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  if (param.type === 'checkbox' && param.options.length) {
    const picked = new Set(value.split(',').map((item) => item.trim()).filter(Boolean))
    return (
      <fieldset className="grid gap-2">
        <legend className="text-xs text-muted-foreground">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {param.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={picked.has(option)}
                onChange={(event) => {
                  const next = new Set(picked)
                  if (event.target.checked) next.add(option)
                  else next.delete(option)
                  onChange(param.options.filter((item) => next.has(item)).join(','))
                }}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input className="solid-field" value={value} onChange={(event) => onChange(event.target.value)} />
    </Label>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input type="datetime-local" className="solid-field" value={toPicker(value)} onChange={(event) => onChange(fromPicker(event.target.value))} />
    </Label>
  )
}

function TimeRangeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [start, end] = splitRange(value)
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs text-muted-foreground">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <Input type="datetime-local" className="solid-field" aria-label="开始" value={toPicker(start)} onChange={(event) => onChange(joinRange(fromPicker(event.target.value), end))} />
        <span className="text-center text-xs text-muted-foreground">至</span>
        <Input type="datetime-local" className="solid-field" aria-label="结束" value={toPicker(end)} onChange={(event) => onChange(joinRange(start, fromPicker(event.target.value)))} />
      </div>
    </fieldset>
  )
}

function groupParams(params: WorkflowParam[]): Field[] {
  const fields: Field[] = []
  for (let index = 0; index < params.length; index += 1) {
    const current = params[index]
    const next = params[index + 1]
    if (current.type === 'time' && next?.type === 'time' && isBound(current, 'start') && isBound(next, 'end')) {
      fields.push({ kind: 'time-range', start: current, end: next })
      index += 1
      continue
    }
    fields.push({ kind: 'single', param: current })
  }
  return fields
}

function isBound(param: WorkflowParam, kind: 'start' | 'end'): boolean {
  const name = param.name.trim()
  const label = param.description?.trim() || ''
  if (kind === 'start') return /^(开始|start)/i.test(name) || label.startsWith('开始')
  return /^(结束|end)/i.test(name) || label.startsWith('结束')
}

function toPicker(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/)
  if (!match) return ''
  return `${match[1]}T${match[2] || '00:00'}`
}

function fromPicker(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : ''
}

function splitRange(value: string): [string, string] {
  const [start, end] = value.split(/\s*~\s*/)
  return [start?.trim() || '', end?.trim() || '']
}

function joinRange(start: string, end: string): string {
  if (!start && !end) return ''
  return `${start} ~ ${end}`
}

function summarize(result: RunResult): string {
  if (result.ok === false) return result.error || '执行失败'
  const outputs = result.outputs ?? {}
  const text = Object.entries(outputs).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('；')
  return text ? text.slice(0, 240) : '执行完了'
}
