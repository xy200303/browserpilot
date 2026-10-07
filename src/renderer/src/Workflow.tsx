import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowEdge, WorkflowInfo, WorkflowNode } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { cn } from 'cn'

type HandleInfo = { id: string; label: string }
type CardData = { title: string; kind: string; kindText: string; hasTarget: boolean; sources: HandleInfo[]; inputs: string[]; outputs: string[] }
type FlowNode = Node<CardData, 'card'>
type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
type Patch = {
  nodes?: (WorkflowNode & { parent?: string })[]
  removeNodes?: string[]
  edges?: WorkflowEdge[]
  removeEdges?: string[]
}
type Choice = { key: string; label: string; selector: string[] }

const kindText: Record<string, string> = {
  start: '开始',
  end: '结束',
  goto: '打开',
  click: '点击',
  fill: '填写',
  select: '选择',
  press: '按键',
  scroll: '滚动',
  swipe: '滑动',
  upload: '上传',
  handoff: '交接',
  script: '页面脚本',
  code: '代码',
  cdp: 'CDP',
  'http-request': '请求',
  extract: '提取',
  export: '导出',
  'if-else': '判断',
  loop: '循环',
  captcha: '验证码'
}

const addable = ['goto', 'click', 'fill', 'select', 'press', 'scroll', 'swipe', 'upload', 'handoff', 'captcha', 'script', 'code', 'http-request', 'extract', 'export', 'if-else', 'loop', 'end', 'cdp'] as const

const operators = [
  { id: 'contains', label: '包含' },
  { id: 'is', label: '等于' },
  { id: 'empty', label: '为空' },
  { id: 'not empty', label: '不为空' },
  { id: 'locator', label: '页面上有' }
]

function nodeId(): string {
  return `node-${crypto.randomUUID().slice(0, 8)}`
}

function sourceHandles(node: WorkflowNode): HandleInfo[] {
  if (node.data.type === 'end') return []
  if (node.data.type !== 'if-else') return [{ id: 'source', label: '' }]
  const cases = Array.isArray(node.data.cases) ? node.data.cases : []
  const handles = cases.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const id = (item as { case_id?: unknown }).case_id
    if (typeof id !== 'string' || !id) return []
    return [{ id, label: index === 0 ? 'IF' : 'ELIF' }]
  })
  handles.push({ id: 'false', label: 'ELSE' })
  return handles
}

function nodeHeight(node: WorkflowNode): number {
  const ports = portSummary(node)
  const extra = (ports.inputs.length ? 16 : 0) + (ports.outputs.length ? 16 : 0)
  const count = sourceHandles(node).length
  return (count <= 1 ? 58 : 34 + count * 28) + extra
}

function autoPositions(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, { x: number; y: number }> {
  const incoming = new Set(edges.map((edge) => edge.target))
  const depth = new Map<string, number>()
  const queue = nodes.filter((node) => !incoming.has(node.id)).map((node) => ({ id: node.id, depth: 0 }))
  const seen = new Set<string>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)
    depth.set(current.id, current.depth)
    for (const edge of edges) {
      if (edge.source === current.id) queue.push({ id: edge.target, depth: current.depth + 1 })
    }
  }
  const columns = new Map<number, WorkflowNode[]>()
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0
    const list = columns.get(column) ?? []
    list.push(node)
    columns.set(column, list)
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [column, list] of columns) {
    let y = 0
    for (const node of list) {
      positions.set(node.id, node.position ?? { x: column * 240, y })
      y += nodeHeight(node) + 36
    }
  }
  return positions
}

function toFlow(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: FlowNode[]; edges: Edge[] } {
  const positions = autoPositions(nodes, edges)
  return {
    nodes: nodes.map((node) => {
      const kind = String(node.data.type || '')
      return {
        id: node.id,
        type: 'card',
        position: node.position ?? positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          title: String(node.data.title || kindText[kind] || kind),
          kind,
          kindText: kindText[kind] || kind,
          hasTarget: kind !== 'start',
          sources: sourceHandles(node),
          inputs: portSummary(node).inputs,
          outputs: portSummary(node).outputs
        }
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'source',
      targetHandle: edge.targetHandle || 'target',
      type: 'smoothstep',
      label: edge.sourceHandle === 'false' ? 'ELSE' : edge.sourceHandle === 'true' ? 'IF' : edge.sourceHandle && edge.sourceHandle !== 'source' ? edge.sourceHandle : undefined
    }))
  }
}

function levelAt(graph: Graph, stack: string[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; parentId?: string; missing: boolean; titles: string[] } {
  let nodes = graph.nodes
  let edges = graph.edges
  const titles: string[] = []
  for (const id of stack) {
    const node = nodes.find((item) => item.id === id && item.data.type === 'loop')
    if (!node) return { nodes, edges, parentId: titles.length ? stack[titles.length - 1] : undefined, missing: true, titles }
    titles.push(String(node.data.title || '循环'))
    nodes = Array.isArray(node.data.nodes) ? (node.data.nodes as WorkflowNode[]) : []
    edges = Array.isArray(node.data.edges) ? (node.data.edges as WorkflowEdge[]) : []
  }
  return { nodes, edges, parentId: stack.length ? stack[stack.length - 1] : undefined, missing: false, titles }
}

function reaches(edges: WorkflowEdge[], from: string, goal: string): boolean {
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length) {
    const id = queue.shift()
    if (!id || seen.has(id)) continue
    if (id === goal) return true
    seen.add(id)
    for (const edge of edges) if (edge.source === id) queue.push(edge.target)
  }
  return false
}

function connectError(edges: WorkflowEdge[], connection: { source?: string | null; target?: string | null; sourceHandle?: string | null }): string {
  const source = connection.source || ''
  const target = connection.target || ''
  if (!source || !target) return ''
  if (source === target) return '不能连到自己'
  const handle = connection.sourceHandle || 'source'
  if (edges.some((edge) => edge.source === source && edge.target === target && (edge.sourceHandle || 'source') === handle)) return '这条线已经有了'
  const incoming = edges.filter((edge) => edge.target === target)
  if (incoming.length && incoming.some((edge) => edge.source !== source)) return '这个节点已经有进入的线，不能汇合'
  if (reaches(edges, target, source)) return '这样会成环'
  return ''
}

function ancestors(id: string, edges: WorkflowEdge[]): Set<string> {
  const reverse = new Map<string, string[]>()
  for (const edge of edges) {
    const list = reverse.get(edge.target) ?? []
    list.push(edge.source)
    reverse.set(edge.target, list)
  }
  const found = new Set<string>()
  const queue = [...(reverse.get(id) ?? [])]
  while (queue.length) {
    const current = queue.shift()
    if (!current || found.has(current)) continue
    found.add(current)
    queue.push(...(reverse.get(current) ?? []))
  }
  return found
}

function withPoint(data: WorkflowNode['data'], key: 'x' | 'y', value: string): WorkflowNode['data'] {
  const next = { ...data }
  if (!value.trim()) delete next[key]
  else next[key] = value.trim()
  return next
}

function defaultData(type: string): WorkflowNode['data'] {
  const title = kindText[type] || type
  if (type === 'goto') return { type, title, url: 'https://' }
  if (type === 'click' || type === 'select' || type === 'upload') return { type, title, locator: {} }
  if (type === 'fill') return { type, title, entry: 'type', text: '', locator: {} }
  if (type === 'press') return { type, title, shortcut: 'Enter' }
  if (type === 'scroll') return { type, title, direction: 'down' }
  if (type === 'swipe') return { type, title, direction: 'down' }
  if (type === 'handoff') return { type, title, message: '' }
  if (type === 'captcha') return { type, title, engine: 'auto', retries: '2' }
  if (type === 'script') return { type, title, source: 'return {}' }
  if (type === 'code') return { type, title, code: 'return {}' }
  if (type === 'cdp') return { type, title, method: '', params: {} }
  if (type === 'http-request') return { type, title, method: 'GET', url: 'https://' }
  if (type === 'extract') return { type, title, pattern: '', variable_selector: ['sys', 'url'] }
  if (type === 'export') return { type, title, filename: '导出.csv', headers: [], rows_selector: ['sys', 'url'] }
  if (type === 'if-else') {
    return {
      type,
      title,
      cases: [{ case_id: 'true', conditions: [{ comparison_operator: 'not empty', variable_selector: ['sys', 'url'] }] }]
    }
  }
  if (type === 'loop') {
    return {
      type,
      title,
      mode: 'until',
      max: 40,
      until: { comparison_operator: 'not empty', variable_selector: ['loop', 'index'] },
      nodes: [{ id: nodeId(), position: { x: 0, y: 0 }, data: { type: 'code', title: '循环体', code: 'return {}' } }],
      edges: []
    }
  }
  if (type === 'end') return { type, title, outputs: [] }
  return { type, title }
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
}

function selectorText(selector: unknown): string[] {
  if (!Array.isArray(selector) || !selector.length) return []
  return [selector.map((item) => String(item)).join(' / ')]
}

function outputFields(node: WorkflowNode): string[] {
  const type = node.data.type
  if (type === 'http-request') return ['status_code', 'body', 'json']
  if (type === 'extract') return ['value', 'matches']
  if (type === 'export') return ['path']
  if (type === 'loop') return ['output', 'index']
  if (type === 'captcha') return ['solved', 'attempts']
  if (type === 'code' || type === 'script') {
    const outputs = node.data.outputs
    if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) return Object.keys(outputs)
  }
  return []
}

function portSummary(node: WorkflowNode): { inputs: string[]; outputs: string[] } {
  const type = node.data.type
  if (type === 'start') return { inputs: records(node.data.variables).map((item) => String(item.variable || '')).filter(Boolean), outputs: [] }
  if (type === 'end') return { inputs: [], outputs: records(node.data.outputs).map((item) => String(item.variable || '')).filter(Boolean) }
  if (type === 'code' || type === 'script') return { inputs: records(node.data.variables).map((item) => String(item.variable || '')).filter(Boolean), outputs: outputFields(node) }
  if (type === 'http-request') return { inputs: [], outputs: ['status_code', 'body', 'json'] }
  if (type === 'captcha') return { inputs: [], outputs: ['solved', 'attempts'] }
  if (type === 'extract') return { inputs: selectorText(node.data.variable_selector), outputs: ['value', 'matches'] }
  if (type === 'export') return { inputs: selectorText(Array.isArray(node.data.data_selector) ? node.data.data_selector : node.data.rows_selector), outputs: ['path'] }
  if (type === 'loop') {
    const until = node.data.until && typeof node.data.until === 'object' ? (node.data.until as { variable_selector?: unknown }).variable_selector : []
    return { inputs: selectorText(node.data.mode === 'list' ? node.data.items_selector : until), outputs: ['output', 'index'] }
  }
  return { inputs: [], outputs: [] }
}

function startVariables(graph: Graph): Record<string, unknown>[] {
  const start = graph.nodes.find((node) => node.data.type === 'start')
  return records(start?.data.variables)
}

function producersFor(graph: Graph, stack: string[], nodeId: string): WorkflowNode[] {
  const level = levelAt(graph, stack)
  const found = level.nodes.filter((node) => ancestors(nodeId, level.edges).has(node.id) && node.data.type !== 'start')
  let nodes = graph.nodes
  let edges = graph.edges
  for (const loopId of stack) {
    const prior = ancestors(loopId, edges)
    for (const node of nodes) if (prior.has(node.id) && node.data.type !== 'start') found.push(node)
    const loop = nodes.find((node) => node.id === loopId && node.data.type === 'loop')
    if (!loop) break
    nodes = Array.isArray(loop.data.nodes) ? (loop.data.nodes as WorkflowNode[]) : []
    edges = Array.isArray(loop.data.edges) ? (loop.data.edges as WorkflowEdge[]) : []
  }
  return found
}

function choiceList(graph: Graph, stack: string[], nodeId: string, insideLoop: boolean): Choice[] {
  const list: Choice[] = [
    { key: selectorKey(['sys', 'url']), label: '当前网址', selector: ['sys', 'url'] },
    { key: selectorKey(['sys', 'title']), label: '当前标题', selector: ['sys', 'title'] },
    { key: selectorKey(['sys', 'tabId']), label: '标签编号', selector: ['sys', 'tabId'] },
    { key: selectorKey(['sys', 'env']), label: '环境编号', selector: ['sys', 'env'] }
  ]
  if (insideLoop) {
    list.push({ key: selectorKey(['loop', 'index']), label: '循环序号', selector: ['loop', 'index'] })
    list.push({ key: selectorKey(['loop', 'item']), label: '循环当前项', selector: ['loop', 'item'] })
  }
  for (const item of startVariables(graph)) {
    const variable = String(item.variable || '')
    if (!variable) continue
    list.push({ key: selectorKey(['input', variable]), label: `参数 ${String(item.label || variable)}`, selector: ['input', variable] })
  }
  for (const node of producersFor(graph, stack, nodeId)) {
    for (const field of outputFields(node)) {
      list.push({
        key: selectorKey([node.id, field]),
        label: `${String(node.data.title || node.id)} / ${field}`,
        selector: [node.id, field]
      })
    }
  }
  const self = levelAt(graph, stack).nodes.find((node) => node.id === nodeId)
  if (self?.data.type === 'loop' && Array.isArray(self.data.nodes)) {
    for (const inner of self.data.nodes as WorkflowNode[]) {
      for (const field of outputFields(inner)) {
        list.push({
          key: selectorKey([inner.id, field]),
          label: `${String(inner.data.title || inner.id)} / ${field}`,
          selector: [inner.id, field]
        })
      }
    }
  }
  return list
}

function CardNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className={cn('w-44 rounded-xl border bg-popover shadow-sm', selected && 'border-ring ring-3 ring-ring/40')}>
      {data.hasTarget && <Handle type="target" position={Position.Left} id="target" className="!size-2.5 !border-2 !border-popover !bg-foreground" />}
      <div className="px-3 py-2">
        <div className="text-[10px] text-muted-foreground">{data.kindText}</div>
        <div className="truncate text-xs" title={data.title}>{data.title}</div>
        {data.inputs.length > 0 && <div className="truncate text-[10px] text-muted-foreground" title={data.inputs.join('、')}>输入 {data.inputs.join('、')}</div>}
        {data.outputs.length > 0 && <div className="truncate text-[10px] text-muted-foreground" title={data.outputs.join('、')}>输出 {data.outputs.join('、')}</div>}
        {data.kind === 'loop' && <div className="text-[10px] text-muted-foreground">双击进入</div>}
      </div>
      {data.sources.length === 1 && (
        <Handle type="source" position={Position.Right} id={data.sources[0].id} className="!size-2.5 !border-2 !border-popover !bg-foreground" />
      )}
      {data.sources.length > 1 && (
        <div className="border-t">
          {data.sources.map((source) => (
            <div key={source.id} className="relative flex h-7 items-center justify-end pr-4 text-[10px] text-muted-foreground">
              {source.label}
              <Handle type="source" position={Position.Right} id={source.id} className="!size-2.5 !border-2 !border-popover !bg-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { card: CardNode }

function TextField({ label, value, multiline, onCommit }: { label: string; value: string; multiline?: boolean; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [source, setSource] = useState(value)
  if (source !== value) {
    setSource(value)
    setText(value)
  }
  const commit = () => {
    if (text !== value) onCommit(text)
  }
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <Textarea value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      ) : (
        <Input value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      )}
    </Label>
  )
}

function selectorKey(selector: unknown): string {
  return Array.isArray(selector) ? selector.map((item) => String(item)).join('\u0000') : ''
}

function SelectorField({ label, value, choices, onChange }: { label: string; value: unknown; choices: Choice[]; onChange: (selector: string[]) => void }) {
  const selected = selectorKey(value)
  const known = choices.some((choice) => choice.key === selected)
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Select
        value={selected || '__empty'}
        onValueChange={(key) => {
          if (key === '__empty') return
          const choice = choices.find((item) => item.key === key)
          if (choice) onChange(choice.selector)
        }}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {!selected && <SelectItem value="__empty">选择上游产出</SelectItem>}
          {!known && selected && <SelectItem value={selected}>{Array.isArray(value) ? value.map((item) => String(item)).join(' / ') : '当前变量'}</SelectItem>}
          {choices.map((choice) => <SelectItem key={choice.key} value={choice.key}>{choice.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Label>
  )
}

function shownType(type: unknown): string {
  if (type === 'number' || type === 'time' || type === 'time-range' || type === 'select' || type === 'checkbox' || type === 'text-input') return type
  return 'text-input'
}

function StartInputs({ variables, onChange }: { variables: Record<string, unknown>[]; onChange: (variables: Record<string, unknown>[]) => void }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs">输入</div>
      {variables.map((item, index) => (
        <div key={String(item.variable || item.label || '参数')} className="grid gap-2 rounded-lg border p-2">
          <TextField label="参数名" value={String(item.variable || '')} onCommit={(variable) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, variable } : candidate))} />
          <TextField label="显示名" value={String(item.label || '')} onCommit={(label) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, label } : candidate))} />
          <Label className="grid gap-1 text-xs text-muted-foreground">
            类型
            <Select value={shownType(item.type)} onValueChange={(type) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, type } : candidate))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text-input">文本</SelectItem>
                <SelectItem value="number">数字</SelectItem>
                <SelectItem value="time">时间</SelectItem>
                <SelectItem value="time-range">时间范围</SelectItem>
                <SelectItem value="select">单选</SelectItem>
                <SelectItem value="checkbox">复选</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          {(item.type === 'select' || item.type === 'checkbox') && (
            <TextField
              label="选项"
              value={Array.isArray(item.options) ? item.options.join('，') : ''}
              onCommit={(text) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, options: text.split(/[,，]/).map((part) => part.trim()).filter(Boolean) } : candidate))}
            />
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">必填</span>
            <Switch checked={item.required !== false} onCheckedChange={(required) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, required } : candidate))} />
          </div>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(variables.filter((_candidate, cursor) => cursor !== index))}>删除</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...variables, { variable: `参数${variables.length + 1}`, label: `参数${variables.length + 1}`, type: 'text-input', required: true }])}>添加输入</Button>
    </div>
  )
}

function EndOutputs({ outputs, choices, onChange }: { outputs: Record<string, unknown>[]; choices: Choice[]; onChange: (outputs: Record<string, unknown>[]) => void }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs">输出</div>
      {outputs.map((item, index) => (
        <div key={String(item.variable || '结果')} className="grid gap-2 rounded-lg border p-2">
          <TextField label="名称" value={String(item.variable || '')} onCommit={(variable) => onChange(outputs.map((candidate, cursor) => cursor === index ? { ...candidate, variable } : candidate))} />
          <SelectorField label="取值" value={item.value_selector} choices={choices} onChange={(value_selector) => onChange(outputs.map((candidate, cursor) => cursor === index ? { ...candidate, value_selector } : candidate))} />
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(outputs.filter((_candidate, cursor) => cursor !== index))}>删除</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...outputs, { variable: `结果${outputs.length + 1}`, value_selector: ['sys', 'url'] }])}>添加输出</Button>
    </div>
  )
}

function CodePorts({
  variables,
  outputs,
  choices,
  onChange
}: {
  variables: Record<string, unknown>[]
  outputs: Record<string, { type?: string }>
  choices: Choice[]
  onChange: (variables: Record<string, unknown>[], outputs: Record<string, { type?: string }>) => void
}) {
  const names = Object.keys(outputs)
  return (
    <div className="grid gap-2">
      <div className="text-xs">输入</div>
      {variables.map((item, index) => (
        <div key={String(item.variable || '输入')} className="grid gap-2 rounded-lg border p-2">
          <TextField label="名称" value={String(item.variable || '')} onCommit={(variable) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, variable } : candidate), outputs)} />
          <SelectorField label="取值" value={item.value_selector} choices={choices} onChange={(value_selector) => onChange(variables.map((candidate, cursor) => cursor === index ? { ...candidate, value_selector } : candidate), outputs)} />
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(variables.filter((_candidate, cursor) => cursor !== index), outputs)}>删除</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...variables, { variable: `输入${variables.length + 1}`, value_selector: ['sys', 'url'] }], outputs)}>添加输入</Button>
      <div className="text-xs">输出</div>
      {names.map((name) => (
        <div key={name} className="grid gap-2 rounded-lg border p-2">
          <TextField
            label="名称"
            value={name}
            onCommit={(next) => {
              if (!next || next === name) return
              const renamed: Record<string, { type?: string }> = {}
              for (const [key, value] of Object.entries(outputs)) renamed[key === name ? next : key] = value
              onChange(variables, renamed)
            }}
          />
          <Label className="grid gap-1 text-xs text-muted-foreground">
            类型
            <Select
              value={outputs[name]?.type || 'string'}
              onValueChange={(type) => onChange(variables, { ...outputs, [name]: { ...outputs[name], type } })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="string">文本</SelectItem>
                <SelectItem value="number">数字</SelectItem>
                <SelectItem value="boolean">布尔</SelectItem>
                <SelectItem value="object">对象</SelectItem>
                <SelectItem value="array">数组</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              const next = { ...outputs }
              delete next[name]
              onChange(variables, next)
            }}
          >
            删除
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(variables, { ...outputs, [`输出${names.length + 1}`]: { type: 'string' } })}>添加输出</Button>
    </div>
  )
}

function showFor(node: WorkflowNode, types: string[], view: ReactNode): ReactNode {
  if (!types.includes(node.data.type)) return null
  return view
}

function ExportSelectors({ node, choices, patch }: { node: WorkflowNode; choices: Choice[]; patch: (data: WorkflowNode['data']) => void }) {
  if (node.data.type !== 'export') return null
  if (Array.isArray(node.data.rows_selector) && !Array.isArray(node.data.data_selector)) {
    return (
      <>
        <SelectorField label="表头" value={node.data.headers_selector} choices={choices} onChange={(headers_selector) => patch({ ...node.data, headers_selector })} />
        <SelectorField label="行" value={node.data.rows_selector} choices={choices} onChange={(rows_selector) => patch({ ...node.data, rows_selector })} />
      </>
    )
  }
  return <SelectorField label="输入" value={node.data.data_selector} choices={choices} onChange={(data_selector) => patch({ ...node.data, data_selector })} />
}

function LoopSelectors({ node, choices, until, patch }: { node: WorkflowNode; choices: Choice[]; until: Record<string, unknown>; patch: (data: WorkflowNode['data']) => void }) {
  if (node.data.type !== 'loop') return null
  if (node.data.mode === 'list') {
    return <SelectorField label="输入" value={node.data.items_selector} choices={choices} onChange={(items_selector) => patch({ ...node.data, items_selector })} />
  }
  return (
    <>
      <SelectorField label="直到" value={until.variable_selector} choices={choices} onChange={(variable_selector) => patch({ ...node.data, until: { ...until, variable_selector } })} />
      <TextField label="比较值" value={String(until.value || '')} onCommit={(value) => patch({ ...node.data, until: { ...until, value } })} />
    </>
  )
}

function FillFields({ node, patch }: { node: WorkflowNode; patch: (data: WorkflowNode['data']) => void }) {
  if (node.data.type !== 'fill') return null
  return (
    <>
      <Label className="grid gap-1 text-xs text-muted-foreground">
        写入方式
        <Select value={node.data.entry === 'paste' ? 'paste' : 'type'} onValueChange={(entry) => patch({ ...node.data, entry })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="type">逐字输入</SelectItem>
            <SelectItem value="paste">粘贴</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <TextField label="内容" value={String(node.data.text || '')} onCommit={(text) => patch({ ...node.data, text })} />
    </>
  )
}

function DirectionField({ node, patch }: { node: WorkflowNode; patch: (data: WorkflowNode['data']) => void }) {
  if (node.data.type !== 'scroll' && node.data.type !== 'swipe') return null
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      方向
      <Select value={String(node.data.direction || 'down')} onValueChange={(direction) => patch({ ...node.data, direction })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="up">上</SelectItem>
          <SelectItem value="down">下</SelectItem>
          {node.data.type === 'swipe' && <SelectItem value="left">左</SelectItem>}
          {node.data.type === 'swipe' && <SelectItem value="right">右</SelectItem>}
        </SelectContent>
      </Select>
    </Label>
  )
}

function LocatorFields({ node, locator, patch }: { node: WorkflowNode; locator: Record<string, unknown> | null; patch: (data: WorkflowNode['data']) => void }) {
  if (!locator) return null
  return (
    <div className="grid gap-2">
      {(['xpath', 'selector'] as const).map((key) => (
        <TextField
          key={key}
          label={key === 'selector' ? 'CSS' : 'XPath'}
          value={String(locator[key] || '')}
          onCommit={(value) => {
            const next = { ...locator, [key]: value }
            delete next.role
            delete next.name
            for (const name of Object.keys(next)) if (!String(next[name] || '').trim()) delete next[name]
            patch({ ...node.data, locator: next })
          }}
        />
      ))}
    </div>
  )
}

function ConditionEditor({
  condition,
  conditionIndex,
  caseId,
  choices,
  onChange
}: {
  condition: Record<string, unknown>
  conditionIndex: number
  caseId: string
  choices: Choice[]
  onChange: (condition: Record<string, unknown>) => void
}) {
  const operator = String(condition.comparison_operator || 'not empty')
  const selected = selectorKey(condition.variable_selector)
  const known = choices.some((choice) => choice.key === selected)
  return (
    <div key={`${caseId}-${operator}-${selected}`} className="grid gap-2">
      {operator !== 'locator' && (
        <Select
          value={selected || '__empty'}
          onValueChange={(key) => {
            if (key === '__empty') return
            const choice = choices.find((item) => item.key === key)
            if (!choice) return
            onChange({ ...condition, variable_selector: choice.selector })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {!selected && <SelectItem value="__empty">选择上游产出</SelectItem>}
            {!known && selected && <SelectItem value={selected}>{Array.isArray(condition.variable_selector) ? condition.variable_selector.join(' / ') : '当前变量'}</SelectItem>}
            {choices.map((choice) => <SelectItem key={choice.key} value={choice.key}>{choice.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={operator} onValueChange={(comparison_operator) => onChange({ ...condition, comparison_operator })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {operators.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {(operator === 'contains' || operator === 'is') && (
        <TextField label="比较值" value={String(condition.value || '')} onCommit={(value) => onChange({ ...condition, value })} />
      )}
    </div>
  )
}

function CaseFields({
  node,
  cases,
  edges,
  choices,
  patch
}: {
  node: WorkflowNode
  cases: Record<string, unknown>[]
  edges: WorkflowEdge[]
  choices: Choice[]
  patch: (data: WorkflowNode['data'], removeEdges?: string[]) => void
}) {
  if (node.data.type !== 'if-else') return null
  return (
    <div className="grid gap-2">
      {cases.map((item, index) => {
        const caseId = String(item.case_id || '')
        const conditions = Array.isArray(item.conditions) ? item.conditions.filter((condition) => condition && typeof condition === 'object') as Record<string, unknown>[] : []
        return (
          <div key={caseId || 'branch'} className="grid gap-2 rounded-lg border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs">{index === 0 ? 'IF' : 'ELIF'}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={cases.length <= 1}
                onClick={() => {
                  if (cases.length <= 1) return
                  const next = cases.filter((candidate) => candidate !== item)
                  const dropped = edges.filter((edge) => edge.source === node.id && (edge.sourceHandle || 'source') === caseId).map((edge) => edge.id)
                  patch({ ...node.data, cases: next }, dropped)
                }}
              >
                删除
              </Button>
            </div>
            {conditions.map((condition, conditionIndex) => (
              <ConditionEditor
                key={`${caseId}-${selectorKey(condition.variable_selector)}-${String(condition.comparison_operator || '')}`}
                condition={condition}
                conditionIndex={conditionIndex}
                caseId={caseId}
                choices={choices}
                onChange={(next) => {
                  const replaced = conditions.map((candidate, cursor) => cursor === conditionIndex ? next : candidate)
                  patch({ ...node.data, cases: cases.map((candidate) => candidate === item ? { ...item, conditions: replaced } : candidate) })
                }}
              />
            ))}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const caseId = `case-${crypto.randomUUID().slice(0, 8)}`
          patch({
            ...node.data,
            cases: [...cases, { case_id: caseId, conditions: [{ comparison_operator: 'not empty', variable_selector: ['sys', 'url'] }] }]
          })
        }}
      >
        添加分支
      </Button>
      <p className="text-xs text-muted-foreground">都不成立时走 ELSE。</p>
    </div>
  )
}

function readNodeBits(node: WorkflowNode): {
  cases: Record<string, unknown>[]
  locator: Record<string, unknown> | null
  codeOutputs: Record<string, { type?: string }>
  until: Record<string, unknown>
} {
  const cases = Array.isArray(node.data.cases) ? node.data.cases.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : []
  const locator = node.data.locator && typeof node.data.locator === 'object' ? node.data.locator as Record<string, unknown> : null
  const outputs = node.data.outputs
  const codeOutputs = outputs && typeof outputs === 'object' && !Array.isArray(outputs) ? outputs as Record<string, { type?: string }> : {}
  const until = node.data.until && typeof node.data.until === 'object' ? node.data.until as Record<string, unknown> : {}
  return { cases, locator, codeOutputs, until }
}

function RemoveNode({ node, onRemove }: { node: WorkflowNode; onRemove: () => void }) {
  if (node.data.type === 'start') return null
  return <Button type="button" variant="destructive" size="sm" onClick={onRemove}>删除节点</Button>
}

function NextLink({
  sources,
  handle,
  addType,
  onPick,
  onAddType,
  onAdd
}: {
  sources: { id: string; label?: string }[]
  handle: string
  addType: string
  onPick: (handle: string) => void
  onAddType: (type: string) => void
  onAdd: (type: string, handle: string) => void
}) {
  if (sources.length === 0) return null
  return (
    <div className="grid gap-2 border-t pt-3">
      {sources.length > 1 && (
        <Label className="grid gap-1 text-xs text-muted-foreground">
          从哪个端点连出
          <Select value={handle} onValueChange={onPick}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.label || '输出'}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
      )}
      <Label className="grid gap-1 text-xs text-muted-foreground">
        添加下一步
        <Select value={addType} onValueChange={onAddType}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {addable.map((type) => <SelectItem key={type} value={type}>{kindText[type]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Label>
      <Button type="button" size="sm" onClick={() => onAdd(addType, handle)}>接到这个端点</Button>
    </div>
  )
}

type NodePatch = (data: WorkflowNode['data'], removeEdges?: string[]) => void

function chosenHandle(sources: { id: string }[], nodeId: string, picked: { nodeId: string; handle: string } | null): string {
  const fallback = sources[0]?.id || 'source'
  const pickedHandle = picked?.nodeId === nodeId ? picked.handle : ''
  return sources.some((item) => item.id === pickedHandle) ? pickedHandle : fallback
}

function NodeHeading({ node, patch }: { node: WorkflowNode; patch: NodePatch }) {
  return (
    <>
      <div>
        <div className="text-[10px] text-muted-foreground">{kindText[node.data.type] || node.data.type}</div>
        <div className="truncate text-xs text-muted-foreground">{node.id}</div>
      </div>
      <TextField label="标题" value={String(node.data.title || '')} onCommit={(title) => patch({ ...node.data, title })} />
    </>
  )
}

function NodePorts({
  node,
  choices,
  codeOutputs,
  until,
  patch
}: {
  node: WorkflowNode
  choices: Choice[]
  codeOutputs: Record<string, { type?: string }>
  until: Record<string, unknown>
  patch: NodePatch
}) {
  return (
    <>
      {showFor(node, ['start'], <StartInputs variables={records(node.data.variables)} onChange={(variables) => patch({ ...node.data, variables })} />)}
      {showFor(node, ['code', 'script'], <CodePorts variables={records(node.data.variables)} outputs={codeOutputs} choices={choices} onChange={(variables, outputs) => patch({ ...node.data, variables, outputs })} />)}
      {showFor(node, ['end'], <EndOutputs outputs={records(node.data.outputs)} choices={choices} onChange={(outputs) => patch({ ...node.data, outputs })} />)}
      {showFor(node, ['extract'], <SelectorField label="输入" value={node.data.variable_selector} choices={choices} onChange={(variable_selector) => patch({ ...node.data, variable_selector })} />)}
      <ExportSelectors node={node} choices={choices} patch={patch} />
      <LoopSelectors node={node} choices={choices} until={until} patch={patch} />
      {showFor(node, ['http-request', 'extract', 'export', 'loop'], <p className="text-xs text-muted-foreground">输出 {portSummary(node).outputs.join('、')}</p>)}
    </>
  )
}

function NodePageFields({ node, patch }: { node: WorkflowNode; patch: NodePatch }) {
  return (
    <>
      {showFor(node, ['goto'], <TextField label="地址" value={String(node.data.url || '')} onCommit={(url) => patch({ ...node.data, url })} />)}
      <FillFields node={node} patch={patch} />
      {showFor(node, ['select'], <TextField label="选项" value={String(node.data.option || '')} onCommit={(option) => patch({ ...node.data, option })} />)}
      {showFor(node, ['press'], <TextField label="按键" value={String(node.data.shortcut || '')} onCommit={(shortcut) => patch({ ...node.data, shortcut })} />)}
      <DirectionField node={node} patch={patch} />
      {showFor(node, ['captcha'], (
        <>
          <Label className="grid gap-1 text-xs text-muted-foreground">
            识别引擎
            <Select value={String(node.data.engine || 'auto')} onValueChange={(engine) => patch({ ...node.data, engine })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="cv">内置视觉</SelectItem>
                <SelectItem value="ddddocr">ddddocr</SelectItem>
                <SelectItem value="onnx">ONNX 模型</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <TextField label="重试次数" value={String(node.data.retries ?? '2')} onCommit={(retries) => patch({ ...node.data, retries })} />
        </>
      ))}
      {showFor(node, ['handoff'], <TextField label="提示" value={String(node.data.message || '')} onCommit={(message) => patch({ ...node.data, message })} />)}
    </>
  )
}

function HttpFields({ node, patch }: { node: WorkflowNode; patch: NodePatch }) {
  if (node.data.type !== 'http-request') return null
  return (
    <>
      <TextField label="方法" value={String(node.data.method || 'GET')} onCommit={(method) => patch({ ...node.data, method })} />
      <TextField label="地址" value={String(node.data.url || '')} onCommit={(url) => patch({ ...node.data, url })} />
      <TextField label="请求正文" multiline value={typeof node.data.body === 'string' ? node.data.body : ''} onCommit={(body) => patch({ ...node.data, body })} />
    </>
  )
}

function NodeCodeFields({ node, patch }: { node: WorkflowNode; patch: NodePatch }) {
  return (
    <>
      <HttpFields node={node} patch={patch} />
      {showFor(node, ['script'], <TextField label="页面脚本" multiline value={String(node.data.source || '')} onCommit={(source) => patch({ ...node.data, source })} />)}
      {showFor(node, ['code'], <TextField label="代码" multiline value={String(node.data.code || '')} onCommit={(code) => patch({ ...node.data, code })} />)}
      {showFor(node, ['extract'], <TextField label="正则" value={String(node.data.pattern || '')} onCommit={(pattern) => patch({ ...node.data, pattern })} />)}
      {showFor(node, ['export'], <TextField label="文件名" value={String(node.data.filename || '')} onCommit={(filename) => patch({ ...node.data, filename })} />)}
      {showFor(node, ['click'], (
        <div className="grid gap-2">
          <TextField label="画布 X" value={node.data.x == null ? '' : String(node.data.x)} onCommit={(x) => patch(withPoint(node.data, 'x', x))} />
          <TextField label="画布 Y" value={node.data.y == null ? '' : String(node.data.y)} onCommit={(y) => patch(withPoint(node.data, 'y', y))} />
        </div>
      ))}
    </>
  )
}

function NodePanel({
  node,
  graph,
  stack,
  edges,
  insideLoop,
  onChange,
  onRemove,
  onEnter,
  onAdd
}: {
  node: WorkflowNode
  graph: Graph
  stack: string[]
  edges: WorkflowEdge[]
  insideLoop: boolean
  onChange: (node: WorkflowNode, removeEdges?: string[]) => void
  onRemove: () => void
  onEnter: () => void
  onAdd: (type: string, handle: string) => void
}) {
  const sources = sourceHandles(node)
  const [picked, setPicked] = useState<{ nodeId: string; handle: string } | null>(null)
  const handle = chosenHandle(sources, node.id, picked)
  const [addType, setAddType] = useState<string>('goto')
  const choices = useMemo(() => choiceList(graph, stack, node.id, insideLoop), [graph, stack, node.id, insideLoop])
  const patch: NodePatch = (data, removeEdges) => onChange({ ...node, data }, removeEdges)
  const { cases, locator, codeOutputs, until } = readNodeBits(node)

  return (
    <div className="grid gap-3 p-3">
      <NodeHeading node={node} patch={patch} />
      <NodePorts node={node} choices={choices} codeOutputs={codeOutputs} until={until} patch={patch} />
      <NodePageFields node={node} patch={patch} />
      <NodeCodeFields node={node} patch={patch} />
      <LocatorFields node={node} locator={locator} patch={patch} />
      <CaseFields node={node} cases={cases} edges={edges} choices={choices} patch={patch} />
      {showFor(node, ['loop'], <Button type="button" variant="outline" size="sm" onClick={onEnter}>进入循环</Button>)}
      <NextLink
        sources={sources}
        handle={handle}
        addType={addType}
        onPick={(value) => setPicked({ nodeId: node.id, handle: value })}
        onAddType={setAddType}
        onAdd={onAdd}
      />
      <RemoveNode node={node} onRemove={onRemove} />
    </div>
  )
}

function EditorCanvas({ workflow, onBack }: { workflow: WorkflowInfo; onBack: () => void }) {
  const [stack, setStack] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const level = useMemo(() => levelAt(workflow.graph, stack), [workflow.graph, stack])
  if (level.missing && stack.length > 0) setStack([])
  const flow = useMemo(() => toFlow(level.nodes, level.edges), [level.nodes, level.edges])
  const [nodes, setNodes] = useState<FlowNode[]>(flow.nodes)
  const [edges, setEdges] = useState<Edge[]>(flow.edges)
  const { fitView } = useReactFlow()
  const signature = JSON.stringify(flow)
  const stackKey = stack.join('/')
  const nodeCount = level.nodes.length
  const edgeCount = level.edges.length

  useEffect(() => {
    setNodes(flow.nodes)
    setEdges(flow.edges)
  }, [signature, flow.nodes, flow.edges])

  useEffect(() => {
    const timer = window.setTimeout(() => fitView({ padding: 0.2 }), 30)
    return () => window.clearTimeout(timer)
  }, [workflow.id, stackKey, nodeCount, edgeCount, fitView])

  const save = useCallback(async (patch: Patch) => {
    setError('')
    try {
      await window.browser.updateWorkflow({ workflow: workflow.id, ...patch })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '没能保存')
    }
  }, [workflow.id])

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== 'remove'), current))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes.filter((change) => change.type !== 'remove'), current))
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const reason = connectError(level.edges, connection)
    if (reason) {
      setError(reason)
      return
    }
    const source = connection.source || ''
    const target = connection.target || ''
    if (!source || !target) return
    const sourceHandle = connection.sourceHandle || 'source'
    void save({
      edges: [{
        id: `${source}-${sourceHandle}-${target}-target`,
        source,
        target,
        sourceHandle,
        targetHandle: 'target'
      }]
    })
  }, [level.edges, save])

  const selected = level.nodes.find((node) => node.id === selectedId)

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>关闭</Button>
        <Button type="button" variant="ghost" size="sm" className="max-w-36 truncate px-2" onClick={() => setStack([])}>{workflow.name}</Button>
        {level.titles.map((title, index) => (
          <Button key={stack[index]} type="button" variant="ghost" size="sm" className="px-2" onClick={() => setStack(stack.slice(0, index + 1))}>
            {title}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            void window.browser.exportWorkflow(workflow.id).catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : '导出失败')
            })
          }}
        >
          导出
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">从右侧端点拖到下一个节点左侧。选中连线后按 Delete 删除。判断的每个分支是一个端点。</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-[#f3f3f3]">
        <ReactFlow
          className="h-full min-w-0 flex-1"
          nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedId }))}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId('')}
          onNodeDoubleClick={(_event, node) => {
            if (node.data.kind === 'loop') {
              setStack((current) => [...current, node.id])
              setSelectedId('')
            }
          }}
          onNodeDragStop={(_event, node) => {
            const raw = level.nodes.find((item) => item.id === node.id)
            if (!raw) return
            void save({ nodes: [{ ...raw, position: { x: node.position.x, y: node.position.y } }] })
          }}
          onEdgesDelete={(deleted) => {
            if (!deleted.length) return
            void save({ removeEdges: deleted.map((edge) => edge.id) })
          }}
          onNodesDelete={(deleted) => {
            const ids = deleted.filter((node) => node.data.kind !== 'start').map((node) => node.id)
            if (!ids.length) return
            if (ids.includes(selectedId)) setSelectedId('')
            void save({ removeNodes: ids })
          }}
          onBeforeDelete={async ({ nodes: doomed, edges: doomedEdges }) => {
            const start = doomed.find((node) => node.data.kind === 'start')
            if (start && doomed.length === 1 && doomedEdges.length === 0) {
              setError('开始节点不能删除')
              return false
            }
            return { nodes: doomed.filter((node) => node.data.kind !== 'start'), edges: doomedEdges }
          }}
          isValidConnection={(connection) => !connectError(level.edges, connection)}
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#d4d4d4" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <aside className="w-64 shrink-0 overflow-y-auto border-l bg-popover">
          {selected ? (
            <NodePanel
              key={selected.id}
              node={selected}
              graph={workflow.graph}
              stack={stack}
              edges={level.edges}
              insideLoop={Boolean(level.parentId)}
              onChange={(next, removeEdges) => void save({ nodes: [level.parentId ? { ...next, parent: level.parentId } : next], removeEdges })}
              onRemove={() => {
                setSelectedId('')
                void save({ removeNodes: [selected.id] })
              }}
              onEnter={() => {
                setStack((current) => [...current, selected.id])
                setSelectedId('')
              }}
              onAdd={(type, sourceHandle) => {
                const flowNode = nodes.find((item) => item.id === selected.id)
                const created: WorkflowNode & { parent?: string } = {
                  id: nodeId(),
                  position: { x: (flowNode?.position.x ?? 0) + 240, y: flowNode?.position.y ?? 0 },
                  data: defaultData(type),
                  parent: level.parentId
                }
                void save({
                  nodes: [created],
                  edges: [{
                    id: `${selected.id}-${sourceHandle}-${created.id}-target`,
                    source: selected.id,
                    target: created.id,
                    sourceHandle,
                    targetHandle: 'target'
                  }]
                })
              }}
            />
          ) : (
            <p className="p-3 text-xs text-muted-foreground">点一个节点，在这里改输入和输出。输入从上游产出里选。</p>
          )}
        </aside>
      </div>
    </section>
  )
}

export function WorkflowEditor({ workflow, onBack }: { workflow: WorkflowInfo; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <EditorCanvas workflow={workflow} onBack={onBack} />
    </ReactFlowProvider>
  )
}
