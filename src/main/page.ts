import { clipboard, nativeImage, net, type WebContents } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { searchEngineOf, type ActVia, type GestureVia, type Locator } from '@shared/types'
import { storage } from './services/store'
import { runFfmpeg } from './services/ffmpeg'
import { downloadBegin, downloadDone, downloadFail, downloadProgress } from './services/DownloadService'
import { acquireDebugger, releaseDebugger, withDebugger } from './services/debugger'
import type { AxRef, TabRuntime } from './runtime'
import { bridge, windows } from './runtime'

type AxNode = {
  nodeId: string
  role: string
  name: string
  value: string
  backendNodeId?: number
  childIds: string[]
}

export function startUrl(): string {
  return searchEngineOf(storage.settings.searchEngine).home
}

export function normalizeUrl(input: string): string {
  const text = input.trim()
  if (!text) return startUrl()
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  if (text.includes(' ') || !text.includes('.')) {
    return `${searchEngineOf(storage.settings.searchEngine).search}${encodeURIComponent(text)}`
  }
  return `https://${text}`
}

function wcOf(tab: TabRuntime): WebContents {
  if (!tab.view) throw new Error('这个标签没有网页')
  return tab.view.webContents
}

export async function readTree(tab: TabRuntime): Promise<{ text: string; nodes: AxNode[] }> {
  const wc = wcOf(tab)
  const flat = await withDebugger(wc, async (dbg) => {
    await dbg.sendCommand('DOM.getDocument', { depth: 0 })
    const result = (await dbg.sendCommand('Accessibility.getFullAXTree')) as {
      nodes: Array<{
        nodeId: string
        role?: { value?: string }
        name?: { value?: string }
        value?: { value?: string }
        backendDOMNodeId?: number
        childIds?: string[]
        ignored?: boolean
      }>
    }
    return (result.nodes ?? [])
      .filter((node) => !node.ignored && node.role?.value && node.role.value !== 'none' && node.role.value !== 'generic')
      .map((node) => ({
        nodeId: node.nodeId,
        role: node.role?.value ?? '',
        name: (node.name?.value ?? '').replace(/\s+/g, ' ').trim(),
        value: node.value?.value ?? '',
        backendNodeId: node.backendDOMNodeId,
        childIds: node.childIds ?? []
      }))
  })
  tab.refs = new Map()
  const lines: string[] = []
  flat.forEach((node, index) => {
    const ref = `e${index + 1}`
    tab.refs.set(ref, { role: node.role, name: node.name, backendNodeId: node.backendNodeId })
    const bits = [`- ${node.role}`]
    if (node.name) bits.push(JSON.stringify(node.name))
    if (node.value) bits.push(`value=${JSON.stringify(node.value)}`)
    lines.push(bits.join(' '))
  })
  return { text: lines.join('\n'), nodes: flat }
}

async function quadBox(tab: TabRuntime, target: AxRef): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    await dbg.sendCommand('DOM.getDocument', { depth: 0 })
    const backendNodeId = target.backendNodeId
    if (!backendNodeId) throw new Error(`页面上还没有「${target.name || target.role}」`)
    const quads = await viewportQuads(dbg, backendNodeId)
    const quad = quads[0]
    if (!quad) throw new Error(`页面上还没有「${target.name || target.role}」`)
    return quadBounds(quad)
  })
}

async function centerOf(tab: TabRuntime, target: AxRef): Promise<{ x: number; y: number }> {
  const box = await quadBox(tab, target)
  return { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) }
}

export function locatorLabel(locator: Locator): string {
  if (locator.xpath) return locator.xpath
  if (locator.selector) return locator.selector
  return '未写定位'
}

export function isQueryLocator(locator: Locator): boolean {
  return Boolean(locator.xpath || locator.selector)
}

const MATCH_CAP = 100

const NODE_TEXT = `function () {
  const raw = (this && (this.innerText || this.textContent || this.value || (this.getAttribute && this.getAttribute('aria-label')))) || ''
  return String(raw).replace(/\\s+/g, ' ').trim().slice(0, 80)
}`

const NODE_BOX = `function () {
  const rect = this.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}`

async function backendIdsOf(dbg: Electron.Debugger, nodeIds: number[]): Promise<number[]> {
  const present = nodeIds.filter((nodeId) => nodeId)
  return Promise.all(present.map(async (nodeId) => {
    const described = (await dbg.sendCommand('DOM.describeNode', { nodeId })) as { node: { backendNodeId: number } }
    return described.node.backendNodeId
  }))
}

async function collectMatches(dbg: Electron.Debugger, locator: Locator): Promise<{ total: number; backendNodeIds: number[] }> {
  if (locator.xpath) {
    const query = locator.xpath.trim()
    if (!query.startsWith('/')) throw new Error('XPath 要以 / 开头')
    await dbg.sendCommand('DOM.getDocument', { depth: 0 })
    const search = (await dbg.sendCommand('DOM.performSearch', { query })) as { searchId: string; resultCount: number }
    try {
      const total = search.resultCount
      if (!total) return { total: 0, backendNodeIds: [] }
      const results = (await dbg.sendCommand('DOM.getSearchResults', {
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: Math.min(total, MATCH_CAP)
      })) as { nodeIds?: number[] }
      return { total, backendNodeIds: await backendIdsOf(dbg, results.nodeIds ?? []) }
    } finally {
      await dbg.sendCommand('DOM.discardSearchResults', { searchId: search.searchId }).catch(() => undefined)
    }
  }
  if (locator.selector) {
    const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } }
    const found = (await dbg.sendCommand('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: locator.selector })) as { nodeIds?: number[] }
    const nodeIds = found.nodeIds ?? []
    return { total: nodeIds.length, backendNodeIds: await backendIdsOf(dbg, nodeIds.slice(0, MATCH_CAP)) }
  }
  throw new Error('需要 xpath 或 selector')
}

function axOf(locator: Locator, backendNodeId: number): AxRef {
  if (locator.xpath) return { role: 'xpath', name: locator.xpath, backendNodeId }
  return { role: 'selector', name: locator.selector ?? '', backendNodeId }
}

export async function resolveLocator(tab: TabRuntime, locator: Locator): Promise<AxRef> {
  return withDebugger(wcOf(tab), async (dbg) => {
    const found = await collectMatches(dbg, locator)
    if (found.total === 0 || !found.backendNodeIds[0]) throw new Error(`页面上还没有 ${locatorLabel(locator)}`)
    if (found.total !== 1) throw new Error(`匹配到 ${found.total} 个 ${locatorLabel(locator)}，这一步只能对应一个`)
    return axOf(locator, found.backendNodeIds[0])
  })
}

export type LocatorMatch = { index: number; text: string; hittable: boolean; rect?: { x: number; y: number; w: number; h: number } }

export async function queryLocator(tab: TabRuntime, locator: Locator): Promise<{ total: number; matches: LocatorMatch[] }> {
  return withDebugger(wcOf(tab), async (dbg) => {
    const found = await collectMatches(dbg, locator)
    const matches = await Promise.all(found.backendNodeIds.map(async (backendNodeId, index) => {
      const [text, hittable, box] = await Promise.all([
        nodeText(dbg, backendNodeId),
        nodeHittable(dbg, tab, backendNodeId),
        callOnBackend(dbg, backendNodeId, NODE_BOX).catch(() => undefined) as Promise<{ left: number; top: number; right: number; bottom: number } | undefined>
      ])
      return {
        index,
        text,
        hittable,
        rect: box ? { x: Math.round(box.left * 10) / 10, y: Math.round(box.top * 10) / 10, w: Math.round((box.right - box.left) * 10) / 10, h: Math.round((box.bottom - box.top) * 10) / 10 } : undefined
      }
    }))
    return { total: found.total, matches }
  })
}

const DEEP_QUERY = `(function (selector, xpath, doScroll) {
  const out = []
  const textOf = (el) => {
    let t = el.innerText
    if (!t && el.shadowRoot) {
      t = [...el.shadowRoot.childNodes].map((n) => n.nodeType === 3 ? n.textContent : (/^(STYLE|SCRIPT)$/.test(n.tagName) ? '' : (n.innerText || n.textContent))).join(' ')
    }
    return String(t || el.textContent || el.value || (el.getAttribute && el.getAttribute('aria-label')) || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  }
  const walk = (root, ox, oy) => {
    let hits = []
    if (selector) {
      try { hits = [...root.querySelectorAll(selector)] } catch (e) { hits = [] }
    } else if (xpath) {
      try {
        const doc = root instanceof Document ? root : root.ownerDocument
        const r = doc.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        for (let i = 0; i < r.snapshotLength; i++) hits.push(r.snapshotItem(i))
      } catch (e) { hits = [] }
    }
    for (const el of hits) {
      if (!(el instanceof Element)) continue
      const r = el.getBoundingClientRect()
      out.push({ el, ox, oy, text: textOf(el), x: r.left + ox, y: r.top + oy, w: r.width, h: r.height })
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot, ox, oy)
    }
    for (const f of root.querySelectorAll('iframe')) {
      try {
        const d = f.contentDocument
        if (d) {
          const fr = f.getBoundingClientRect()
          walk(d, ox + fr.left, oy + fr.top)
        }
      } catch (e) { /* 跨域 iframe 进不去 */ }
    }
  }
  walk(document, 0, 0)
  if (doScroll && out.length === 1) {
    out[0].el.scrollIntoView({ block: 'center' })
    const r = out[0].el.getBoundingClientRect()
    out[0].x = r.left + out[0].ox
    out[0].y = r.top + out[0].oy
    out[0].w = r.width
    out[0].h = r.height
  }
  return out.slice(0, 100).map(({ el, ox, oy, ...rest }) => rest)
})`

export type DeepMatch = { text: string; x: number; y: number; w: number; h: number }

export async function deepQuery(tab: TabRuntime, locator: Locator, doScroll = false): Promise<{ total: number; matches: DeepMatch[] }> {
  const source = `(${DEEP_QUERY})(${JSON.stringify(locator.selector || '')}, ${JSON.stringify(locator.xpath || '')}, ${doScroll ? 'true' : 'false'})`
  const matches = (await evalSource(tab, source)) as DeepMatch[]
  return { total: matches.length, matches }
}

async function deepOne(tab: TabRuntime, locator: Locator, doScroll = false): Promise<DeepMatch> {
  let found = await deepQuery(tab, locator, doScroll)
  if (found.total === 0) {
    const cross = await crossQuery(tab, locator).catch(() => ({ total: 0, matches: [] as DeepMatch[] }))
    found = cross
  }
  if (found.total === 0) throw new Error(`穿透查找也没找到 ${locatorLabel(locator)}`)
  if (found.total !== 1) throw new Error(`穿透查找到 ${found.total} 个 ${locatorLabel(locator)}，这一步只能对应一个。前 3 个：${found.matches.slice(0, 3).map((m) => `「${m.text}」`).join('、')}`)
  return found.matches[0]
}

export async function clickDeep(tab: TabRuntime, locator: Locator, via: ActVia = 'cdp', button: 'left' | 'right' = 'left'): Promise<void> {
  const match = await deepOne(tab, locator, true)
  await sleep(300)
  await clickPoint(tab, match.x + match.w / 2, match.y + match.h / 2, via, undefined, button)
}

export async function typeDeep(tab: TabRuntime, locator: Locator, text: string, via: ActVia = 'cdp'): Promise<void> {
  const match = await deepOne(tab, locator, true)
  await sleep(300)
  await clickPoint(tab, match.x + match.w / 2, match.y + match.h / 2, via === 'inject' ? 'cdp' : via)
  await typeByCdp(tab, text)
}

export async function typeAtPoint(tab: TabRuntime, x: number, y: number, text: string, via: ActVia = 'cdp'): Promise<void> {
  await clickPoint(tab, x, y, via === 'inject' ? 'cdp' : via)
  await typeByCdp(tab, text)
}

export async function evalInFrame(tab: TabRuntime, source: string, frameMatch: string): Promise<unknown> {
  const wc = wcOf(tab)
  const frames = wc.mainFrame.frames ?? []
  const target = frames.find((f) => f.url.includes(frameMatch))
  if (!target) throw new Error(`没有 URL 包含「${frameMatch}」的框架，现有框架：${frames.map((f) => f.url.slice(0, 60)).join('、') || '（无子框架）'}`)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('页面脚本超时')), 120_000)
  })
  try {
    return await Promise.race([target.executeJavaScript(source, true), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function hitPoint(tab: TabRuntime, x: number, y: number, shot?: ShotRef): Promise<Record<string, unknown>> {
  const point = mapPoint(tab, x, y, shot)
  const source = `(() => {
    const el = document.elementFromPoint(${point.x}, ${point.y})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      cls: String(el.className).slice(0, 80),
      id: el.id || '',
      text: String(el.innerText || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height }
    }
  })()`
  const hit = await evalSource(tab, source)
  if (!hit) throw new Error(`(${point.x}, ${point.y}) 上没有元素`)
  return { ...(hit as Record<string, unknown>), x: point.x, y: point.y }
}

export async function crossQuery(tab: TabRuntime, locator: Locator): Promise<{ total: number; matches: DeepMatch[]; errors?: string[] }> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const results: DeepMatch[] = []
    const errors: string[] = []
    const targets = (await dbg.sendCommand('Target.getTargets')) as { targetInfos: Array<{ targetId: string; type: string; url: string }> }
    const frames = targets.targetInfos.filter((item) => item.type === 'iframe')
    for (const frame of frames) {
      let sessionId: string | undefined
      try {
        const attached = (await dbg.sendCommand('Target.attachToTarget', { targetId: frame.targetId, flatten: true })) as { sessionId: string }
        sessionId = attached.sessionId
        let ox = 0
        let oy = 0
        const owner = (await dbg.sendCommand('DOM.getFrameOwner', { frameId: frame.targetId }).catch(() => undefined)) as { backendNodeId?: number } | undefined
        if (owner?.backendNodeId) {
          const quads = (await dbg.sendCommand('DOM.getContentQuads', { backendNodeId: owner.backendNodeId }).catch(() => undefined)) as { quads?: number[][] } | undefined
          const quad = quads?.quads?.[0]
          if (quad) {
            ox = Math.min(quad[0], quad[2], quad[4], quad[6])
            oy = Math.min(quad[1], quad[3], quad[5], quad[7])
          }
        }
        const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 }, sessionId)) as { root: { nodeId: number } }
        let nodeIds: number[] = []
        if (locator.selector) {
          const found = (await dbg.sendCommand('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: locator.selector }, sessionId)) as { nodeIds?: number[] }
          nodeIds = found.nodeIds ?? []
        } else if (locator.xpath) {
          const search = (await dbg.sendCommand('DOM.performSearch', { query: locator.xpath, includeUserAgentShadowDOM: true }, sessionId)) as { searchId: string; resultCount: number }
          if (search.resultCount) {
            const got = (await dbg.sendCommand('DOM.getSearchResults', { searchId: search.searchId, fromIndex: 0, toIndex: Math.min(search.resultCount, 20) }, sessionId)) as { nodeIds?: number[] }
            nodeIds = got.nodeIds ?? []
          }
          await dbg.sendCommand('DOM.discardSearchResults', { searchId: search.searchId }, sessionId).catch(() => undefined)
        }
        for (const nodeId of nodeIds) {
          const described = (await dbg.sendCommand('DOM.describeNode', { nodeId }, sessionId)) as { node: { backendNodeId: number; nodeName: string } }
          const [text, box] = await Promise.all([
            nodeText(dbg, described.node.backendNodeId, sessionId).catch(() => ''),
            dbg.sendCommand('DOM.getBoxModel', { backendNodeId: described.node.backendNodeId }, sessionId).catch(() => undefined) as Promise<{ model?: { content: number[] } } | undefined>
          ])
          const quad = box?.model?.content
          if (!quad) {
            results.push({ text, x: ox, y: oy, w: 0, h: 0 })
            continue
          }
          const left = Math.min(quad[0], quad[2], quad[4], quad[6]) + ox
          const top = Math.min(quad[1], quad[3], quad[5], quad[7]) + oy
          results.push({
            text,
            x: Math.round(left * 10) / 10,
            y: Math.round(top * 10) / 10,
            w: Math.round((Math.max(quad[0], quad[2], quad[4], quad[6]) + ox - left) * 10) / 10,
            h: Math.round((Math.max(quad[1], quad[3], quad[5], quad[7]) + oy - top) * 10) / 10
          })
        }
      } catch (error) {
        errors.push(`${frame.url.slice(0, 50)}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (sessionId) await dbg.sendCommand('Target.detachFromTarget', { sessionId }).catch(() => undefined)
      }
    }
    return { total: results.length, matches: results.slice(0, 100), errors: errors.length ? errors : undefined }
  })
}

async function nodeText(dbg: Electron.Debugger, backendNodeId: number, sessionId?: string): Promise<string> {
  try {
    const value = await callOnBackend(dbg, backendNodeId, NODE_TEXT, [], sessionId)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function nodeHittable(dbg: Electron.Debugger, tab: TabRuntime, backendNodeId: number): Promise<boolean> {
  return Boolean(await pointOnNode(dbg, tab, backendNodeId))
}

const POINT_ON_NODE = `function (viewW, viewH) {
  const el = this
  if (!(el instanceof Element)) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const doc = el.ownerDocument
  const width = Math.min(viewW, doc.defaultView ? doc.defaultView.innerWidth : viewW)
  const height = Math.min(viewH, doc.defaultView ? doc.defaultView.innerHeight : viewH)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const points = []
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = rect.left + ((col + 0.5) / 5) * rect.width
      const y = rect.top + ((row + 0.5) / 5) * rect.height
      points.push({ x: x, y: y, rank: (x - cx) * (x - cx) + (y - cy) * (y - cy) })
    }
  }
  points.sort((a, b) => a.rank - b.rank)
  for (const point of points) {
    if (point.x < 1 || point.y < 1 || point.x >= width - 1 || point.y >= height - 1) continue
    const hit = doc.elementFromPoint(point.x, point.y)
    if (hit instanceof Element && (hit === el || el.contains(hit))) return { x: point.x, y: point.y }
  }
  return null
}`

async function pointOnNode(dbg: Electron.Debugger, tab: TabRuntime, backendNodeId: number): Promise<{ x: number; y: number } | undefined> {
  const [viewW, viewH] = viewport(tab)
  const value = await callOnBackend(dbg, backendNodeId, POINT_ON_NODE, [viewW, viewH]).catch(() => undefined) as { x?: number; y?: number } | null
  if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return undefined
  return { x: value.x, y: value.y }
}

function quadBounds(quad: number[]): { left: number; top: number; right: number; bottom: number } {
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

function shiftQuad(quad: number[], dx: number, dy: number): number[] {
  return quad.map((value, index) => (index % 2 === 0 ? value - dx : value - dy))
}

async function viewportQuads(dbg: Electron.Debugger, backendNodeId: number): Promise<number[][]> {
  const listed = (await dbg.sendCommand('DOM.getContentQuads', { backendNodeId }).catch(() => ({ quads: [] }))) as { quads?: number[][] }
  const raw = (listed.quads ?? []).filter((quad) => quad.length >= 8)
  const box = await callOnBackend(dbg, backendNodeId, NODE_BOX).catch(() => undefined) as { left?: number; top?: number; right?: number; bottom?: number } | undefined
  if (typeof box?.left !== 'number' || typeof box.top !== 'number' || typeof box.right !== 'number' || typeof box.bottom !== 'number') return raw
  const rect = [box.left, box.top, box.right, box.top, box.right, box.bottom, box.left, box.bottom]
  if (!raw.length) return [rect]
  const metrics = (await dbg.sendCommand('Page.getLayoutMetrics').catch(() => ({}))) as {
    cssVisualViewport?: { pageX?: number; pageY?: number }
    visualViewport?: { pageX?: number; pageY?: number }
  }
  const scroll = metrics.cssVisualViewport ?? metrics.visualViewport
  const pageX = scroll?.pageX ?? 0
  const pageY = scroll?.pageY ?? 0
  const bounds = quadBounds(raw[0])
  const documentDistance = Math.abs(bounds.top - (box.top + pageY)) + Math.abs(bounds.left - (box.left + pageX))
  const viewportDistance = Math.abs(bounds.top - box.top) + Math.abs(bounds.left - box.left)
  const aligned = pageY > 1 && documentDistance < viewportDistance ? raw.map((quad) => shiftQuad(quad, pageX, pageY)) : raw
  return [...aligned, rect]
}

async function sceneOf(tab: TabRuntime, locator: Locator): Promise<string> {
  const found = await queryLocator(tab, locator)
  const shown = found.matches.slice(0, 3).map((item) => `「${item.text || '空'}」${item.hittable ? '能点到' : '点不到'}`)
  const count = found.total > shown.length ? `匹配 ${found.total} 个，前 ${shown.length} 个` : `匹配 ${found.total} 个`
  return shown.length ? `${count}：${shown.join('、')}` : count
}

async function failWithScene(tab: TabRuntime, locator: Locator, message: string): Promise<never> {
  const scene = await sceneOf(tab, locator).catch(() => '')
  throw new Error(scene ? `${message}。${scene}` : message)
}

export async function clickLocator(tab: TabRuntime, locator: Locator, via: ActVia = 'cdp', until?: Locator, button: 'left' | 'right' = 'left'): Promise<void> {
  const rounds = until ? 3 : 1
  for (let round = 0; round < rounds; round += 1) {
    try {
      const target = await resolveLocator(tab, locator)
      await clickKnown(tab, target, via, button)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!until || round === rounds - 1) await failWithScene(tab, locator, message)
      await sleep(250)
      continue
    }
    if (!until) return
    if (await locatorSeen(tab, until, 1_200)) return
    await sleep(200)
  }
  const waited = until ? await sceneOf(tab, until).catch(() => '') : ''
  await failWithScene(
    tab,
    locator,
    `点了 ${locatorLabel(locator)} 之后仍没有 ${until ? locatorLabel(until) : ''}${waited ? `。等待的目标 ${waited}` : ''}`
  )
}

async function focusResolved(tab: TabRuntime, target: AxRef): Promise<void> {
  if (!target.backendNodeId) throw new Error(`页面上还没有「${target.name || target.role}」`)
  await withDebugger(wcOf(tab), async (dbg) => {
    await dbg.sendCommand('DOM.focus', { backendNodeId: target.backendNodeId })
  })
}

export async function typeLocator(tab: TabRuntime, locator: Locator, text: string, via: ActVia = 'cdp'): Promise<void> {
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const wrote = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_TEXT, [text]))
    if (wrote !== true) throw new Error(`写不进 ${locatorLabel(locator)}`)
    return
  }
  if (via === 'cdp') {
    await focusResolved(tab, target)
    await typeByCdp(tab, text)
    return
  }
  await clickKnown(tab, target, 'native')
  const wc = wcOf(tab)
  for (const ch of text) {
    wc.sendInputEvent({ type: 'char', keyCode: ch })
  }
}

export async function pasteLocator(tab: TabRuntime, locator: Locator, text: string, via: ActVia = 'cdp'): Promise<void> {
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const wrote = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_TEXT, [text]))
    if (wrote !== true) throw new Error(`写不进 ${locatorLabel(locator)}`)
    return
  }
  if (via === 'cdp') {
    await focusResolved(tab, target)
    await withDebugger(wcOf(tab), async (dbg) => {
      await dbg.sendCommand('Input.insertText', { text })
    })
    return
  }
  await clickKnown(tab, target, 'native')
  clipboard.writeText(text)
  await pressShortcut(tab, 'Ctrl+V', 'native')
}

export async function selectLocator(tab: TabRuntime, locator: Locator, option: string, via: ActVia = 'cdp'): Promise<void> {
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const picked = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_SELECT, [option]))
    if (picked === 'selected') return
    if (picked === 'missing') throw new Error(`没有可选项「${option}」`)
  }
  await clickKnown(tab, target, via === 'inject' ? 'cdp' : via)
  await sleep(300)
  const { nodes } = await readTree(tab)
  const node = nodes.find((item) => ['option', 'menuitem', 'listitem', 'treeitem'].includes(item.role) && item.name === option)
    ?? nodes.find((item) => item.name === option)
  if (!node) throw new Error(`没有可选项「${option}」`)
  await clickKnown(tab, { role: node.role, name: node.name, backendNodeId: node.backendNodeId }, via === 'inject' ? 'cdp' : via)
}

async function matchCount(tab: TabRuntime, locator: Locator): Promise<number> {
  return withDebugger(wcOf(tab), async (dbg) => (await collectMatches(dbg, locator)).total)
}

export async function locatorSeen(tab: TabRuntime, locator: Locator, timeoutMs = 3_000): Promise<boolean> {
  const started = Date.now()
  const limit = Math.max(0, timeoutMs)
  for (;;) {
    try {
      if (await matchCount(tab, locator) >= 1) return true
    } catch {
      /* page still loading, or the node is not in the document yet */
    }
    if (Date.now() - started >= limit) return false
    await sleep(250)
  }
}

export async function waitForLocator(tab: TabRuntime, locator: Locator, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if (await matchCount(tab, locator) >= 1) return
    } catch {
      /* page still loading, or the node is not in the document yet */
    }
    await sleep(250)
  }
  await failWithScene(tab, locator, `超时还没出现 ${locatorLabel(locator)}`)
}

export async function waitForGone(tab: TabRuntime, locator: Locator, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await matchCount(tab, locator)) === 0) return
    } catch {
      /* page still loading */
    }
    await sleep(250)
  }
  throw new Error(`超时还没消失 ${locatorLabel(locator)}`)
}

export type ShotRef = { width: number; height: number; originX?: number; originY?: number; scale?: number }

export function mapPoint(tab: TabRuntime, x: number, y: number, shot?: ShotRef): { x: number; y: number } {
  const [viewW, viewH] = viewport(tab)
  let px = x
  let py = y
  if (shot) {
    if (shot.scale !== undefined && shot.originX !== undefined && shot.originY !== undefined) {
      if (!(shot.scale > 0)) throw new Error('截图比例要是正数')
      px = shot.originX + x / shot.scale
      py = shot.originY + y / shot.scale
    } else {
      if (!(shot.width > 0) || !(shot.height > 0)) throw new Error('截图宽高要是正数')
      px = x * viewW / shot.width
      py = y * viewH / shot.height
    }
  }
  if (px < 0 || py < 0 || px >= viewW || py >= viewH) throw new Error('这个坐标不在当前画面里')
  return { x: px, y: py }
}

export async function clickPoint(tab: TabRuntime, x: number, y: number, via: ActVia = 'cdp', shot?: ShotRef, button: 'left' | 'right' = 'left'): Promise<void> {
  const point = mapPoint(tab, x, y, shot)
  if (via === 'inject') {
    const source = button === 'right'
      ? `(() => {
      const x = ${point.x}
      const y = ${point.y}
      const el = document.elementFromPoint(x, y)
      if (!(el instanceof Element)) return false
      const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 }
      el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerType: 'mouse' }))
      el.dispatchEvent(new MouseEvent('mousedown', common))
      el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0, pointerType: 'mouse' }))
      el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('contextmenu', common))
      return true
    })()`
      : `(() => {
      const x = ${point.x}
      const y = ${point.y}
      const el = document.elementFromPoint(x, y)
      if (!(el instanceof Element)) return false
      const view = document.defaultView
      const down = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0, buttons: 1 }
      el.dispatchEvent(new PointerEvent('pointerdown', down))
      el.dispatchEvent(new MouseEvent('mousedown', down))
      const up = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0, buttons: 0 }
      el.dispatchEvent(new PointerEvent('pointerup', up))
      el.dispatchEvent(new MouseEvent('mouseup', up))
      el.dispatchEvent(new MouseEvent('click', up))
      return true
    })()`
    const clicked = await evalSource(tab, source)
    if (clicked !== true) throw new Error('这个坐标上没有元素')
    return
  }
  if (via === 'cdp') await clickAtCdp(tab, point.x, point.y, button)
  else await clickAt(tab, point.x, point.y, button)
}

export async function clickAt(tab: TabRuntime, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const wc = wcOf(tab)
  const ix = Math.round(x)
  const iy = Math.round(y)
  wc.sendInputEvent({ type: 'mouseMove', x: ix, y: iy })
  await sleep(30)
  wc.sendInputEvent({ type: 'mouseDown', x: ix, y: iy, button, clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: ix, y: iy, button, clickCount: 1 })
}

async function clickAtCdp(tab: TabRuntime, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const ix = Math.round(x)
  const iy = Math.round(y)
  const buttons = button === 'right' ? 2 : 1
  await withDebugger(wcOf(tab), async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ix, y: iy, button: 'none', buttons: 0, pointerType: 'mouse' })
    await sleep(30)
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: ix, y: iy, button, buttons, clickCount: 1, pointerType: 'mouse' })
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ix, y: iy, button, buttons: 0, clickCount: 1, pointerType: 'mouse' })
  })
}

const BRING_INTO_VIEW = `function () {
  if (this && this.scrollIntoView) this.scrollIntoView({ block: 'center', inline: 'nearest' })
}`

async function scrollNodeIntoView(dbg: Electron.Debugger, backendNodeId: number): Promise<void> {
  await dbg.sendCommand('DOM.getDocument', { depth: 0 })
  const pushed = (await dbg.sendCommand('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] }).catch(() => undefined)) as { nodeIds?: number[] } | undefined
  const nodeId = pushed?.nodeIds?.[0]
  if (!nodeId) return
  await dbg.sendCommand('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => undefined)
}

async function pointForClick(dbg: Electron.Debugger, tab: TabRuntime, backendNodeId: number): Promise<{ x: number; y: number } | undefined> {
  let point = await pointOnNode(dbg, tab, backendNodeId)
  if (point) return point
  await scrollNodeIntoView(dbg, backendNodeId)
  await sleep(80)
  point = await pointOnNode(dbg, tab, backendNodeId)
  if (point) return point
  await callOnBackend(dbg, backendNodeId, BRING_INTO_VIEW).catch(() => undefined)
  await sleep(80)
  return pointOnNode(dbg, tab, backendNodeId)
}

async function clickKnown(tab: TabRuntime, target: AxRef, via: ActVia, button: 'left' | 'right' = 'left'): Promise<void> {
  const wc = wcOf(tab)
  if (via === 'inject') {
    const clicked = await withDebugger(wc, async (dbg) => {
      const backendNodeId = await backendFor(dbg, target)
      await scrollNodeIntoView(dbg, backendNodeId)
      if (button === 'right') return callOnBackend(dbg, backendNodeId, INJECT_CONTEXT_MENU)
      return callOnBackend(dbg, backendNodeId, INJECT_CLICK)
    })
    if (clicked !== true) throw new Error(`点不到「${target.name || target.role}」`)
    return
  }
  const point = await withDebugger(wc, async (dbg) => {
    const backendNodeId = await backendFor(dbg, target)
    return pointForClick(dbg, tab, backendNodeId)
  })
  if (!point) throw new Error(`点不到「${target.name || target.role}」，这个位置被挡住了`)
  if (via === 'cdp') await clickAtCdp(tab, point.x, point.y, button)
  else await clickAt(tab, point.x, point.y, button)
}

async function backendFor(dbg: Electron.Debugger, target: AxRef): Promise<number> {
  await dbg.sendCommand('DOM.getDocument', { depth: 0 })
  if (!target.backendNodeId) throw new Error(`页面上还没有「${target.name || target.role}」`)
  return target.backendNodeId
}

async function callOnBackend(dbg: Electron.Debugger, backendNodeId: number, source: string, args: unknown[] = [], sessionId?: string): Promise<unknown> {
  const resolved = (await dbg.sendCommand('DOM.resolveNode', { backendNodeId }, sessionId)) as { object: { objectId: string } }
  try {
    const called = (await dbg.sendCommand('Runtime.callFunctionOn', {
      objectId: resolved.object.objectId,
      functionDeclaration: source,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
      silent: true
    }, sessionId)) as { result?: { value?: unknown } }
    return called.result?.value
  } finally {
    await dbg.sendCommand('Runtime.releaseObject', { objectId: resolved.object.objectId }, sessionId).catch(() => undefined)
  }
}

const INJECT_CLICK = `function () {
  const el = this
  if (!(el instanceof Element)) return false
  const rect = el.getBoundingClientRect()
  if (rect.width >= 1 && rect.height >= 1) {
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const doc = el.ownerDocument
    const hit = doc.elementFromPoint(x, y)
    const target = hit instanceof Element && (hit === el || el.contains(hit)) ? hit : el
    const pointer = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse' }
    const mouse = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }
    target.dispatchEvent(new PointerEvent('pointerover', pointer))
    target.dispatchEvent(new PointerEvent('pointerenter', Object.assign({}, pointer, { bubbles: false })))
    target.dispatchEvent(new MouseEvent('mouseover', mouse))
    target.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, mouse, { bubbles: false })))
    target.dispatchEvent(new PointerEvent('pointerdown', pointer))
    target.dispatchEvent(new MouseEvent('mousedown', mouse))
    if (typeof el.focus === 'function') el.focus({ preventScroll: true })
    target.dispatchEvent(new PointerEvent('pointerup', pointer))
    target.dispatchEvent(new MouseEvent('mouseup', mouse))
    if (typeof target.click === 'function') target.click()
    return true
  }
  if (typeof el.focus === 'function') el.focus({ preventScroll: true })
  if (typeof el.click === 'function') { el.click(); return true }
  return false
}`

const INJECT_CONTEXT_MENU = `function () {
  const el = this
  if (!(el instanceof Element)) return false
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerType: 'mouse' }))
  el.dispatchEvent(new MouseEvent('mousedown', common))
  el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0, pointerType: 'mouse' }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('contextmenu', common))
  return true
}`

const INJECT_TEXT = `function (text, x, y) {
  let el = this
  for (let depth = 0; el instanceof HTMLIFrameElement && el.contentDocument && depth < 4; depth += 1) {
    const rect = el.getBoundingClientRect()
    const ix = typeof x === 'number' ? x - rect.left : rect.width / 2
    const iy = typeof y === 'number' ? y - rect.top : rect.height / 2
    const inner = el.contentDocument.elementFromPoint(ix, iy) || el.contentDocument.body
    if (!inner) break
    el = inner
    x = ix
    y = iy
  }
  while (el && el !== el.ownerDocument.body) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) break
    el = el.parentElement
  }
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el && el.isContentEditable)) return false
  if (typeof el.focus === 'function') el.focus({ preventScroll: true })
  if (el.isContentEditable && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    const view = el.ownerDocument.defaultView
    const host = view && view.parent && view.parent.CKEDITOR ? view.parent : view
    const instances = host && host.CKEDITOR && host.CKEDITOR.instances
    const editor = instances && (instances.editor || Object.values(instances)[0])
    if (editor && typeof editor.setData === 'function') {
      const html = String(text).split('\\n').map((line) => '<p>' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join('')
      return new Promise((resolve) => editor.setData(html, () => resolve(true)))
    }
    const doc = el.ownerDocument
    const selection = doc.getSelection()
    const range = doc.createRange()
    range.selectNodeContents(el)
    selection?.removeAllRanges()
    selection?.addRange(range)
    doc.execCommand('selectAll', false)
    doc.execCommand('insertText', false, text)
    if ((el.innerText || '').trim() !== String(text).trim()) el.innerText = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')
  if (setter && setter.set) setter.set.call(el, text)
  else el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}`

const INJECT_SELECT = `function (optionText) {
  if (!(this instanceof HTMLSelectElement)) return 'open'
  const wanted = String(optionText).trim()
  const option = Array.from(this.options).find((item) => (item.textContent || '').trim() === wanted || item.value === wanted)
  if (!option) return 'missing'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  if (setter && setter.set) setter.set.call(this, option.value)
  else this.value = option.value
  this.dispatchEvent(new Event('input', { bubbles: true }))
  this.dispatchEvent(new Event('change', { bubbles: true }))
  return 'selected'
}`

let sendingToPage = 0
export function isSendingToPage(): boolean {
  return sendingToPage > 0
}

export function parseShortcut(shortcut: string): { key: string; modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> } {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean)
  const modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> = []
  let key = parts[parts.length - 1] ?? ''
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') modifiers.push('control')
    else if (lower === 'shift') modifiers.push('shift')
    else if (lower === 'alt') modifiers.push('alt')
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.push('meta')
    else throw new Error(`不认识修饰键 ${part}，支持 ctrl、shift、alt、meta，快捷键用 + 连接，比如 ctrl+a`)
  }
  if (!key) throw new Error('快捷键要有主键，比如 ctrl+a 里的 a')
  const named: Record<string, string> = {
    enter: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space'
  }
  key = named[key.toLowerCase()] ?? key
  return { key, modifiers }
}

export async function pressShortcut(tab: TabRuntime, shortcut: string, via: GestureVia = 'cdp'): Promise<void> {
  const wc = wcOf(tab)
  const { key, modifiers } = parseShortcut(shortcut)
  sendingToPage += 1
  try {
    if (via === 'native') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
      return
    }
    const bits = modifierBits(modifiers)
    const spec = keyEventOf(key)
    await withDebugger(wc, async (dbg) => {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        modifiers: bits,
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.vk,
        nativeVirtualKeyCode: spec.vk
      })
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: bits,
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.vk,
        nativeVirtualKeyCode: spec.vk
      })
    })
  } finally {
    sendingToPage -= 1
  }
}

function modifierBits(modifiers: Array<'shift' | 'control' | 'alt' | 'meta'>): number {
  let bits = 0
  if (modifiers.includes('alt')) bits |= 1
  if (modifiers.includes('control')) bits |= 2
  if (modifiers.includes('meta')) bits |= 4
  if (modifiers.includes('shift')) bits |= 8
  return bits
}

function keyEventOf(key: string): { key: string; code: string; vk: number } {
  const named: Record<string, { key: string; code: string; vk: number }> = {
    Return: { key: 'Enter', code: 'Enter', vk: 13 },
    Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    Tab: { key: 'Tab', code: 'Tab', vk: 9 },
    Space: { key: ' ', code: 'Space', vk: 32 },
    Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
    Delete: { key: 'Delete', code: 'Delete', vk: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 }
  }
  if (named[key]) return named[key]
  const letter = keySpec(key)
  if (letter) return { key: letter.key, code: letter.code, vk: letter.vk }
  return { key, code: key, vk: 0 }
}

type TypeStep =
  | { kind: 'text'; text: string }
  | { kind: 'key'; ch: string; spec: NonNullable<ReturnType<typeof keySpec>> }

function typeSteps(text: string): TypeStep[] {
  const steps: TypeStep[] = []
  let plain = ''
  const flush = (): void => {
    if (!plain) return
    steps.push({ kind: 'text', text: plain })
    plain = ''
  }
  for (const ch of text) {
    const spec = keySpec(ch)
    if (!spec) {
      plain += ch
      continue
    }
    flush()
    steps.push({ kind: 'key', ch, spec })
  }
  flush()
  return steps
}

async function typeStep(dbg: Electron.Debugger, step: TypeStep): Promise<void> {
  if (step.kind === 'text') {
    await dbg.sendCommand('Input.insertText', { text: step.text })
    return
  }
  const { ch, spec } = step
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: spec.modifiers,
    key: spec.key,
    code: spec.code,
    text: ch,
    unmodifiedText: spec.unmodified,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk
  })
  await dbg.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: spec.modifiers,
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk
  })
}

async function typeStepsFrom(dbg: Electron.Debugger, steps: TypeStep[], index: number): Promise<void> {
  const step = steps[index]
  if (!step) return
  await typeStep(dbg, step)
  await typeStepsFrom(dbg, steps, index + 1)
}

async function typeByCdp(tab: TabRuntime, text: string): Promise<void> {
  const steps = typeSteps(text)
  await withDebugger(wcOf(tab), (dbg) => typeStepsFrom(dbg, steps, 0))
}

function keySpec(ch: string): { key: string; code: string; vk: number; modifiers: number; unmodified: string } | undefined {
  if (ch.length !== 1) return undefined
  if (ch >= 'a' && ch <= 'z') return { key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), modifiers: 0, unmodified: ch }
  if (ch >= 'A' && ch <= 'Z') return { key: ch, code: `Key${ch}`, vk: ch.charCodeAt(0), modifiers: 8, unmodified: ch.toLowerCase() }
  if (ch >= '0' && ch <= '9') return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), modifiers: 0, unmodified: ch }
  if (ch === ' ') return { key: ' ', code: 'Space', vk: 32, modifiers: 0, unmodified: ' ' }
  if (ch === '\n' || ch === '\r') return { key: 'Enter', code: 'Enter', vk: 13, modifiers: 0, unmodified: '\r' }
  return undefined
}

function viewport(tab: TabRuntime): [number, number] {
  const bounds = tab.view?.getBounds()
  return [bounds?.width || 800, bounds?.height || 600]
}

async function wheelAt(tab: TabRuntime, via: GestureVia, x: number, y: number, deltaDown: number): Promise<void> {
  const wc = wcOf(tab)
  const ix = Math.round(x)
  const iy = Math.round(y)
  const delta = Math.round(deltaDown)
  if (via === 'native') {
    wc.sendInputEvent({ type: 'mouseWheel', x: ix, y: iy, deltaX: 0, deltaY: -delta })
    return
  }
  await withDebugger(wc, async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: ix,
      y: iy,
      deltaX: 0,
      deltaY: delta,
      pointerType: 'mouse'
    })
  })
}

async function nodeBox(tab: TabRuntime, backendNodeId: number): Promise<{ left: number; top: number; right: number; bottom: number } | undefined> {
  const box = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, backendNodeId, NODE_BOX).catch(() => undefined)) as { left?: number; top?: number; right?: number; bottom?: number } | undefined
  if (typeof box?.left !== 'number' || typeof box.top !== 'number' || typeof box.right !== 'number' || typeof box.bottom !== 'number') return undefined
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
}

async function revealNode(tab: TabRuntime, backendNodeId: number): Promise<void> {
  await withDebugger(wcOf(tab), (dbg) => scrollNodeIntoView(dbg, backendNodeId))
}

function wheelPoint(tab: TabRuntime, box?: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
  const [width, height] = viewport(tab)
  if (!box) return { x: Math.round(width * 0.28), y: Math.round(height / 2) }
  const x = Math.min(width - 20, Math.max(20, (box.left + box.right) / 2))
  const y = box.top < 20 || box.bottom > height - 20 ? height / 2 : (box.top + box.bottom) / 2
  return { x: Math.round(x), y: Math.round(Math.min(height - 20, Math.max(20, y))) }
}

async function scrollUntil(tab: TabRuntime, direction: 'up' | 'down', via: GestureVia, until: Locator): Promise<void> {
  const rounds = 16
  for (let round = 0; round < rounds; round += 1) {
    try {
      if (await locatorInView(tab, until)) return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('匹配到')) await failWithScene(tab, until, message)
      throw error
    }
    let target: AxRef | undefined
    try {
      target = await resolveLocator(tab, until)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('匹配到')) await failWithScene(tab, until, message)
      target = undefined
    }
    if (!target?.backendNodeId) {
      const [width, height] = viewport(tab)
      await wheelAt(tab, via, Math.round(width * 0.28), Math.round(height / 2), direction === 'down' ? 480 : -480)
      await sleep(180)
      continue
    }
    await revealNode(tab, target.backendNodeId)
    await sleep(80)
    if (await locatorInView(tab, until)) return
    const box = await nodeBox(tab, target.backendNodeId)
    const [, height] = viewport(tab)
    let delta = direction === 'down' ? 360 : -360
    if (box) {
      if (box.bottom < 80) delta = -Math.min(720, Math.max(240, Math.round(80 - box.bottom)))
      else if (box.top > height - 40) delta = Math.min(720, Math.max(240, Math.round(box.top - height + 120)))
      else if (box.top < height * 0.28) delta = -240
      else delta = 240
    }
    const point = wheelPoint(tab, box)
    await wheelAt(tab, via, point.x, point.y, delta)
    await sleep(180)
  }
  if (await locatorInView(tab, until)) return
  await failWithScene(tab, until, `滚动后仍点不到 ${locatorLabel(until)}`)
}

export async function scrollPage(
  tab: TabRuntime,
  direction: 'up' | 'down',
  via: GestureVia = 'cdp',
  locator?: Locator,
  until?: Locator
): Promise<void> {
  if (until) {
    await scrollUntil(tab, direction, via, until)
    return
  }
  const [width, height] = viewport(tab)
  const point = locator ? await centerOf(tab, await resolveLocator(tab, locator)) : undefined
  await wheelAt(tab, via, point?.x ?? Math.round(width / 2), point?.y ?? Math.round(height / 2), direction === 'down' ? 240 : -240)
}

type TrackPoint = { x: number; y: number; delay: number }

function humanTrack(sx: number, sy: number, ex: number, ey: number): TrackPoint[] {
  const dist = Math.hypot(ex - sx, ey - sy)
  const steps = Math.max(8, Math.min(64, Math.round(dist / 6)))
  const ux = dist ? (ex - sx) / dist : 0
  const uy = dist ? (ey - sy) / dist : 0
  const px = -uy
  const py = ux
  const ease = (t: number): number => 1 - Math.pow(1 - t, 2.2)
  const overshoot = dist > 60 ? Math.min(6, dist * 0.03) : 0
  const points: TrackPoint[] = []
  let wobble = (Math.random() - 0.5) * 2
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const along = dist * ease(t) + (overshoot ? overshoot * Math.sin(t * Math.PI) : 0)
    wobble = Math.max(-2, Math.min(2, wobble + (Math.random() - 0.5) * 1.2))
    const off = wobble * Math.sin(t * Math.PI)
    points.push({
      x: Math.round((sx + ux * along + px * off) * 10) / 10,
      y: Math.round((sy + uy * along + py * off) * 10) / 10,
      delay: 8 + Math.random() * 14
    })
  }
  if (overshoot) {
    points.push({ x: ex + (Math.random() - 0.5), y: ey + (Math.random() - 0.5), delay: 60 + Math.random() * 80 })
  }
  points.push({ x: ex, y: ey, delay: 20 + Math.random() * 40 })
  return points
}

async function runTrack(tab: TabRuntime, via: GestureVia, sx: number, sy: number, track: TrackPoint[]): Promise<void> {
  const wc = wcOf(tab)
  const last = track[track.length - 1]
  if (via === 'native') {
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(sx), y: Math.round(sy), button: 'left', clickCount: 1 })
    let prevX = Math.round(sx)
    let prevY = Math.round(sy)
    for (const point of track) {
      const nx = Math.round(point.x)
      const ny = Math.round(point.y)
      wc.sendInputEvent({ type: 'mouseMove', x: nx, y: ny, button: 'left', movementX: nx - prevX, movementY: ny - prevY })
      prevX = nx
      prevY = ny
      await sleep(point.delay)
    }
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(last.x), y: Math.round(last.y), button: 'left', clickCount: 1 })
    return
  }
  await withDebugger(wc, async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
    for (const point of track) {
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1, pointerType: 'mouse' })
      await sleep(point.delay)
    }
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  })
}

async function swipeGesture(tab: TabRuntime, via: GestureVia, sx: number, sy: number, ex: number, ey: number): Promise<void> {
  await runTrack(tab, via, sx, sy, humanTrack(sx, sy, ex, ey))
}

export async function dragPage(
  tab: TabRuntime,
  via: GestureVia,
  start: { x: number; y: number },
  dx: number,
  dy: number
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const [width, height] = viewport(tab)
  if (start.x < 0 || start.y < 0 || start.x > width || start.y > height) {
    throw new Error(`起点 (${Math.round(start.x)}, ${Math.round(start.y)}) 不在视口 ${width}x${height} 里，先把目标滚进视口再拖`)
  }
  const clamp = (value: number, max: number): number => Math.max(1, Math.min(max - 1, Math.round(value)))
  const sx = Math.round(start.x)
  const sy = Math.round(start.y)
  const ex = clamp(start.x + dx, width)
  const ey = clamp(start.y + dy, height)
  await runTrack(tab, via, sx, sy, humanTrack(sx, sy, ex, ey))
  return { from: { x: sx, y: sy }, to: { x: ex, y: ey } }
}

export async function locatorCenter(tab: TabRuntime, locator: Locator): Promise<{ x: number; y: number }> {
  return centerOf(tab, await resolveLocator(tab, locator))
}

export async function swipePage(
  tab: TabRuntime,
  direction: 'up' | 'down' | 'left' | 'right',
  locator?: Locator,
  until?: Locator,
  via: GestureVia = 'cdp'
): Promise<void> {
  const once = async (): Promise<void> => {
    const [width, height] = viewport(tab)
    let bounds: { left: number; top: number; right: number; bottom: number } | undefined
    if (locator) {
      const raw = await quadBox(tab, await resolveLocator(tab, locator))
      const left = Math.max(raw.left, 1)
      const top = Math.max(raw.top, 1)
      const right = Math.min(raw.right, width - 1)
      const bottom = Math.min(raw.bottom, height - 1)
      if (right - left >= 16 && bottom - top >= 16) bounds = { left, top, right, bottom }
    }
    const inset = 12
    let sx = Math.round(width / 2)
    let sy = Math.round(height / 2)
    let ex = sx
    let ey = sy
    if (bounds) {
      sx = Math.round((bounds.left + bounds.right) / 2)
      sy = Math.round((bounds.top + bounds.bottom) / 2)
      const roomX = Math.max(24, (bounds.right - bounds.left) / 2 - inset)
      const roomY = Math.max(24, (bounds.bottom - bounds.top) / 2 - inset)
      ex = direction === 'left' ? Math.round(sx - roomX) : direction === 'right' ? Math.round(sx + roomX) : sx
      ey = direction === 'up' ? Math.round(sy - roomY) : direction === 'down' ? Math.round(sy + roomY) : sy
    } else {
      const clamp = (value: number, max: number): number => Math.max(inset, Math.min(max - inset, Math.round(value)))
      sx = clamp(sx, width)
      sy = clamp(sy, height)
      const distance = 280
      const dx = direction === 'left' ? -distance : direction === 'right' ? distance : 0
      const dy = direction === 'up' ? -distance : direction === 'down' ? distance : 0
      ex = clamp(sx + dx, width)
      ey = clamp(sy + dy, height)
    }
    await swipeGesture(tab, via, sx, sy, ex, ey)
  }
  if (!until) {
    await once()
    return
  }
  for (let i = 0; i < 20; i += 1) {
    if (await locatorInView(tab, until)) return
    await once()
    await sleep(200)
  }
  if (await locatorInView(tab, until)) return
  await failWithScene(tab, until, `滑动后仍没有 ${locatorLabel(until)}。翻长列表用滚动`)
}

async function locatorInView(tab: TabRuntime, locator: Locator): Promise<boolean> {
  try {
    const target = await resolveLocator(tab, locator)
    if (!target.backendNodeId) return false
    return await withDebugger(wcOf(tab), async (dbg) => Boolean(await pointOnNode(dbg, tab, target.backendNodeId ?? 0)))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('匹配到')) throw error
    return false
  }
}

export async function uploadFiles(tab: TabRuntime, paths: string[], knownBackend?: number): Promise<number | undefined> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 1 })) as { root: { nodeId: number } }
    let backendNodeId = knownBackend
    if (!backendNodeId) {
      const queried = (await dbg.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"]'
      })) as { nodeId: number }
      if (!queried.nodeId) throw new Error('页面上没有文件控件')
      const described = (await dbg.sendCommand('DOM.describeNode', { nodeId: queried.nodeId })) as {
        node: { backendNodeId: number }
      }
      backendNodeId = described.node.backendNodeId
    }
    await dbg.sendCommand('DOM.setFileInputFiles', { files: paths, backendNodeId })
    return backendNodeId
  })
}

export function waitForLoad(wc: WebContents, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!wc.isLoading()) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('加载超时'))
    }, timeoutMs)
    const done = (): void => {
      cleanup()
      resolve()
    }
    const fail = (_event: unknown, code: number, desc: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || code === -3) return
      cleanup()
      reject(new Error(desc || '加载失败'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-stop-loading', done)
      wc.removeListener('did-fail-load', fail)
    }
    wc.on('did-stop-loading', done)
    wc.on('did-fail-load', fail)
  })
}

function waitForNextLoad(wc: WebContents, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = wc.isLoading()
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('加载超时'))
    }, timeoutMs)
    const onStart = (): void => {
      started = true
    }
    const onStop = (): void => {
      if (!started) return
      cleanup()
      resolve()
    }
    const onFail = (_event: unknown, code: number, desc: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || code === -3) return
      if (!started) return
      cleanup()
      reject(new Error(desc || '加载失败'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-start-loading', onStart)
      wc.removeListener('did-stop-loading', onStop)
      wc.removeListener('did-fail-load', onFail)
    }
    wc.on('did-start-loading', onStart)
    wc.on('did-stop-loading', onStop)
    wc.on('did-fail-load', onFail)
  })
}

export function settleNavigation(tab: TabRuntime, quietMs = 500, timeoutMs = 15_000): Promise<void> {
  const wc = wcOf(tab)
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    const cap = setTimeout(finish, timeoutMs)
    const armQuiet = (): void => {
      if (quiet) clearTimeout(quiet)
      quiet = setTimeout(finish, quietMs)
    }
    const onStart = (): void => {
      if (quiet) clearTimeout(quiet)
      quiet = undefined
    }
    const onStop = (): void => {
      armQuiet()
    }
    function finish(): void {
      if (quiet) clearTimeout(quiet)
      clearTimeout(cap)
      wc.removeListener('did-start-loading', onStart)
      wc.removeListener('did-stop-loading', onStop)
      resolve()
    }
    wc.on('did-start-loading', onStart)
    wc.on('did-stop-loading', onStop)
    if (wc.isLoading()) onStart()
    else armQuiet()
  })
}

export async function navigate(tab: TabRuntime, url: string): Promise<void> {
  const wc = wcOf(tab)
  const target = normalizeUrl(url)
  const pending = waitForNextLoad(wc)
  await wc.loadURL(target).catch(() => undefined)
  await pending
}

export async function screenshot(tab: TabRuntime, dir: string): Promise<{ path: string; width: number; height: number }> {
  const wc = wcOf(tab)
  const reveal = (): void => {
    const runtime = windows.get(tab.envId)
    if (!runtime || runtime.headless) return
    if (runtime.win.isMinimized()) runtime.win.restore()
    runtime.win.show()
  }
  reveal()
  let image: Electron.NativeImage | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      image = await wc.capturePage()
      if (!image.isEmpty()) break
      image = undefined
    } catch (error) {
      lastError = error
      image = undefined
    }
    reveal()
    await sleep(250)
  }
  if (!image) {
    // 窗口被完全遮住时 capturePage 会一直失败，改走合成器截图
    try {
      image = await withDebugger(wc, async (dbg) => {
        const shot = (await dbg.sendCommand('Page.captureScreenshot', { format: 'png' })) as { data: string }
        return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
      })
      if (image.isEmpty()) image = undefined
    } catch (error) {
      lastError = error
      image = undefined
    }
  }
  if (!image) throw new Error(lastError instanceof Error ? lastError.message : '截不到当前网页')
  const size = image.getSize()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `shot-${Date.now()}.png`)
  writeFileSync(path, image.toPNG())
  return { path, width: size.width, height: size.height }
}

export async function pageSource(tab: TabRuntime, kind: 'dom' | 'response'): Promise<string> {
  if (kind === 'response') {
    if (!tab.documentHtml) throw new Error('这次导航没有留下原始 HTML')
    return tab.documentHtml
  }
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } }
    const html = (await dbg.sendCommand('DOM.getOuterHTML', { nodeId: doc.root.nodeId })) as { outerHTML: string }
    return html.outerHTML
  })
}

const documentRequests = new Map<number, string>()

export function watchDocument(wc: WebContents, onHtml: (html: string) => void): void {
  wc.on('did-start-navigation', (event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return
    void captureDocumentStart(wc)
  })
  wc.on('did-finish-load', () => {
    void captureDocumentFinish(wc, onHtml)
  })
}

async function captureDocumentStart(wc: WebContents): Promise<void> {
  try {
    const dbg = await acquireDebugger(wc)
    await dbg.sendCommand('Network.enable')
    const onMessage = (_event: unknown, method: string, params: { type?: string; requestId?: string }): void => {
      if (method === 'Network.responseReceived' && params.type === 'Document' && params.requestId) {
        documentRequests.set(wc.id, params.requestId)
      }
    }
    wc.debugger.on('message', onMessage)
    wc.once('did-finish-load', () => {
      wc.debugger.removeListener('message', onMessage)
    })
  } catch {
    /* snapshot can attach later */
  }
}

async function captureDocumentFinish(wc: WebContents, onHtml: (html: string) => void): Promise<void> {
  const requestId = documentRequests.get(wc.id)
  documentRequests.delete(wc.id)
  try {
    if (requestId && wc.debugger.isAttached()) {
      const body = (await wc.debugger.sendCommand('Network.getResponseBody', { requestId })) as { body: string; base64Encoded: boolean }
      const html = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
      onHtml(html)
    }
  } catch {
    /* body already gone */
  } finally {
    releaseDebugger(wc)
  }
}

export async function evalSource(tab: TabRuntime, source: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('页面脚本超时')), 120_000)
  })
  try {
    return await Promise.race([wcOf(tab).executeJavaScript(source, true), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function sendCdp(tab: TabRuntime, method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
  return withDebugger(wcOf(tab), (dbg) => dbg.sendCommand(method, params, sessionId))
}

export async function sendCdpBatch(
  tab: TabRuntime,
  commands: Array<{ method: string; params?: Record<string, unknown>; delayMs?: number }>
): Promise<unknown[]> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const results: unknown[] = []
    for (const command of commands) {
      results.push(await dbg.sendCommand(command.method, command.params))
      const delay = Math.min(Math.max(command.delayMs ?? 0, 0), 5_000)
      if (delay) await sleep(delay)
    }
    return results
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function noteNavigation(tab: TabRuntime, url: string): void {
  tab.url = url
  try {
    const host = new URL(url).hostname
    if (host) bridge.broadcast(tab.envId)
  } catch {
    /* data url */
  }
}

const CLASSIFY_JS = `function () {
  const el = this
  if (!(el instanceof Element)) return null
  const abs = (u) => { try { return new URL(u, location.href).href } catch (e) { return u || '' } }
  const r = el.getBoundingClientRect()
  const base = { tag: el.tagName, rect: { x: r.left, y: r.top, w: r.width, h: r.height } }
  const video = el.closest('video')
  if (video) {
    const src = video.currentSrc || video.src || ((video.querySelector('source') || {}).src) || ''
    return { ...base, kind: 'video', src: abs(src), poster: abs(video.poster || '') }
  }
  if (el.tagName === 'IMG') return { ...base, kind: 'image', src: abs(el.currentSrc || el.src || '') }
  if (el.tagName === 'CANVAS') return { ...base, kind: 'canvas' }
  if (el.tagName === 'AUDIO') {
    const src = el.currentSrc || el.src || ((el.querySelector('source') || {}).src) || ''
    return { ...base, kind: 'audio', src: abs(src) }
  }
  const a = el.closest('a[href]')
  if (a) return { ...base, kind: 'link', href: abs(a.href) }
  const bg = getComputedStyle(el).backgroundImage
  const m = bg && bg.match(/url\(["']?(.+?)["']?\)/)
  if (m) return { ...base, kind: 'image', src: abs(m[1]), via: 'background' }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return { ...base, kind: 'input' }
  return { ...base, kind: 'text', text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100) }
}`

export type ElementInfo = {
  kind: 'video' | 'image' | 'canvas' | 'audio' | 'link' | 'input' | 'text'
  tag: string
  src?: string
  poster?: string
  href?: string
  via?: string
  text?: string
  rect: { x: number; y: number; w: number; h: number }
}

export async function inspectElement(tab: TabRuntime, target: { locator?: Locator; point?: { x: number; y: number } }): Promise<ElementInfo> {
  if (target.locator) {
    const resolved = await resolveLocator(tab, target.locator)
    const info = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, resolved.backendNodeId ?? 0, CLASSIFY_JS))
    if (!info) throw new Error(`识别不了 ${locatorLabel(target.locator)}`)
    return info as ElementInfo
  }
  if (target.point) {
    const source = `(() => {
      const stack = []
      const seen = new Set()
      const deep = (root, depth) => {
        if (depth > 12 || seen.has(root)) return
        seen.add(root)
        for (const el of root.elementsFromPoint(${target.point.x}, ${target.point.y})) {
          stack.push(el)
          if (el.shadowRoot) deep(el.shadowRoot, depth + 1)
        }
      }
      deep(document, 0)
      let best = null
      let fallback = null
      for (const el of stack) {
        const info = (${CLASSIFY_JS}).call(el)
        if (!info) continue
        if (!fallback) fallback = info
        if (info.kind === 'video' || info.kind === 'image' || info.kind === 'canvas' || info.kind === 'audio') { best = info; break }
        if (info.kind === 'link' && !best) best = info
      }
      return best || fallback
    })()`
    const info = await evalSource(tab, source)
    if (!info) throw new Error(`(${target.point.x}, ${target.point.y}) 上没有元素`)
    return info as ElementInfo
  }
  throw new Error('需要定位或坐标')
}

function sniffExt(buf: Buffer): string {
  if (buf.length < 12) return ''
  const head = buf.subarray(0, 12).toString('latin1')
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (head.startsWith('GIF8')) return 'gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp'
  if (head.slice(4, 8) === 'ftyp') return 'mp4'
  if (head.startsWith('OggS')) return 'ogg'
  return ''
}

function extOf(url: string, contentType: string): string {
  const byType: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3'
  }
  for (const [type, ext] of Object.entries(byType)) {
    if (contentType.includes(type)) return ext
  }
  try {
    const ext = new URL(url).pathname.split('.').pop() || ''
    if (/^[a-z0-9]{2,5}$/i.test(ext)) return ext.toLowerCase()
  } catch {
    /* 不是合法 URL */
  }
  return 'bin'
}

async function downloadWithSession(tab: TabRuntime, url: string, referer?: string, onProgress?: (received: number, total: number) => void): Promise<{ buf: Buffer; contentType: string }> {
  return downloadUrl(wcOf(tab), url, referer, onProgress)
}

export async function downloadUrl(wc: WebContents, url: string, referer?: string, onProgress?: (received: number, total: number) => void): Promise<{ buf: Buffer; contentType: string }> {
  const ses = wc.session
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: ses })
    const ref = referer || wc.getURL()
    if (ref) req.setHeader('Referer', ref)
    const chunks: Buffer[] = []
    let contentType = ''
    req.on('response', (res) => {
      contentType = String(res.headers['content-type'] || '')
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(`下载失败 HTTP ${res.statusCode}`))
        return
      }
      const total = Number(res.headers['content-length'] || 0)
      let received = 0
      res.on('data', (chunk) => {
        chunks.push(chunk)
        received += chunk.length
        if (onProgress) onProgress(received, total)
      })
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType }))
    })
    req.on('error', reject)
    req.end()
  })
}

type StreamPair = { video: string; audio: string }

const BILIBILI_PLAYINFO = `(() => {
  const p = window.__playinfo__
  if (!p) return null
  const d = p.data || p
  const dash = d.dash
  if (!dash || !dash.video) return null
  const all = dash.video.slice()
  const avc = all.filter((v) => String(v.codecs || '').startsWith('avc'))
  const vids = (avc.length ? avc : all).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
  const auds = (dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
  const v = vids[0]
  const a = auds[0]
  if (!v || !v.baseUrl) return null
  return { video: v.baseUrl, audio: a ? a.baseUrl : '' }
})()`

async function bilibiliStreams(tab: TabRuntime): Promise<StreamPair | null> {
  const found = (await evalSource(tab, BILIBILI_PLAYINFO).catch(() => null)) as StreamPair | null
  return found && found.video ? found : null
}

function mergeTracks(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  const args = ['-y', '-i', videoPath]
  if (audioPath) args.push('-i', audioPath)
  args.push('-c', 'copy', outPath)
  return runFfmpeg(args)
}

const GENERIC_STREAMS = `(() => {
  const names = performance.getEntriesByType('resource').map((e) => e.name)
  const m3u8 = names.filter((u) => /\.m3u8(\?|$)/i.test(u))
  const mpd = names.filter((u) => /\.mpd(\?|$)/i.test(u))
  return { m3u8: m3u8[m3u8.length - 1] || '', mpd: mpd[mpd.length - 1] || '' }
})()`

export async function downloadMedia(tab: TabRuntime, url: string, path: string, referer?: string, onProgress?: (received: number, total?: number) => void): Promise<void> {
  try {
    const got = await downloadUrl(wcOf(tab), url, referer, onProgress)
    writeFileSync(path, got.buf)
  } catch {
    await fetchToFile(tab, url, path, onProgress)
  }
}

export async function saveMedia(tab: TabRuntime, target: { locator?: Locator; point?: { x: number; y: number } }, dir: string, savePath?: string): Promise<{ path: string; kind: string; bytes: number }> {
  const info = await inspectElement(tab, target)
  const name = (() => {
    if ((info.kind === 'video' || info.kind === 'audio') && tab.title) return `${tab.title.replace(/[\/:*?"<>|]/g, '_').slice(0, 60)}`
    try {
      if (info.src) {
        const base = decodeURIComponent(new URL(info.src).pathname.split('/').pop() || '')
        if (base && !/^[0-9a-f-]{20,}$/i.test(base.replace(/\.[a-z0-9]+$/i, ''))) return base
      }
    } catch { /* blob/data 地址 */ }
    if (tab.title) return `${tab.title.replace(/[\/:*?"<>|]/g, '_').slice(0, 60)}-${info.kind}`
    return `${info.kind}-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  })()
  const dlId = downloadBegin(name, info.src || '')
  try {
    const result = await saveMediaInfo(tab, info, dir, savePath, (received, total) => downloadProgress(dlId, received, total))
    downloadDone(dlId, result.path)
    return result
  } catch (error) {
    downloadFail(dlId, error instanceof Error ? error.message : String(error))
    throw error
  }
}

async function captureElementPng(tab: TabRuntime, rect: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 2 }
    })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  })
}

export async function saveMediaInfo(tab: TabRuntime, info: ElementInfo, dir: string, savePath: string | undefined, onProgress: (received: number, total?: number) => void): Promise<{ path: string; kind: string; bytes: number }> {
  mkdirSync(dir, { recursive: true })
  if (info.kind === 'canvas') {
    const source = info.rect
      ? `(() => { const el = document.elementFromPoint(${info.rect.x + info.rect.w / 2}, ${info.rect.y + info.rect.h / 2}); const c = el && el.closest ? el.closest('canvas') : null; return c ? c.toDataURL('image/png') : '' })()`
      : ''
    const dataUrl = (await evalSource(tab, source)) as string
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('画布导不出来（可能跨域污染）')
    const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    const path = savePath || join(dir, `canvas-${Date.now()}.png`)
    writeFileSync(path, buf)
    return { path, kind: 'canvas', bytes: buf.length }
  }
  if (info.kind !== 'image' && info.kind !== 'video' && info.kind !== 'audio') {
    throw new Error(info.kind === 'link' ? `这是链接不是媒体：${info.href}` : `这个元素是 ${info.kind}，没有可保存的媒体`)
  }
  let src = info.src || ''
  if (info.kind === 'video' && (!src || src.startsWith('blob:'))) {
    const streams = await bilibiliStreams(tab)
    if (streams) {
      const stamp = Date.now()
      const referer = tab.url || undefined
      const videoPath = join(dir, `video-${stamp}-v.m4s`)
      await downloadMedia(tab, streams.video, videoPath, referer, onProgress)
      let audioPath = ''
      if (streams.audio) {
        audioPath = join(dir, `video-${stamp}-a.m4s`)
        await downloadMedia(tab, streams.audio, audioPath, referer, onProgress)
      }
      const outPath = savePath || join(dir, `video-${stamp}.mp4`)
      try {
        await mergeTracks(videoPath, audioPath, outPath)
        const { unlinkSync, statSync } = await import('fs')
        unlinkSync(videoPath)
        if (audioPath) unlinkSync(audioPath)
        return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
      } catch {
        throw new Error(`没有 ffmpeg 合并音视频轨，两条轨已分别保存：${videoPath}${audioPath ? `、${audioPath}` : ''}`)
      }
    }
    const generic = (await evalSource(tab, GENERIC_STREAMS).catch(() => null)) as { m3u8?: string; mpd?: string } | null
    const manifest = generic?.m3u8 || generic?.mpd || ''
    if (manifest) {
      const stamp = Date.now()
      const outPath = savePath || join(dir, `video-${stamp}.mp4`)
      const referer = tab.url || ''
      const args = ['-y']
      if (referer) args.push('-headers', `Referer: ${referer}
`)
      args.push('-i', manifest, '-c', 'copy', outPath)
      await runFfmpeg(args, 10 * 60_000)
      const { statSync } = await import('fs')
      return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
    }
    if (!src) throw new Error('流媒体视频没有直链也没探到清单（m3u8/mpd）。用 page_record_video 录下正在播放的画面')
  }
  let buf: Buffer
  let contentType = ''
  if (src.startsWith('blob:')) {
    const base64 = (await evalSource(
      tab,
      `fetch(${JSON.stringify(src)}).then((r) => r.arrayBuffer()).then((b) => { const u = new Uint8Array(b); const parts = []; for (let i = 0; i < u.length; i += 32768) parts.push(String.fromCharCode.apply(null, u.subarray(i, i + 32768))); return btoa(parts.join('')) })`
    )) as string
    buf = Buffer.from(base64, 'base64')
  } else if (src.startsWith('data:')) {
    const comma = src.indexOf(',')
    contentType = src.slice(5, src.indexOf(';'))
    buf = Buffer.from(src.slice(comma + 1), 'base64')
  } else if (/^https?:/.test(src)) {
    if (/\.(m3u8|mpd)(\?|$)/i.test(src)) throw new Error('这是流媒体清单（m3u8/mpd），不是单个文件，下不了')
    try {
      const got = await downloadWithSession(tab, src, undefined, onProgress)
      buf = got.buf
      contentType = got.contentType
    } catch {
      try {
        const tmpPath = join(dir, `dl-${Date.now()}.part`)
        await fetchToFile(tab, src, tmpPath, onProgress)
        buf = readFileSync(tmpPath)
        unlinkSync(tmpPath)
      } catch (second) {
        if (info.kind === 'image') {
          // URL 失效或防盗链：直接截这个元素渲染出来的画面
          buf = await captureElementPng(tab, info.rect)
          contentType = 'image/png'
        } else {
          throw second
        }
      }
    }
  } else {
    throw new Error(`不认识这种地址：${src.slice(0, 60)}`)
  }
  const ext = sniffExt(buf) || extOf(src, contentType)
  const path = savePath || join(dir, `${info.kind}-${Date.now()}.${ext}`)
  writeFileSync(path, buf)
  return { path, kind: info.kind, bytes: buf.length }
}

export async function recordVideo(tab: TabRuntime, seconds: number, dir: string, savePath?: string): Promise<{ path: string; bytes: number; seconds: number }> {
  const runtime = windows.get(tab.envId)
  if (runtime && !runtime.headless) {
    if (runtime.win.isMinimized()) runtime.win.restore()
    runtime.win.setAlwaysOnTop(true)
    runtime.win.show()
    runtime.win.moveTop()
  }
  mkdirSync(dir, { recursive: true })
  const ms = Math.max(1, Math.min(3600, Math.round(seconds))) * 1000
  const armed = await evalSource(tab, `(() => {
    const v = document.querySelector('video')
    if (!v) return 'no video'
    const capture = v.captureStream || v.mozCaptureStream
    if (!capture) return 'no captureStream'
    window.__bpRec = { chunks: [], done: false, pending: 0 }
    const rec = new MediaRecorder(capture.call(v))
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      window.__bpRec.pending += 1
      const fr = new FileReader()
      fr.onload = () => { const t = String(fr.result); window.__bpRec.chunks.push(t.slice(t.indexOf(';base64,') + 8)); window.__bpRec.pending -= 1 }
      fr.readAsDataURL(e.data)
    }
    rec.onstop = () => {
      const waitFlush = () => { if (window.__bpRec.pending > 0) setTimeout(waitFlush, 100); else window.__bpRec.done = true }
      waitFlush()
    }
    v.muted = true
    v.play().catch(() => {})
    rec.start(500)
    setTimeout(() => { try { rec.stop() } catch (e) {} }, ${ms})
    return 'recording'
  })()`)
  if (armed !== 'recording') throw new Error(armed === 'no video' ? '页面上没有 video 元素' : '这个环境录不了（captureStream 或编码器不可用）')
  const path = savePath || join(dir, `record-${Date.now()}.webm`)
  writeFileSync(path, Buffer.alloc(0))
  const dlId = downloadBegin(`录制 ${tab.title || '视频'}`, tab.url)
  let bytes = 0
  try {
    bytes = await pullChunks(tab, '__bpRec', path, Date.now() + ms + 15_000, (received) => downloadProgress(dlId, received))
  } catch (error) {
    downloadFail(dlId, error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (runtime && !runtime.headless) runtime.win.setAlwaysOnTop(false)
  }
  downloadDone(dlId, path)
  if (bytes === 0) throw new Error('录出来是空的：视频可能没播起来')
  const { statSync } = await import('fs')
  return { path, bytes: statSync(path).size, seconds: Math.round(ms / 1000) }
}

async function pullChunks(tab: TabRuntime, key: string, path: string, deadlineMs: number, onProgress?: (received: number, total?: number) => void): Promise<number> {
  let bytes = 0
  for (;;) {
    await sleep(700)
    const pulled = (await evalSource(
      tab,
      `(() => { const r = window.${key} || { chunks: [], done: true }; const chunks = r.chunks; r.chunks = []; return { chunks, done: r.done, error: r.error || '' } })()`
    ).catch(() => ({ chunks: [] as string[], done: true, error: '页面连接断开' }))) as { chunks: string[]; done: boolean; error: string }
    for (const chunk of pulled.chunks) {
      const buf = Buffer.from(chunk, 'base64')
      appendFileSync(path, buf)
      bytes += buf.length
    }
    if (onProgress) onProgress(bytes)
    if (pulled.done) {
      if (pulled.error) throw new Error(pulled.error)
      return bytes
    }
    if (Date.now() > deadlineMs) throw new Error('拉取超时，页面可能被关了')
  }
}

export async function fetchToFile(tab: TabRuntime, url: string, path: string, onProgress?: (received: number, total?: number) => void): Promise<number> {
  const armed = await evalSource(tab, `(async () => {
    window.__bpDl = { chunks: [], done: false, error: '' }
    const toB64 = (buf) => { const u = new Uint8Array(buf); const parts = []; for (let i = 0; i < u.length; i += 32768) parts.push(String.fromCharCode.apply(null, u.subarray(i, i + 32768))); return btoa(parts.join('')) }
    try {
      const res = await fetch(${JSON.stringify(url)})
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        window.__bpDl.chunks.push(toB64(value))
      }
      window.__bpDl.done = true
    } catch (e) {
      window.__bpDl.error = String(e && e.message || e)
      window.__bpDl.done = true
    }
    return 'started'
  })()`)
  if (armed !== 'started') throw new Error('页面下载起不来')
  return pullChunks(tab, '__bpDl', path, Date.now() + 10 * 60_000, onProgress)
}

function shapePoints(shape: string, x: number, y: number, w: number, h: number, n = 48): Array<{ x: number; y: number }> {
  const cx = x + w / 2
  const cy = y + h / 2
  const points: Array<{ x: number; y: number }> = []
  if (shape === 'circle') {
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2
      points.push({ x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) })
    }
    return points
  }
  if (shape === 'rect') {
    return [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }
    ]
  }
  if (shape === 'triangle') {
    return [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: cx, y }]
  }
  if (shape === 'star') {
    const ro = Math.min(w, h) / 2
    const ri = ro * 0.42
    for (let i = 0; i <= 10; i += 1) {
      const t = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? ro : ri
      points.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) })
    }
    return points
  }
  if (shape === 'heart') {
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2
      const hx = 16 * Math.pow(Math.sin(t), 3)
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      points.push({ x: cx + (hx / 16) * (w / 2) * 0.9, y: cy - (hy / 16) * (h / 2) * 0.9 })
    }
    return points
  }
  throw new Error(`不认识图形 ${shape}，支持 circle、rect、triangle、heart、star`)
}

function smoothPath(points: Array<{ x: number; y: number }>, close: boolean): Array<{ x: number; y: number }> {
  // Catmull-Rom 样条：穿过所有控制点的平滑曲线
  const out: Array<{ x: number; y: number }> = []
  const pts = close ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]]
  for (let i = 1; i < pts.length - 2; i += 1) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2]
    const seg = Math.max(4, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 10))
    for (let j = 0; j < seg; j += 1) {
      const t = j / seg
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3)
      })
    }
  }
  out.push(points[points.length - 1])
  return out
}

export async function drawPath(tab: TabRuntime, via: GestureVia, points: Array<{ x: number; y: number }>, close = false, smooth = false): Promise<{ points: number }> {
  if (smooth && points.length >= 3) points = smoothPath(points, close)
  if (points.length < 2) throw new Error('路径至少要两个点')
  const [width, height] = viewport(tab)
  for (const p of points) {
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) throw new Error(`点 (${Math.round(p.x)}, ${Math.round(p.y)}) 不在视口 ${width}x${height} 里`)
  }
  const track: TrackPoint[] = []
  let prev = points[0]
  for (const p of points.slice(1)) {
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y)
    const steps = Math.max(1, Math.round(seg / 14))
    for (let i = 1; i <= steps; i += 1) {
      track.push({
        x: prev.x + ((p.x - prev.x) * i) / steps + (Math.random() - 0.5) * 1.2,
        y: prev.y + ((p.y - prev.y) * i) / steps + (Math.random() - 0.5) * 1.2,
        delay: 8 + Math.random() * 12
      })
    }
    prev = p
  }
  if (close) track.push({ x: points[0].x, y: points[0].y, delay: 30 })
  await runTrack(tab, via, points[0].x, points[0].y, track)
  return { points: points.length }
}

export function drawShapePoints(shape: string, x: number, y: number, w: number, h: number): Array<{ x: number; y: number }> {
  return shapePoints(shape, x, y, w, h)
}

type SvgPoint = { x: number; y: number }

function cubicAt(p0: SvgPoint, c1: SvgPoint, c2: SvgPoint, p1: SvgPoint, t: number): SvgPoint {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y
  }
}

function quadAt(p0: SvgPoint, c: SvgPoint, p1: SvgPoint, t: number): SvgPoint {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y }
}

export function parseSvgPath(d: string): SvgPoint[][] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZzAa]|-?\d*\.?\d+(?:e-?\d+)?/g) || []
  const subpaths: SvgPoint[][] = []
  let cur: SvgPoint[] = []
  let pos: SvgPoint = { x: 0, y: 0 }
  let start: SvgPoint = { x: 0, y: 0 }
  let prevCtrl: SvgPoint | null = null
  let i = 0
  let cmd = ''
  const num = (): number => Number(tokens[i++])
  const push = (p: SvgPoint): void => { cur.push(p); pos = p }
  const flush = (): void => { if (cur.length) { subpaths.push(cur); cur = [] } }
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i += 1 } else if (cmd === '') { throw new Error('路径数据要以命令开头') }
    const rel = cmd !== cmd.toUpperCase()
    const at = (): SvgPoint => (rel ? { x: pos.x, y: pos.y } : { x: 0, y: 0 })
    if (cmd === 'M' || cmd === 'm') {
      flush()
      const o = at()
      const p = { x: num() + o.x, y: num() + o.y }
      cur = [p]; pos = p; start = p
      cmd = rel ? 'l' : 'L'
    } else if (cmd === 'L' || cmd === 'l') {
      const o = at(); push({ x: num() + o.x, y: num() + o.y })
    } else if (cmd === 'H' || cmd === 'h') {
      const o = at(); push({ x: num() + o.x, y: pos.y })
    } else if (cmd === 'V' || cmd === 'v') {
      const o = at(); push({ x: pos.x, y: num() + o.y })
    } else if (cmd === 'C' || cmd === 'c') {
      const o = at()
      const c1 = { x: num() + o.x, y: num() + o.y }
      const c2 = { x: num() + o.x, y: num() + o.y }
      const p1 = { x: num() + o.x, y: num() + o.y }
      for (let k = 1; k <= 24; k += 1) push(cubicAt(pos, c1, c2, p1, k / 24))
      prevCtrl = c2
      pos = p1
      continue
    } else if (cmd === 'S' || cmd === 's') {
      const o = at()
      const c1 = prevCtrl ? { x: pos.x * 2 - prevCtrl.x, y: pos.y * 2 - prevCtrl.y } : { ...pos }
      const c2 = { x: num() + o.x, y: num() + o.y }
      const p1 = { x: num() + o.x, y: num() + o.y }
      for (let k = 1; k <= 24; k += 1) push(cubicAt(pos, c1, c2, p1, k / 24))
      prevCtrl = c2
      pos = p1
      continue
    } else if (cmd === 'Q' || cmd === 'q') {
      const o = at()
      const cq = { x: num() + o.x, y: num() + o.y }
      const p1 = { x: num() + o.x, y: num() + o.y }
      for (let k = 1; k <= 24; k += 1) push(quadAt(pos, cq, p1, k / 24))
      prevCtrl = cq
      pos = p1
      continue
    } else if (cmd === 'T' || cmd === 't') {
      const o = at()
      const c: SvgPoint = prevCtrl ? { x: pos.x * 2 - prevCtrl.x, y: pos.y * 2 - prevCtrl.y } : { ...pos }
      const p1 = { x: num() + o.x, y: num() + o.y }
      for (let k = 1; k <= 24; k += 1) push(quadAt(pos, c, p1, k / 24))
      prevCtrl = c
      pos = p1
      continue
    } else if (cmd === 'A' || cmd === 'a') {
      // 椭圆弧：取 rx, ry, xAxisRotation, largeArc, sweep, x, y，采样成折线
      const rx = num(); const ry = num(); const rot = (num() * Math.PI) / 180
      const largeArc = num(); const sweep = num()
      const o = at(); const p1 = { x: num() + o.x, y: num() + o.y }
      const pts = arcPoints(pos, rx, ry, rot, largeArc, sweep, p1)
      for (const pt of pts) push(pt)
      prevCtrl = null
      pos = p1
      continue
    } else if (cmd === 'Z' || cmd === 'z') {
      push({ ...start })
      flush()
      pos = { ...start }
    }
    if (cmd !== 'S' && cmd !== 's' && cmd !== 'C' && cmd !== 'c' && cmd !== 'Q' && cmd !== 'q' && cmd !== 'T' && cmd !== 't') prevCtrl = null
    if (i >= tokens.length) break
  }
  flush()
  return subpaths
}

function arcPoints(p0: SvgPoint, rx: number, ry: number, rot: number, largeArc: number, sweep: number, p1: SvgPoint): SvgPoint[] {
  if (rx === 0 || ry === 0) return [p1]
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1p = cosR * dx + sinR * dy
  const y1p = -sinR * dx + cosR * dy
  let rxs = Math.abs(rx)
  let rys = Math.abs(ry)
  const lambda = (x1p * x1p) / (rxs * rxs) + (y1p * y1p) / (rys * rys)
  if (lambda > 1) { const s = Math.sqrt(lambda); rxs *= s; rys *= s }
  const sign = largeArc !== sweep ? 1 : -1
  const num = rxs * rxs * rys * rys - rxs * rxs * y1p * y1p - rys * rys * x1p * x1p
  const den = rxs * rxs * y1p * y1p + rys * rys * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rxs * y1p) / rys
  const cyp = (-co * rys * x1p) / rxs
  const cx = cosR * cxp - sinR * cyp + (p0.x + p1.x) / 2
  const cy = sinR * cxp + cosR * cyp + (p0.y + p1.y) / 2
  const angleOf = (x: number, y: number): number => Math.atan2((-sinR * x + cosR * y) / rys, (cosR * x + sinR * y) / rxs)
  const th1 = angleOf(p0.x - cx, p0.y - cy)
  let dth = angleOf(p1.x - cx, p1.y - cy) - th1
  if (!sweep && dth > 0) dth -= Math.PI * 2
  if (sweep && dth < 0) dth += Math.PI * 2
  const steps = Math.max(4, Math.round(Math.abs(dth) / (Math.PI / 16)))
  const out: SvgPoint[] = []
  for (let k = 1; k <= steps; k += 1) {
    const th = th1 + (dth * k) / steps
    out.push({
      x: cx + rxs * Math.cos(th) * cosR - rys * Math.sin(th) * sinR,
      y: cy + rxs * Math.cos(th) * sinR + rys * Math.sin(th) * cosR
    })
  }
  return out
}

export async function drawPaths(tab: TabRuntime, via: GestureVia, subpaths: SvgPoint[][]): Promise<{ paths: number; points: number }> {
  let total = 0
  for (const points of subpaths) {
    if (points.length < 2) continue
    await drawPath(tab, via, points)
    total += points.length
    await sleep(80)
  }
  return { paths: subpaths.length, points: total }
}

export function svgPathToPoints(d: string, box: { x: number; y: number; width: number; height: number }, viewBox?: [number, number]): SvgPoint[][] {
  const subpaths = parseSvgPath(d)
  const vb = viewBox ?? (() => {
    let maxX = 1
    let maxY = 1
    for (const sub of subpaths) for (const p of sub) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y }
    return [maxX, maxY] as [number, number]
  })()
  return subpaths.map((sub) => sub.map((p) => ({ x: box.x + (p.x / vb[0]) * box.width, y: box.y + (p.y / vb[1]) * box.height })))
}
