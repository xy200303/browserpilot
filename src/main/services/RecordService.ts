import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import vm from 'vm'
import type { ActVia, GestureVia, Locator, WorkflowApp, WorkflowEdge, WorkflowNode } from '@shared/types'
import { createId } from '../ids'
import { enterRun, leaveRun, type TabRuntime } from '../runtime'
import { storage } from './store'
import {
  clickLocator,
  clickPoint,
  evalSource,
  navigate,
  pasteLocator,
  pressShortcut,
  locatorSeen,
  resolveLocator,
  screenshot,
  scrollPage,
  selectLocator,
  sendCdp,
  settleNavigation,
  swipePage,
  typeLocator,
  uploadFiles,
  waitForLocator
} from '../page'
import { beginAgentAction, beginHandoff, showAgentMask } from '../windows'
import { netExport, isWatching } from './NetService'

const template = /\{\{#([\w\u4e00-\u9fff.-]+)#\}\}/g

type Pool = Record<string, Record<string, unknown>>
type Data = Record<string, unknown> & { type: string; title?: string }

export function workflowParams(app: WorkflowApp): { name: string; description?: string }[] {
  const start = app.workflow.graph.nodes.find((node) => node.data.type === 'start')
  const variables = start?.data.variables
  if (!Array.isArray(variables)) return []
  return variables.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const variable = (item as { variable?: unknown }).variable
    if (typeof variable !== 'string' || !variable) return []
    const label = (item as { label?: unknown }).label
    return [{ name: variable, description: typeof label === 'string' ? label : undefined }]
  })
}

export function workflowWrite(raw: {
  app: { name: string; description?: string }
  workflow: WorkflowApp['workflow']
}): WorkflowApp {
  const graph = normalizeLevel(raw.workflow.graph.nodes, raw.workflow.graph.edges)
  assertGraph(graph.nodes, graph.edges)
  const name = raw.app.name.trim()
  if (!name) throw new Error('工作流需要名称')
  const existing = storage.workflows.find((item) => item.app.name === name)
  const saved: WorkflowApp = {
    id: existing?.id ?? createId('wf'),
    kind: 'app',
    version: '0.3.0',
    app: { name, mode: 'workflow', description: raw.app.description?.trim() ?? '' },
    workflow: {
      environment_variables: raw.workflow.environment_variables ?? [],
      conversation_variables: [],
      graph
    }
  }
  if (existing) {
    const index = storage.workflows.indexOf(existing)
    storage.workflows[index] = saved
  } else {
    storage.workflows.unshift(saved)
  }
  storage.saveWorkflows()
  return saved
}

export function findWorkflow(nameOrId: string): WorkflowApp {
  const found = storage.workflows.find((item) => item.id === nameOrId || item.app.name === nameOrId)
  if (!found) throw new Error(`没有这个工作流 ${nameOrId}`)
  return found
}

export function exportWorkflow(nameOrId: string, dest?: string): string {
  const app = findWorkflow(nameOrId)
  const dsl = {
    kind: app.kind,
    version: app.version,
    app: app.app,
    workflow: app.workflow
  }
  const safe = app.app.name.replace(/[\\/:*?"<>|]/g, '_')
  const path = dest || join(storage.dir('exports'), `${safe}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(dsl, null, 2)}\n`, 'utf8')
  return path
}

export function importWorkflow(filePath: string): WorkflowApp {
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('这个文件是空的')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('这个文件不是 JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('这个文件不是工作流')
  const doc = raw as {
    app?: { name?: unknown; description?: unknown; mode?: unknown }
    workflow?: { graph?: { nodes?: unknown; edges?: unknown }; environment_variables?: { name: string; value: string }[] }
  }
  const name = typeof doc.app?.name === 'string' ? doc.app.name : ''
  const nodes = doc.workflow?.graph?.nodes
  const edges = doc.workflow?.graph?.edges
  if (!name || !Array.isArray(nodes) || !Array.isArray(edges)) throw new Error('这个文件里没有工作流图')
  if (doc.app?.mode && doc.app.mode !== 'workflow') throw new Error('只导入工作流')
  return workflowWrite({
    app: { name, description: typeof doc.app?.description === 'string' ? doc.app.description : '' },
    workflow: {
      environment_variables: doc.workflow?.environment_variables ?? [],
      conversation_variables: [],
      graph: { nodes: nodes as WorkflowApp['workflow']['graph']['nodes'], edges: edges as WorkflowApp['workflow']['graph']['edges'] }
    }
  })
}

function normalizeGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nextEdges = edges.map((edge, index) => ({
    ...edge,
    id: edge.id || `e${index}-${edge.source}-${edge.target}`,
    sourceHandle: edge.sourceHandle || 'source',
    targetHandle: edge.targetHandle || 'target'
  }))
  return { nodes, edges: nextEdges }
}

function normalizeLevel(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const level = normalizeGraph(nodes, edges)
  for (const node of level.nodes) {
    if (node.data?.type !== 'loop' || !Array.isArray(node.data.nodes)) continue
    const inner = normalizeLevel(node.data.nodes as WorkflowNode[], Array.isArray(node.data.edges) ? (node.data.edges as WorkflowEdge[]) : [])
    node.data.nodes = inner.nodes
    node.data.edges = inner.edges
  }
  return level
}

type GraphLevel = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

function eachLevel(graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, visit: (level: GraphLevel) => boolean): void {
  const walk = (level: GraphLevel): boolean => {
    if (visit(level)) return true
    for (const node of level.nodes) {
      if (node.data?.type === 'loop' && Array.isArray(node.data.nodes) && Array.isArray(node.data.edges)) {
        if (walk({ nodes: node.data.nodes as WorkflowNode[], edges: node.data.edges as WorkflowEdge[] })) return true
      }
    }
    return false
  }
  walk(graph)
}

export function workflowUpdate(
  nameOrId: string,
  patch: {
    description?: string
    rename?: string
    nodes?: (WorkflowNode & { parent?: string })[]
    removeNodes?: string[]
    edges?: WorkflowEdge[]
    removeEdges?: string[]
    environment_variables?: { name: string; value: string }[]
  }
): WorkflowApp {
  const existing = findWorkflow(nameOrId)
  const draft = structuredClone(existing)
  let changed = false
  if (typeof patch.description === 'string') {
    draft.app.description = patch.description
    changed = true
  }
  if (typeof patch.rename === 'string' && patch.rename.trim() && patch.rename.trim() !== draft.app.name) {
    const name = patch.rename.trim()
    if (storage.workflows.some((item) => item.id !== draft.id && item.app.name === name)) throw new Error(`已经有这个名称 ${name}`)
    draft.app.name = name
    changed = true
  }
  if (patch.environment_variables) {
    draft.workflow.environment_variables = patch.environment_variables
    changed = true
  }
  const graph = draft.workflow.graph
  for (const id of patch.removeNodes ?? []) {
    removeNode(graph, id)
    changed = true
  }
  for (const node of patch.nodes ?? []) {
    const parent = node.parent
    const stored = { ...node }
    delete stored.parent
    upsertNode(graph, stored, parent)
    changed = true
  }
  for (const id of patch.removeEdges ?? []) {
    removeEdge(graph, id)
    changed = true
  }
  for (const edge of patch.edges ?? []) {
    upsertEdge(graph, edge)
    changed = true
  }
  if (!changed) throw new Error('没有要更新的内容')
  draft.workflow.graph = normalizeLevel(graph.nodes, graph.edges)
  assertGraph(draft.workflow.graph.nodes, draft.workflow.graph.edges)
  const index = storage.workflows.findIndex((item) => item.id === draft.id)
  storage.workflows[index] = draft
  storage.saveWorkflows()
  return draft
}

function removeNode(graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, id: string): void {
  let removed = false
  eachLevel(graph, (level) => {
    const index = level.nodes.findIndex((node) => node.id === id)
    if (index < 0) return false
    level.nodes.splice(index, 1)
    for (let edgeIndex = level.edges.length - 1; edgeIndex >= 0; edgeIndex -= 1) {
      const edge = level.edges[edgeIndex]
      if (edge.source === id || edge.target === id) level.edges.splice(edgeIndex, 1)
    }
    removed = true
    return true
  })
  if (!removed) throw new Error(`没有这个节点 ${id}`)
}

function upsertNode(graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, node: WorkflowNode, parent?: string): void {
  let replaced = false
  eachLevel(graph, (level) => {
    const index = level.nodes.findIndex((item) => item.id === node.id)
    if (index < 0) return false
    level.nodes[index] = node
    replaced = true
    return true
  })
  if (replaced) return
  if (!parent) {
    graph.nodes.push(node)
    return
  }
  let inserted = false
  eachLevel(graph, (level) => {
    const owner = level.nodes.find((item) => item.id === parent)
    if (!owner || owner.data?.type !== 'loop' || !Array.isArray(owner.data.nodes)) return false
    ;(owner.data.nodes as WorkflowNode[]).push(node)
    inserted = true
    return true
  })
  if (!inserted) throw new Error(`没有这个循环 ${parent}`)
}

function removeEdge(graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, id: string): void {
  let removed = false
  eachLevel(graph, (level) => {
    const index = level.edges.findIndex((edge) => edge.id === id)
    if (index < 0) return false
    level.edges.splice(index, 1)
    removed = true
    return true
  })
  if (!removed) throw new Error(`没有这条连线 ${id}`)
}

function upsertEdge(graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, edge: WorkflowEdge): void {
  if (edge.id) {
    let replaced = false
    eachLevel(graph, (level) => {
      const index = level.edges.findIndex((item) => item.id === edge.id)
      if (index < 0) return false
      level.edges[index] = { ...level.edges[index], ...edge }
      replaced = true
      return true
    })
    if (replaced) return
  }
  let placed = false
  eachLevel(graph, (level) => {
    const ids = new Set(level.nodes.map((node) => node.id))
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false
    const handle = edge.sourceHandle || 'source'
    const index = level.edges.findIndex((item) => item.source === edge.source && item.target === edge.target && (item.sourceHandle || 'source') === handle)
    if (index >= 0) level.edges[index] = { ...level.edges[index], ...edge }
    else level.edges.push(edge)
    placed = true
    return true
  })
  if (!placed) throw new Error(`连线两端不在同一层 ${edge.source} → ${edge.target}`)
}

function assertGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  if (!nodes.length) throw new Error('工作流至少要有一个节点')
  const starts = nodes.filter((node) => node.data.type === 'start')
  if (starts.length !== 1) throw new Error('工作流需要一个开始节点')
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!node.id) throw new Error('节点缺少编号')
    if (ids.has(node.id)) throw new Error(`节点编号重复 ${node.id}`)
    ids.add(node.id)
    if (!node.data?.type) throw new Error(`节点 ${node.id} 缺少类型`)
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`连线指向了不存在的节点 ${edge.source} → ${edge.target}`)
  }
  for (const node of nodes) {
    if (node.data.type === 'loop') assertLoop(node.id, node.data as Data, ids)
  }
}

function assertLoop(ownerId: string, data: Data, used: Set<string>): void {
  const innerNodes = Array.isArray(data.nodes) ? (data.nodes as WorkflowNode[]) : []
  const innerEdges = Array.isArray(data.edges) ? (data.edges as WorkflowEdge[]) : []
  if (!innerNodes.length) throw new Error(`循环 ${ownerId} 缺少内部节点`)
  const innerIds = new Set<string>()
  for (const inner of innerNodes) {
    if (!inner.id || innerIds.has(inner.id) || used.has(inner.id)) throw new Error(`循环 ${ownerId} 的内部编号重复或和外面冲突`)
    innerIds.add(inner.id)
    used.add(inner.id)
  }
  for (const edge of innerEdges) {
    if (!innerIds.has(edge.source) || !innerIds.has(edge.target)) throw new Error(`循环 ${ownerId} 的连线指向了内部没有的节点`)
  }
  for (const inner of innerNodes) {
    if (inner.data?.type === 'loop') assertLoop(inner.id, inner.data as Data, used)
  }
}

export async function runWorkflow(
  tab: TabRuntime,
  app: WorkflowApp,
  inputs: Record<string, string>
): Promise<Record<string, unknown>> {
  enterRun()
  const failed = { node: '' }
  const exported = { files: [] as string[] }
    const outputs: Record<string, unknown> = {}
    const produced = { id: '' }
  try {
    if (tab.control !== 'shared') beginAgentAction(tab)
    const pool = seed(app, tab, inputs)
    const nodes = new Map(app.workflow.graph.nodes.map((node) => [node.id, node]))
    const start = app.workflow.graph.nodes.find((node) => node.data.type === 'start')
    if (!start) throw new Error('工作流需要一个开始节点')
    await walk(tab, nodes, app.workflow.graph.edges, pool, exported, outputs, start.id, new Set(), failed, produced)
    if (!Object.keys(outputs).length && produced.id && pool[produced.id]) Object.assign(outputs, pool[produced.id])
    const takenOver = tab.control === 'shared'
    storage.addRun({ id: createId('run'), workflowId: app.id, at: Date.now(), ok: true, title: tab.title })
    return { ok: true, workflow: app.id, title: tab.title, files: exported.files, outputs, takenOver }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    let shot = ''
    let shotError = ''
    try {
      shot = (await screenshot(tab, storage.dir('runs'))).path
    } catch (shotFailure) {
      shotError = shotFailure instanceof Error ? shotFailure.message : String(shotFailure)
    }
    const har = isWatching(tab.id) ? netExport(tab.id, storage.dir('runs')) : undefined
    storage.addRun({
      id: createId('run'),
      workflowId: app.id,
      at: Date.now(),
      ok: false,
      node: failed.node,
      title: tab.title,
      error: message,
      screenshot: shot
    })
    return {
      ok: false,
      workflow: app.id,
      node: failed.node,
      error: shotError ? `${message}（截图失败：${shotError}）` : message,
      screenshot: shot,
      har,
      title: tab.title,
      files: exported.files,
      takenOver: false
    }
  } finally {
    leaveRun()
  }
}

function seed(app: WorkflowApp, tab: TabRuntime, inputs: Record<string, string>): Pool {
  const pool: Pool = {
    sys: {},
    env: {},
    input: {}
  }
  for (const item of app.workflow.environment_variables) pool.env[item.name] = item.value
  const start = app.workflow.graph.nodes.find((node) => node.data.type === 'start')
  const variables = Array.isArray(start?.data.variables) ? start.data.variables : []
  for (const item of variables) {
    if (!item || typeof item !== 'object') continue
    const variable = (item as { variable?: unknown }).variable
    if (typeof variable !== 'string' || !variable) continue
    const required = (item as { required?: unknown }).required !== false
    const raw = inputs[variable]
    if ((raw == null || raw === '') && required) throw new Error(`缺少参数 ${variable}`)
    const type = (item as { type?: unknown }).type
    pool.input[variable] = type === 'number' ? Number(raw ?? 0) : (raw ?? '')
  }
  syncSys(pool, tab)
  return pool
}

function syncSys(pool: Pool, tab: TabRuntime): void {
  pool.sys.url = tab.url
  pool.sys.title = tab.title
  pool.sys.tabId = tab.id
  pool.sys.env = tab.envId
}

function outgoing(edges: WorkflowEdge[], id: string, handle = 'source'): string[] {
  return edges
    .filter((edge) => edge.source === id && (edge.sourceHandle || 'source') === handle)
    .map((edge) => edge.target)
}

async function walk(
  tab: TabRuntime,
  nodes: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  pool: Pool,
  exported: { files: string[] },
  outputs: Record<string, unknown>,
  id: string,
  ran: Set<string>,
  failed: { node: string },
  produced: { id: string }
): Promise<void> {
  if (ran.has(id)) throw new Error(`节点 ${id} 被走到了两次，工作流不能成环，也不能汇合`)
  const node = nodes.get(id)
  if (!node) throw new Error(`没有这个节点 ${id}`)
  ran.add(id)
  failed.node = id
  const data = node.data as Data
  let handle = 'source'
  if (data.type === 'if-else') handle = await chooseCase(tab, data, pool)
  else if (data.type === 'end') collectEnd(data, pool, outputs)
  else if (data.type !== 'start') await execNode(tab, nodes, edges, node, data, pool, exported, outputs, failed, produced)
  if (data.type === 'end') return
  syncSys(pool, tab)
  for (const next of outgoing(edges, id, handle)) {
    await walk(tab, nodes, edges, pool, exported, outputs, next, ran, failed, produced)
  }
}

async function chooseCase(tab: TabRuntime, data: Data, pool: Pool): Promise<string> {
  const cases = Array.isArray(data.cases) ? data.cases : []
  for (const item of cases) {
    if (!item || typeof item !== 'object') continue
    const caseId = (item as { case_id?: unknown }).case_id
    const conditions = (item as { conditions?: unknown }).conditions
    if (typeof caseId !== 'string' || !Array.isArray(conditions)) continue
    let matched = conditions.length > 0
    for (const condition of conditions) {
      if (!(await conditionMatches(tab, condition, pool))) matched = false
    }
    if (matched) return caseId
  }
  return 'false'
}

async function conditionMatches(tab: TabRuntime, condition: unknown, pool: Pool): Promise<boolean> {
  if (!condition || typeof condition !== 'object') return false
  const item = condition as Record<string, unknown>
  const operator = String(item.comparison_operator || '')
  if (operator === 'locator') return locatorSeen(tab, locatorFrom(item.locator, pool) ?? {}, Number(item.timeoutMs ?? 3000))
  const selector = asSelector(item.variable_selector)
  const current = asText(readSelector(pool, selector))
  const expected = typeof item.value === 'string' ? render(item.value, pool) : ''
  if (operator === 'contains') return current.includes(expected)
  if (operator === 'is') return current === expected
  if (operator === 'not empty') return current.trim() !== ''
  if (operator === 'empty') return current.trim() === ''
  throw new Error(`不认识的判断 ${operator}`)
}

function collectEnd(data: Data, pool: Pool, outputs: Record<string, unknown>): void {
  const list = Array.isArray(data.outputs) ? data.outputs : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const variable = (item as { variable?: unknown }).variable
    const selector = (item as { value_selector?: unknown }).value_selector
    if (typeof variable !== 'string' || !variable) continue
    outputs[variable] = readSelector(pool, asSelector(selector))
  }
}

async function execNode(
  tab: TabRuntime,
  nodes: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  node: WorkflowNode,
  data: Data,
  pool: Pool,
  exported: { files: string[] },
  outputs: Record<string, unknown>,
  failed: { node: string },
  produced: { id: string }
): Promise<void> {
  const id = node.id
  if (data.type === 'goto') {
    await navigate(tab, textOf(data, 'url', pool))
    return
  }
  if (data.type === 'click') {
    const point = pointFrom(data, pool)
    if (point) {
      await clickPoint(tab, point.x, point.y, viaOf(data.via), point.shot)
      await settleNavigation(tab)
      return
    }
    const locator = mustLocator(data.locator, pool)
    await waitForLocator(tab, locator)
    await clickLocator(tab, locator, viaOf(data.via), locatorFrom(data.until, pool))
    await settleNavigation(tab)
    return
  }
  if (data.type === 'fill') {
    const locator = mustLocator(data.locator, pool)
    const text = textOf(data, 'text', pool)
    const entry = data.entry === 'paste' ? 'paste' : data.entry === 'type' ? 'type' : ''
    if (!entry) throw new Error('填写节点的 entry 要写 type 或 paste')
    await waitForLocator(tab, locator)
    if (entry === 'type') await typeLocator(tab, locator, text, viaOf(data.via))
    else await pasteLocator(tab, locator, text, viaOf(data.via))
    return
  }
  if (data.type === 'select') {
    const locator = mustLocator(data.locator, pool)
    await waitForLocator(tab, locator)
    await selectLocator(tab, locator, textOf(data, 'option', pool), viaOf(data.via))
    return
  }
  if (data.type === 'press') {
    await pressShortcut(tab, textOf(data, 'shortcut', pool), gestureOf(data.via))
    return
  }
  if (data.type === 'scroll' || data.type === 'swipe') {
    const locator = locatorFrom(data.locator, pool)
    const until = locatorFrom(data.until, pool)
    const direction = textOf(data, 'direction', pool)
    if (data.type === 'scroll') {
      if (direction !== 'up' && direction !== 'down') throw new Error('滚动方向只能是 up 或 down')
      await scrollPage(tab, direction, gestureOf(data.via), locator, until)
    } else {
      if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
        throw new Error('滑动方向只能是 up、down、left 或 right')
      }
      await swipePage(tab, direction, locator, until, gestureOf(data.via))
    }
    return
  }
  if (data.type === 'upload') {
    const locator = mustLocator(data.locator, pool)
    const paths = Array.isArray(data.paths) ? data.paths.map((item) => render(String(item), pool)) : []
    if (!paths.length) throw new Error('上传需要本机路径')
    await waitForLocator(tab, locator)
    const target = await resolveLocator(tab, locator)
    await uploadFiles(tab, paths, target.backendNodeId)
    return
  }
  if (data.type === 'handoff') {
    beginHandoff(tab, textOf(data, 'message', pool))
    const nextIds = outgoing(edges, id)
    if (nextIds.length === 1) {
      const next = nodes.get(nextIds[0])
      const locator = next ? locatorFrom((next.data as Data).locator, pool) : undefined
      if (locator) await waitForLocator(tab, locator, 10 * 60_000)
    }
    showAgentMask(tab)
    return
  }
  if (data.type === 'script') {
    pool[id] = await runScript(tab, data, pool)
    produced.id = id
    await settleNavigation(tab)
    return
  }
  if (data.type === 'cdp') {
    const method = textOf(data, 'method', pool)
    const params = renderValue(data.params ?? {}, pool)
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('cdp 参数需要对象')
    await sendCdp(tab, method, params as Record<string, unknown>)
    return
  }
  if (data.type === 'http-request') {
    pool[id] = await httpRequest(tab, data, pool)
    produced.id = id
    return
  }
  if (data.type === 'code') {
    pool[id] = await runCode(data, pool)
    produced.id = id
    return
  }
  if (data.type === 'loop') {
    pool[id] = await runLoop(tab, nodes, node, data, pool, exported, outputs, failed, produced)
    produced.id = id
    return
  }
  if (data.type === 'extract') {
    pool[id] = extractText(data, pool)
    produced.id = id
    return
  }
  if (data.type === 'export') {
    const path = writeExport(data, pool)
    exported.files.push(path)
    pool[id] = { path }
    produced.id = id
    return
  }
  throw new Error(`不认识这个节点 ${data.type}`)
}

async function httpRequest(tab: TabRuntime, data: Data, pool: Pool): Promise<Record<string, unknown>> {
  const method = (typeof data.method === 'string' ? data.method : 'get').toUpperCase()
  const url = textOf(data, 'url', pool)
  const headerText = typeof data.headers === 'string' ? render(data.headers, pool) : ''
  const headers: Record<string, string> = {}
  for (const line of headerText.split('\n')) {
    const split = line.indexOf(':')
    if (split <= 0) continue
    headers[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  const body = bodyText(data.body, pool)
  const result = await evalSource(
    tab,
    `(async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(headers)},
        body: ${method === 'GET' || method === 'HEAD' || body == null ? 'undefined' : JSON.stringify(body)}
      })
      return { status_code: res.status, body: await res.text() }
    })()`
  )
  if (!result || typeof result !== 'object') throw new Error('HTTP 请求没有返回')
  const record = result as Record<string, unknown>
  if (typeof record.body === 'string') {
    try {
      const parsed = JSON.parse(record.body) as unknown
      if (parsed && typeof parsed === 'object') record.json = parsed
    } catch {
      record.json = null
    }
  }
  return record
}

function bodyText(body: unknown, pool: Pool): string | undefined {
  if (typeof body === 'string') return render(body, pool)
  if (!body || typeof body !== 'object') return undefined
  const data = (body as { data?: unknown }).data
  if (typeof data === 'string') return render(data, pool)
  return undefined
}

function declaredInputs(data: Data, pool: Pool): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const variables = Array.isArray(data.variables) ? data.variables : []
  for (const item of variables) {
    if (!item || typeof item !== 'object') continue
    const variable = (item as { variable?: unknown }).variable
    const selector = (item as { value_selector?: unknown }).value_selector
    if (typeof variable !== 'string' || !variable) continue
    inputs[variable] = readSelector(pool, asSelector(selector))
  }
  return inputs
}

async function runScript(tab: TabRuntime, data: Data, pool: Pool): Promise<Record<string, unknown>> {
  const source = typeof data.source === 'string' ? data.source : ''
  if (!source.trim()) throw new Error('页面脚本缺少 source')
  const inputs = declaredInputs(data, pool)
  const result = await evalSource(
    tab,
    `(async () => {
      const inputs = ${JSON.stringify(inputs)};
      return await (async () => { ${source} })();
    })()`
  )
  return checkOutput(result, data, '页面脚本')
}

async function runCode(data: Data, pool: Pool): Promise<Record<string, unknown>> {
  const source = typeof data.code === 'string' ? data.code : ''
  if (!source.trim()) throw new Error('代码节点缺少 code')
  const context = vm.createContext({ inputs: declaredInputs(data, pool) })
  const script = new vm.Script(`(async () => {\n${source}\n})()`)
  const result = await Promise.race([
    Promise.resolve(script.runInContext(context) as Promise<unknown>),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('代码超时')), 120_000))
  ])
  return checkOutput(result, data, '代码节点')
}

async function runLoop(
  tab: TabRuntime,
  outer: Map<string, WorkflowNode>,
  _node: WorkflowNode,
  data: Data,
  pool: Pool,
  exported: { files: string[] },
  _outputs: Record<string, unknown>,
  failed: { node: string },
  _produced: { id: string }
): Promise<Record<string, unknown>> {
  const bodyNodes = (Array.isArray(data.nodes) ? data.nodes : []) as WorkflowNode[]
  const bodyEdges = (Array.isArray(data.edges) ? data.edges : []) as WorkflowEdge[]
  const map = new Map(bodyNodes.map((item) => [item.id, item]))
  for (const id of map.keys()) {
    if (outer.has(id)) throw new Error(`循环内部编号和外面冲突 ${id}`)
  }
  const targeted = new Set(bodyEdges.map((edge) => edge.target))
  const entries = bodyNodes.filter((item) => !targeted.has(item.id)).map((item) => item.id)
  if (!entries.length) throw new Error('循环内部需要一个入口')
  const mode = data.mode === 'until' ? 'until' : 'list'
  if (mode === 'until' && !data.until) throw new Error('循环缺少 until')
  const items = mode === 'list' ? asArray(readSelector(pool, asSelector(data.items_selector))) : []
  const max = typeof data.max === 'number' ? data.max : mode === 'list' ? Math.max(items.length, 1) : 40
  if (mode === 'list' && items.length > max) throw new Error(`循环列表有 ${items.length} 项，超过上限 ${max}`)
  const rounds = mode === 'list' ? items.length : max
  const collected: Record<string, unknown>[] = []
  const saved = pool.loop
  let stopped = mode === 'list'
  try {
    for (let index = 0; index < rounds; index += 1) {
      const state: Record<string, unknown> = { index: index + 1 }
      if (mode === 'list') state.item = items[index]
      pool.loop = state
      const local: Record<string, unknown> = {}
      const innerProduced = { id: '' }
      for (const entry of entries) {
        await walk(tab, map, bodyEdges, pool, exported, local, entry, new Set(), failed, innerProduced)
      }
      const snapshot = Object.keys(local).length ? local : innerProduced.id ? pool[innerProduced.id] : {}
      collected.push({ ...snapshot })
      if (mode === 'until' && (await conditionMatches(tab, data.until, pool))) {
        stopped = true
        break
      }
    }
  } finally {
    if (saved) pool.loop = saved
  }
  if (!stopped) throw new Error(`循环超过 ${max} 次`)
  return { output: collected, index: collected.length }
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('循环列表必须是数组')
  return value
}

function checkOutput(result: unknown, data: Data, label: string): Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`${label}必须 return 一个对象`)
  const output = result as Record<string, unknown>
  const schema = data.outputs
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    for (const [key, spec] of Object.entries(schema as Record<string, { type?: string }>)) {
      if (!(key in output)) throw new Error(`${label}缺少输出 ${key}`)
      const expected = spec?.type
      if (expected && !typeMatches(output[key], expected)) throw new Error(`${label}的 ${key} 不是 ${expected}`)
    }
  }
  return output
}

function typeMatches(value: unknown, expected: string): boolean {
  if (expected === 'string') return typeof value === 'string'
  if (expected === 'number') return typeof value === 'number'
  if (expected === 'boolean') return typeof value === 'boolean'
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  return true
}

function extractText(data: Data, pool: Pool): Record<string, unknown> {
  const source = asText(readSelector(pool, asSelector(data.variable_selector)))
  const pattern = typeof data.pattern === 'string' ? data.pattern : ''
  if (!pattern) throw new Error('正则缺少 pattern')
  const flags = typeof data.flags === 'string' ? data.flags : ''
  if ([...flags].some((flag) => !'imsgu'.includes(flag))) throw new Error('正则 flags 只允许 i、m、s、g、u')
  const expression = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
  const matches: string[] = []
  const group = typeof data.group === 'number' ? data.group : 1
  for (const found of source.matchAll(expression)) matches.push(found[group] ?? found[0] ?? '')
  if (!matches.length) throw new Error('没有匹配到')
  return { value: matches[0], matches }
}

function writeExport(data: Data, pool: Pool): string {
  if (Array.isArray(data.data_selector)) {
    const table = readSelector(pool, asSelector(data.data_selector))
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error('导出需要一个对象')
    const record = table as Record<string, unknown>
    if (typeof record.filename !== 'string') throw new Error('导出对象缺少 filename')
    return writeTable(record.filename, asStringList(record.headers), asRows(record.rows))
  }
  const filename = textOf(data, 'filename', pool)
  const headers = Array.isArray(data.headers)
    ? data.headers.map((item) => String(item))
    : asStringList(readSelector(pool, asSelector(data.headers_selector)))
  return writeTable(filename, headers, asRows(readSelector(pool, asSelector(data.rows_selector))))
}

function asRows(value: unknown): unknown[][] {
  if (!Array.isArray(value) || value.some((row) => !Array.isArray(row))) throw new Error('导出行必须是数组的数组')
  return value
}

function writeTable(filename: string, headers: string[], rows: unknown[][]): string {
  const safe = filename.replace(/[\\/:*?"<>|]/g, '_')
  const dir = storage.dir('exports')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, safe.endsWith('.csv') ? safe : `${safe}.csv`)
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','))
  writeFileSync(path, `\uFEFF${lines.join('\r\n')}`, 'utf8')
  return path
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('表头必须是字符串数组')
  return value
}

function render(text: string, pool: Pool): string {
  return text.replace(template, (_full, path: string) => asText(readSelector(pool, path.split('.'))))
}

function renderValue(value: unknown, pool: Pool): unknown {
  if (typeof value === 'string') return render(value, pool)
  if (Array.isArray(value)) return value.map((item) => renderValue(item, pool))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) next[key] = renderValue(item, pool)
    return next
  }
  return value
}

function readSelector(pool: Pool, selector: string[]): unknown {
  if (selector.length < 2) throw new Error('变量选择器至少两段')
  const [node, ...rest] = selector
  if (!pool[node]) throw new Error(`缺少变量 ${selector.join('.')}`)
  let current: unknown = pool[node]
  for (const part of rest) {
    if (!current || typeof current !== 'object' || !(part in (current as Record<string, unknown>))) {
      throw new Error(`缺少变量 ${selector.join('.')}`)
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function asSelector(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('变量选择器需要字符串数组')
  return value
}

function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function textOf(data: Data, key: string, pool: Pool): string {
  const value = data[key]
  if (typeof value !== 'string') throw new Error(`节点缺少 ${key}`)
  return render(value, pool)
}

function pointFrom(data: Data, pool: Pool): { x: number; y: number; shot?: { width: number; height: number } } | undefined {
  const hasX = data.x != null && String(data.x) !== ''
  const hasY = data.y != null && String(data.y) !== ''
  if (!hasX && !hasY) return undefined
  if (!hasX || !hasY) throw new Error('画布坐标要同时写 x 和 y')
  const x = Number(render(String(data.x), pool))
  const y = Number(render(String(data.y), pool))
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('画布坐标要是数字')
  const hasW = data.shotWidth != null && String(data.shotWidth) !== ''
  const hasH = data.shotHeight != null && String(data.shotHeight) !== ''
  if (hasW !== hasH) throw new Error('截图宽高要一起写')
  if (!hasW) return { x, y }
  const width = Number(render(String(data.shotWidth), pool))
  const height = Number(render(String(data.shotHeight), pool))
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('截图宽高要是数字')
  return { x, y, shot: { width, height } }
}

function locatorFrom(raw: unknown, pool: Pool): Locator | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const item = raw as Record<string, unknown>
  const loc: Locator = {}
  for (const key of ['xpath', 'selector'] as const) {
    const value = item[key]
    if (typeof value === 'string' && value) loc[key] = render(value, pool)
  }
  if (!loc.xpath && !loc.selector) return undefined
  return loc
}

function mustLocator(raw: unknown, pool: Pool): Locator {
  const locator = locatorFrom(raw, pool)
  if (!locator) throw new Error('节点缺少定位')
  return locator
}

function viaOf(value: unknown): ActVia {
  return value === 'inject' || value === 'native' || value === 'cdp' ? value : 'cdp'
}

function gestureOf(value: unknown): GestureVia {
  return value === 'native' ? 'native' : 'cdp'
}
