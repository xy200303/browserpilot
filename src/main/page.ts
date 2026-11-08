import { clipboard, nativeImage, net, type WebContents } from 'electron'
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { searchEngineOf, type ActVia, type GestureVia, type Locator } from '@shared/types'
import { storage } from './services/store'
import { downloadBegin, downloadDone, downloadFail, downloadProgress } from './services/DownloadService'
import { acquireDebugger, releaseDebugger, withDebugger } from './services/debugger'
export { saveMedia, saveMediaInfo } from './media'
import type { AxRef, TabRuntime } from './runtime'
import { bridge, windows } from './runtime'
import { renderGrid } from './grid'
import { mt } from './i18n'

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
  // view 在但 webContents 没了也会出现：休眠、渲染进程崩溃、视图创建到一半失败
  const current = tab.view?.webContents
  if (!current || current.isDestroyed()) {
    if (bridge.restoreTabView(tab) && tab.view?.webContents && !tab.view.webContents.isDestroyed()) {
      tab.hibernated = false
      tab.lastActiveAt = Date.now()
      return tab.view.webContents
    }
    throw new Error(tab.view || !tab.hibernated ? mt('main.page.crashed') : mt('main.page.noPage'))
  }
  if (tab.hibernated) tab.hibernated = false
  // 任何走 CDP 的工具调用都算「刚用过」，闲时回收不会把正在跑的标签睡掉
  tab.lastActiveAt = Date.now()
  return current
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
    const bits = [`[${ref}] ${node.role}`]
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
    if (!backendNodeId) throw new Error(mt('main.page.notOnPage', { name: target.name || target.role }))
    const quads = await viewportQuads(dbg, backendNodeId)
    const quad = quads[0]
    if (!quad) throw new Error(mt('main.page.notOnPage', { name: target.name || target.role }))
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
  if (locator.role && locator.name) return `${locator.role}「${locator.name}」`
  if (locator.role) return locator.role
  if (locator.text) return mt('main.page.textLabel', { text: locator.text })
  return mt('main.page.noLocatorLabel')
}

export function isQueryLocator(locator: Locator): boolean {
  return Boolean(locator.xpath || locator.selector || locator.text || locator.role)
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

type FlatAxNode = {
  nodeId: string
  parentId?: string
  role?: { value?: string }
  name?: { value?: string }
  ignored?: boolean
  backendDOMNodeId?: number
}

const CLICKABLE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox',
  'radio', 'switch', 'option', 'treeitem', 'combobox', 'textbox', 'searchbox'
])

/**
 * 按可访问名称 / 角色在无障碍树里找。按文字点的常常命中 StaticText，
 * 这里往上找最近的可点击祖先，和人在页面上点文字的行为一致。
 */
async function collectAxMatches(dbg: Electron.Debugger, locator: Locator): Promise<{ total: number; backendNodeIds: number[] }> {
  await dbg.sendCommand('DOM.getDocument', { depth: 0 })
  const tree = (await dbg.sendCommand('Accessibility.getFullAXTree')) as { nodes?: FlatAxNode[] }
  const nodes = tree.nodes ?? []
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const norm = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const hit = (value: string, want: string, mode: 'exact' | 'contains' | undefined): boolean =>
    mode === 'exact' ? value === want : value.includes(want)
  const roleWant = (locator.role || '').trim().toLowerCase()
  const textWant = locator.text ? norm(locator.text) : ''
  const nameWant = locator.name ? norm(locator.name) : ''
  const picked: number[] = []
  for (const node of nodes) {
    if (node.ignored) continue
    const role = (node.role?.value || '').toLowerCase()
    const name = norm(node.name?.value || '')
    if (roleWant && role !== roleWant) continue
    if (textWant && !hit(name, textWant, locator.textMatch)) continue
    if (nameWant && !hit(name, nameWant, locator.nameMatch)) continue
    let target: FlatAxNode | undefined = node
    if (!roleWant && textWant) {
      for (let depth = 0; depth < 6 && target; depth += 1) {
        if (CLICKABLE_ROLES.has((target.role?.value || '').toLowerCase())) break
        target = target.parentId ? byId.get(target.parentId) : undefined
      }
    }
    if (target?.backendDOMNodeId) picked.push(target.backendDOMNodeId)
  }
  const unique = [...new Set(picked)]
  return { total: unique.length, backendNodeIds: unique.slice(0, MATCH_CAP) }
}

async function collectMatches(dbg: Electron.Debugger, locator: Locator): Promise<{ total: number; backendNodeIds: number[] }> {
  if (locator.text || locator.role) return collectAxMatches(dbg, locator)
  if (locator.xpath) {
    const query = locator.xpath.trim()
    if (!query.startsWith('/') && !query.startsWith('(//')) throw new Error('XPath 要以 / 开头（或 (// 取全局第几个）')
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
  throw new Error(mt('main.page.needLocator'))
}

function axOf(locator: Locator, backendNodeId: number): AxRef {
  if (locator.xpath) return { role: 'xpath', name: locator.xpath, backendNodeId }
  if (locator.selector) return { role: 'selector', name: locator.selector, backendNodeId }
  if (locator.role) return { role: locator.role, name: locator.name ?? '', backendNodeId }
  return { role: 'text', name: locator.text ?? '', backendNodeId }
}


/** 多个匹配时的错误带上错误码，调用方不用靠文案判断。 */
function ambiguousError(count: number, label: string): Error {
  const error = new Error(mt('main.page.ambiguous', { count, label }))
  ;(error as { code?: string }).code = 'AMBIGUOUS'
  return error
}

export async function resolveLocator(tab: TabRuntime, locator: Locator): Promise<AxRef> {
  return withDebugger(wcOf(tab), async (dbg) => {
    const found = await collectMatches(dbg, locator)
    if (found.total === 0 || !found.backendNodeIds[0]) throw new Error(mt('main.page.notFoundLabel', { label: locatorLabel(locator) }))
    if (found.total !== 1) throw ambiguousError(found.total, locatorLabel(locator))
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

const DEEP_FIND = `(function (selector, xpath) {
  let found = null
  const walk = (root) => {
    if (found) return
    let hits = []
    if (selector) { try { hits = [...root.querySelectorAll(selector)] } catch (e) { hits = [] } }
    else if (xpath) {
      try {
        const doc = root instanceof Document ? root : root.ownerDocument
        const r = doc.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        if (r.singleNodeValue) hits = [r.singleNodeValue]
      } catch (e) { hits = [] }
    }
    for (const el of hits) {
      if (el && el.nodeType === 1) { found = el; return }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot)
    }
    for (const f of root.querySelectorAll('iframe')) {
      try {
        const d = f.contentDocument
        if (d) walk(d)
      } catch (e) { /* 跨域 iframe 进不去 */ }
    }
  }
  walk(document)
  return found
})`

const DEEP_QUERY = `(function (selector, xpath, doScroll) {
  const out = []
  const textOf = (el) => {
    let t = el.innerText
    if (!t && el.shadowRoot) {
      t = [...el.shadowRoot.childNodes].map((n) => n.nodeType === 3 ? n.textContent : (/^(STYLE|SCRIPT)$/.test(n.tagName) ? '' : (n.innerText || n.textContent))).join(' ')
    }
    return String(t || el.textContent || el.value || (el.getAttribute && el.getAttribute('aria-label')) || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  }
  const absRect = (el) => {
    const r = el.getBoundingClientRect()
    let x = r.left
    let y = r.top
    try {
      let win = el.ownerDocument.defaultView
      while (win && win.frameElement) {
        const fr = win.frameElement.getBoundingClientRect()
        x += fr.left
        y += fr.top
        win = win.parent
      }
    } catch (e) { /* 跨域父级拿不到 */ }
    return { x, y, w: r.width, h: r.height }
  }
  const walk = (root) => {
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
      if (!el || el.nodeType !== 1) continue
      out.push({ el, text: textOf(el), ...absRect(el) })
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot)
    }
    for (const f of root.querySelectorAll('iframe')) {
      try {
        const d = f.contentDocument
        if (d) walk(d)
      } catch (e) { /* 跨域 iframe 进不去 */ }
    }
  }
  walk(document)
  if (doScroll && out.length === 1) {
    out[0].el.scrollIntoView({ block: 'center' })
    Object.assign(out[0], absRect(out[0].el))
  }
  return out.slice(0, 100).map(({ el, ...rest }) => rest)
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
  if (found.total === 0) throw new Error(mt('main.page.pierceNotFound', { label: locatorLabel(locator) }))
  if (found.total !== 1) throw new Error(mt('main.page.pierceAmbiguous', { count: found.total, label: locatorLabel(locator), sample: found.matches.slice(0, 3).map((m) => `"${m.text}"`).join(', ') }))
  return found.matches[0]
}

async function settlePoint(tab: TabRuntime, x: number, y: number): Promise<void> {
  // 等目标点稳定可点，到了就立刻返回，不固定等
  const deadline = Date.now() + 3_000
  for (;;) {
    const ready = (await evalSource(
      tab,
      `(() => { const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)}); return !!el })()`
    ).catch(() => false)) as boolean
    if (ready) return
    if (Date.now() > deadline) return
    await sleep(80)
  }
}

export async function clickDeep(tab: TabRuntime, locator: Locator, via: ActVia = 'cdp', button: 'left' | 'right' = 'left'): Promise<void> {
  await ensureActive(tab)
  const match = await deepOne(tab, locator, true)
  await settlePoint(tab, match.x + match.w / 2, match.y + match.h / 2)
  await clickPoint(tab, match.x + match.w / 2, match.y + match.h / 2, via, undefined, button)
}

export async function typeDeep(tab: TabRuntime, locator: Locator, text: string, via: ActVia = 'cdp'): Promise<void> {
  await ensureActive(tab)
  const match = await deepOne(tab, locator, true)
  await settlePoint(tab, match.x + match.w / 2, match.y + match.h / 2)
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
  if (!target) throw new Error(mt('main.page.noFrame', { frame: frameMatch, list: frames.map((f) => f.url.slice(0, 60)).join(', ') || mt('main.page.noFrames') }))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(mt('main.page.scriptTimeout'))), 120_000)
  })
  try {
    return await Promise.race([target.executeJavaScript(source, true), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  const shown = found.matches.slice(0, 3).map((item) => `"${item.text || mt('main.page.emptyText')}" ${item.hittable ? mt('main.page.hittable') : mt('main.page.notHittable')}`)
  const count = found.total > shown.length ? mt('main.page.matchPrefix', { count: found.total, shown: shown.length }) : mt('main.page.matchMany', { count: found.total })
  return shown.length ? `${count}${mt('main.page.sceneSep')}${shown.join(mt('main.page.sceneJoin'))}` : count
}

async function failWithScene(tab: TabRuntime, locator: Locator, message: string): Promise<never> {
  const scene = await sceneOf(tab, locator).catch(() => '')
  throw new Error(scene ? `${message}${mt('main.page.sceneDot')}${scene}` : message)
}

export async function clickLocator(tab: TabRuntime, locator: Locator, via: ActVia = 'cdp', until?: Locator, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
  await ensureActive(tab)
  const rounds = until ? 3 : 2
  for (let round = 0; round < rounds; round += 1) {
    try {
      const target = await resolveLocator(tab, locator)
      await clickKnown(tab, target, via, button, count)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 刚切到前台的标签，AX 节点可能还指向旧布局，重解析一次再点
      const stale = !until && round === 0 && isStaleNodeError(error)
      if (!stale && (!until || round === rounds - 1)) await failWithScene(tab, locator, message)
      await sleep(stale ? 150 : 250)
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
    mt('main.page.clickNotAppeared', { label: locatorLabel(locator), until: until ? locatorLabel(until) : '' }) + (waited ? mt('main.page.waitedSuffix', { waited }) : '')
  )
}

async function focusResolved(tab: TabRuntime, target: AxRef): Promise<void> {
  if (!target.backendNodeId) throw new Error(mt('main.page.notOnPage', { name: target.name || target.role }))
  await withDebugger(wcOf(tab), async (dbg) => {
    await dbg.sendCommand('DOM.focus', { backendNodeId: target.backendNodeId })
  })
}

export async function typeLocator(tab: TabRuntime, locator: Locator, text: string, via: ActVia = 'cdp'): Promise<void> {
  await ensureActive(tab)
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const wrote = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_TEXT, [text]))
    if (wrote !== true) throw new Error(mt('main.page.cannotWrite', { label: locatorLabel(locator) }))
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
  await ensureActive(tab)
  if (locator.pierce) {
    const match = await deepOne(tab, locator, true)
    await clickPoint(tab, match.x + match.w / 2, match.y + match.h / 2, 'cdp')
    if (via === 'native') {
      clipboard.writeText(text)
      await pressShortcut(tab, 'Ctrl+V', 'native')
      return
    }
    await withDebugger(wcOf(tab), async (dbg) => {
      await dbg.sendCommand('Input.insertText', { text })
    })
    return
  }
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const wrote = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_TEXT, [text]))
    if (wrote !== true) throw new Error(mt('main.page.cannotWrite', { label: locatorLabel(locator) }))
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
  await ensureActive(tab)
  if (locator.pierce) {
    const source = `(() => {
      const el = (${DEEP_FIND})(${JSON.stringify(locator.selector || '')}, ${JSON.stringify(locator.xpath || '')})
      if (!el) return 'missing-el'
      if (el.tagName !== 'SELECT') return 'not-select'
      const wanted = ${JSON.stringify(option)}
      const opt = [...el.options].find((item) => item.text === wanted || item.value === wanted)
      if (!opt) return 'missing'
      el.value = opt.value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 'selected'
    })()`
    const result = (await evalSource(tab, source).catch(() => 'missing-el')) as string
    if (result === 'selected') return
    if (result === 'missing') throw new Error(mt('main.page.optionMissing', { option }))
    if (result === 'not-select') throw new Error(mt('main.page.pierceNotSelect'))
    throw new Error(mt('main.page.pierceNoSelect'))
  }
  const target = await resolveLocator(tab, locator)
  if (via === 'inject') {
    const picked = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, target.backendNodeId ?? 0, INJECT_SELECT, [option]))
    if (picked === 'selected') return
    if (picked === 'missing') throw new Error(mt('main.page.optionMissing', { option }))
  }
  await clickKnown(tab, target, via === 'inject' ? 'cdp' : via)
  await sleep(300)
  const { nodes } = await readTree(tab)
  const node = nodes.find((item) => ['option', 'menuitem', 'listitem', 'treeitem'].includes(item.role) && item.name === option)
    ?? nodes.find((item) => item.name === option)
  if (!node) throw new Error(mt('main.page.optionMissing', { option }))
  await clickKnown(tab, { role: node.role, name: node.name, backendNodeId: node.backendNodeId }, via === 'inject' ? 'cdp' : via)
}

async function matchCount(tab: TabRuntime, locator: Locator): Promise<number> {
  if (locator.pierce) {
    const deep = await deepQuery(tab, locator).catch(() => ({ total: 0, matches: [] as DeepMatch[] }))
    if (deep.total) return deep.total
    return (await crossQuery(tab, locator).catch(() => ({ total: 0, matches: [] as DeepMatch[] }))).total
  }
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
  await failWithScene(tab, locator, mt('main.page.appearTimeout', { label: locatorLabel(locator) }))
}

/**
 * 等到页面不再动：滚动高度、滚动位置和前 400 个元素的位置签名连续一段时间不变。
 * 广告位撑开、图片加载、字体替换都会让版面在几百毫秒里跳一下，写死 sleep 不好使。
 */
export async function waitForStable(tab: TabRuntime, stableMs: number, timeoutMs: number): Promise<{ waited: number }> {
  const started = Date.now()
  const signature = `(() => {
    const all = document.querySelectorAll('*')
    let sum = 0
    const limit = Math.min(all.length, 400)
    for (let i = 0; i < limit; i += 1) {
      const r = all[i].getBoundingClientRect()
      sum += r.top + r.left + r.width + r.height
    }
    const d = document.documentElement
    return [d.scrollHeight, d.scrollWidth, window.scrollY, window.scrollX, Math.round(sum), limit].join(':')
  })()`
  let last = ''
  let steadySince = 0
  for (;;) {
    const now = String(await evalSource(tab, signature))
    if (now !== last) {
      last = now
      steadySince = Date.now()
    } else if (Date.now() - steadySince >= stableMs) {
      return { waited: Date.now() - started }
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(mt('main.page.unstable', { seconds: Math.round(timeoutMs / 1000) }))
    }
    await sleep(100)
  }
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
  throw new Error(mt('main.page.goneTimeout', { label: locatorLabel(locator) }))
}

export type ShotRef = { width: number; height: number; originX?: number; originY?: number; scale?: number }

export function mapPoint(tab: TabRuntime, x: number, y: number, shot?: ShotRef): { x: number; y: number } {
  const [viewW, viewH] = viewport(tab)
  let px = x
  let py = y
  if (shot) {
    if (shot.scale !== undefined && shot.originX !== undefined && shot.originY !== undefined) {
      if (!(shot.scale > 0)) throw new Error(mt('main.page.shotScale'))
      px = shot.originX + x / shot.scale
      py = shot.originY + y / shot.scale
    } else {
      if (!(shot.width > 0) || !(shot.height > 0)) throw new Error(mt('main.page.shotSize'))
      px = x * viewW / shot.width
      py = y * viewH / shot.height
    }
  }
  if (px < 0 || py < 0 || px >= viewW || py >= viewH) throw new Error(mt('main.page.outsideViewport'))
  return { x: px, y: py }
}

export async function clickPoint(tab: TabRuntime, x: number, y: number, via: ActVia = 'cdp', shot?: ShotRef, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
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
    if (clicked !== true) throw new Error(mt('main.page.noElementAtPoint'))
    return
  }
  if (via === 'pointer') {
    await clickAtPointer(tab, point.x, point.y, button, count)
    return
  }
  if (via === 'cdp') await clickAtCdp(tab, point.x, point.y, button, count)
  else await clickAt(tab, point.x, point.y, button, count)
}

async function clickAtPointer(tab: TabRuntime, x: number, y: number, button: 'left' | 'right', count: number): Promise<void> {
  const source = `(() => {
    const x = ${JSON.stringify(x)}
    const y = ${JSON.stringify(y)}
    const el = document.elementFromPoint(x, y)
    if (!(el instanceof Element)) return false
    const base = {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: ${button === 'right' ? 2 : 0}, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }
    for (let i = 1; i <= ${Math.max(1, count)}; i += 1) {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }))
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }))
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('${button === 'right' ? 'contextmenu' : 'click'}', { ...base, buttons: 0 }))
    }
    return true
  })()`
  const clicked = await evalSource(tab, source)
  if (clicked !== true) throw new Error(mt('main.page.noElementAtPoint'))
}

export async function clickAt(tab: TabRuntime, x: number, y: number, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
  await ensureActive(tab)
  const wc = wcOf(tab)
  const ix = Math.round(x)
  const iy = Math.round(y)
  wc.sendInputEvent({ type: 'mouseMove', x: ix, y: iy })
  await sleep(30)
  for (let i = 1; i <= Math.max(1, count); i += 1) {
    wc.sendInputEvent({ type: 'mouseDown', x: ix, y: iy, button, clickCount: i })
    wc.sendInputEvent({ type: 'mouseUp', x: ix, y: iy, button, clickCount: i })
    if (i < count) await sleep(60)
  }
}

async function clickAtCdp(tab: TabRuntime, x: number, y: number, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
  await ensureActive(tab)
  const ix = Math.round(x)
  const iy = Math.round(y)
  const buttons = button === 'right' ? 2 : 1
  await withDebugger(wcOf(tab), async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ix, y: iy, button: 'none', buttons: 0, pointerType: 'mouse' })
    await sleep(30)
    for (let i = 1; i <= Math.max(1, count); i += 1) {
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: ix, y: iy, button, buttons, clickCount: i, pointerType: 'mouse' })
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ix, y: iy, button, buttons: 0, clickCount: i, pointerType: 'mouse' })
      if (i < count) await sleep(60)
    }
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

// 鼠标/键盘输入只对可见的标签页生效：后台标签的 view 是隐藏的，
// CDP 的 Input 会静默丢掉。需要真实输入的入口先把它切到前台。
let lastVisibility = { tabId: '', at: 0 }

// 窗口被别的窗口完全挡住时，Chromium 会把页面标成 hidden，合成输入会被丢掉。
// 这时把窗口拉到前面再输入；不然工具会「成功」但页面什么都没发生。
async function ensurePageVisible(tab: TabRuntime, runtime: { win: Electron.BrowserWindow; headless: boolean }): Promise<void> {
  const now = Date.now()
  if (lastVisibility.tabId === tab.id && now - lastVisibility.at < 500) return
  const state = (await tab.view?.webContents.executeJavaScript('document.visibilityState').catch(() => 'visible')) as string | undefined
  lastVisibility = { tabId: tab.id, at: Date.now() }
  if (state !== 'hidden' || runtime.headless) return
  if (runtime.win.isMinimized()) runtime.win.restore()
  runtime.win.show()
  runtime.win.focus()
  await sleep(150)
}

const warmedTabs = new Set<string>()

async function ensureActive(tab: TabRuntime): Promise<void> {
  const runtime = windows.get(tab.envId)
  if (!runtime) return
  if (runtime.activeTabId !== tab.id) {
    bridge.activateTab(tab.id)
    // 刚切到前台的 view 要等一帧再收输入，否则第一次点击会被丢掉
    await sleep(200)
  }
  if (!warmedTabs.has(tab.id)) {
    warmedTabs.add(tab.id)
    // 新标签的 view 可能还没排过版，先按当前布局摆一次再算坐标
    bridge.layout(runtime.envId)
    await sleep(150)
  }
  await ensurePageVisible(tab, runtime)
  tab.view?.webContents.focus()
}

function isStaleNodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Could not find node|No node with given id|Cannot find context|Execution context was destroyed|Node is detached/i.test(message)
}

async function clickKnown(tab: TabRuntime, target: AxRef, via: ActVia, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
  const wc = wcOf(tab)
  if (via === 'inject') {
    const clicked = await withDebugger(wc, async (dbg) => {
      const backendNodeId = await backendFor(dbg, target)
      await scrollNodeIntoView(dbg, backendNodeId)
      if (button === 'right') return callOnBackend(dbg, backendNodeId, INJECT_CONTEXT_MENU)
      return callOnBackend(dbg, backendNodeId, INJECT_CLICK)
    })
    if (clicked !== true) throw new Error(mt('main.page.notClickable', { name: target.name || target.role }))
    return
  }
  const point = await withDebugger(wc, async (dbg) => {
    const backendNodeId = await backendFor(dbg, target)
    return pointForClick(dbg, tab, backendNodeId)
  })
  if (!point) throw new Error(mt('main.page.blockedPoint', { name: target.name || target.role }))
  if (via === 'cdp') await clickAtCdp(tab, point.x, point.y, button, count)
  else await clickAt(tab, point.x, point.y, button, count)
}

async function backendFor(dbg: Electron.Debugger, target: AxRef): Promise<number> {
  await dbg.sendCommand('DOM.getDocument', { depth: 0 })
  if (!target.backendNodeId) throw new Error(mt('main.page.notOnPage', { name: target.name || target.role }))
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
    else throw new Error(mt('main.page.badModifier', { key: part }))
  }
  if (!key) throw new Error(mt('main.page.needKey'))
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
  await ensureActive(tab)
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
  await ensureActive(tab)
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

export function viewport(tab: TabRuntime): [number, number] {
  const bounds = tab.view?.getBounds()
  return [bounds?.width || 800, bounds?.height || 600]
}

async function wheelAt(tab: TabRuntime, via: GestureVia, x: number, y: number, deltaDown: number): Promise<void> {
  await ensureActive(tab)
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
      if ((error as { code?: string }).code === 'AMBIGUOUS') await failWithScene(tab, until, message)
      throw error
    }
    let target: AxRef | undefined
    try {
      target = await resolveLocator(tab, until)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if ((error as { code?: string }).code === 'AMBIGUOUS') await failWithScene(tab, until, message)
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
  await failWithScene(tab, until, mt('main.page.scrollNotReached', { label: locatorLabel(until) }))
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
  const point = locator ? await locatorCenter(tab, locator, true) : undefined
  await wheelAt(tab, via, point?.x ?? Math.round(width / 2), point?.y ?? Math.round(height / 2), direction === 'down' ? 240 : -240)
}

type TrackPoint = { x: number; y: number; delay: number; pressure?: number; tiltX?: number; tiltY?: number; twist?: number }

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

async function runTrack(tab: TabRuntime, via: GestureVia, sx: number, sy: number, track: TrackPoint[], guard?: () => Promise<void>): Promise<void> {
  const wc = wcOf(tab)
  const last = track[track.length - 1]
  if (via === 'native') {
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(sx), y: Math.round(sy), button: 'left', clickCount: 1 })
    if (guard) {
      try {
        await guard()
      } catch (error) {
        wc.sendInputEvent({ type: 'mouseUp', x: Math.round(sx), y: Math.round(sy), button: 'left', clickCount: 1 })
        throw error
      }
    }
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
  if (via === 'pointer') {
    const points = track.map((point) => ({ x: point.x, y: point.y, pressure: point.pressure, tiltX: point.tiltX, tiltY: point.tiltY, twist: point.twist }))
    const lastPoint = points[points.length - 1]
    const source = `(async () => {
      const points = ${JSON.stringify(points)}
      const first = points[0] || { x: ${sx}, y: ${sy} }
      const last = points[points.length - 1] || first
      const el = document.elementFromPoint(${sx}, ${sy})
      if (!(el instanceof Element)) return false
      const base = { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0 }
      const ink = (point) => (point && point.pressure !== undefined
        ? { pointerType: 'pen', pressure: point.pressure, tiltX: point.tiltX || 0, tiltY: point.tiltY || 0, twist: point.twist || 0 }
        : { pointerType: 'mouse', pressure: 0.5 })
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...ink(points[0]), clientX: ${sx}, clientY: ${sy}, buttons: 1 }))
      el.dispatchEvent(new MouseEvent('mousedown', { ...base, clientX: ${sx}, clientY: ${sy}, buttons: 1 }))
      for (const point of points) {
        el.dispatchEvent(new PointerEvent('pointermove', { ...base, ...ink(point), clientX: point.x, clientY: point.y, buttons: 1 }))
        el.dispatchEvent(new MouseEvent('mousemove', { ...base, clientX: point.x, clientY: point.y, buttons: 1 }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, ...ink(last), clientX: last.x, clientY: last.y, buttons: 0 }))
      el.dispatchEvent(new MouseEvent('mouseup', { ...base, clientX: last.x, clientY: last.y, buttons: 0 }))
      return true
    })()`
    const moved = await evalSource(tab, source)
    if (moved !== true) throw new Error(mt('main.page.dragNoElement'))
    return
  }
  const ink = (point: TrackPoint): Record<string, unknown> => (point.pressure === undefined ? {} : {
    pointerType: 'pen',
    force: Math.max(0, Math.min(1, point.pressure)),
    tiltX: point.tiltX ?? 0,
    tiltY: point.tiltY ?? 0,
    twist: point.twist ?? 0
  })
  await withDebugger(wc, async (dbg) => {
    // 不逐条等回执：窗口在后台时 Chromium 要等到下一次出帧才确认一个鼠标事件，
    // 逐条 await 会变成一秒多一个点。CDP 同一会话内保证顺序，松手那条再等回执即可。
    const fire = (params: Record<string, unknown>): void => {
      void dbg.sendCommand('Input.dispatchMouseEvent', params).catch(() => undefined)
    }
    fire({ type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse', ...ink(track[0]) })
    if (guard) {
      try {
        await guard()
      } catch (error) {
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' }).catch(() => undefined)
        throw error
      }
    }
    for (const point of track) {
      fire({ type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1, pointerType: 'mouse', ...ink(point) })
      await sleep(point.delay)
    }
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse', ...ink(last) })
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
  await ensureActive(tab)
  const [width, height] = viewport(tab)
  if (start.x < 0 || start.y < 0 || start.x > width || start.y > height) {
    throw new Error(mt('main.page.dragOutside', { x: Math.round(start.x), y: Math.round(start.y), width, height }))
  }
  const clamp = (value: number, max: number): number => Math.max(1, Math.min(max - 1, Math.round(value)))
  const sx = Math.round(start.x)
  const sy = Math.round(start.y)
  const ex = clamp(start.x + dx, width)
  const ey = clamp(start.y + dy, height)
  await runTrack(tab, via, sx, sy, humanTrack(sx, sy, ex, ey))
  return { from: { x: sx, y: sy }, to: { x: ex, y: ey } }
}

export async function scrollLocatorIntoView(tab: TabRuntime, locator: Locator): Promise<void> {
  const target = await resolveLocator(tab, locator)
  await withDebugger(wcOf(tab), async (dbg) => {
    const backendNodeId = await backendFor(dbg, target)
    // 用 center 而不是 scrollIntoViewIfNeeded：固定顶栏会盖住滚动到边缘的元素
    await callOnBackend(dbg, backendNodeId, "function () { this.scrollIntoView({ block: 'center', inline: 'nearest' }) }").catch(() => undefined)
    await sleep(120)
  })
}

export async function locatorGesturePoint(tab: TabRuntime, locator: Locator): Promise<{ x: number; y: number }> {
  const target = await resolveLocator(tab, locator)
  return withDebugger(wcOf(tab), async (dbg) => {
    const backendNodeId = await backendFor(dbg, target)
    await callOnBackend(dbg, backendNodeId, "function () { this.scrollIntoView({ block: 'center', inline: 'nearest' }) }").catch(() => undefined)
    await sleep(120)
    const point = await pointOnNode(dbg, tab, backendNodeId)
    if (!point) throw new Error(mt('main.page.dragBlocked', { label: locatorLabel(locator) }))
    return point
  })
}

export async function locatorCenter(tab: TabRuntime, locator: Locator, scroll = false): Promise<{ x: number; y: number }> {
  if (scroll) await scrollLocatorIntoView(tab, locator)
  return centerOf(tab, await resolveLocator(tab, locator))
}

export async function swipePage(
  tab: TabRuntime,
  direction: 'up' | 'down' | 'left' | 'right',
  locator?: Locator,
  until?: Locator,
  via: GestureVia = 'cdp'
): Promise<void> {
  await ensureActive(tab)
  const once = async (): Promise<void> => {
    const [width, height] = viewport(tab)
    let bounds: { left: number; top: number; right: number; bottom: number } | undefined
    if (locator) {
      await scrollLocatorIntoView(tab, locator)
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
  await failWithScene(tab, until, mt('main.page.swipeNotReached', { label: locatorLabel(until) }))
}

async function locatorInView(tab: TabRuntime, locator: Locator): Promise<boolean> {
  try {
    const target = await resolveLocator(tab, locator)
    if (!target.backendNodeId) return false
    return await withDebugger(wcOf(tab), async (dbg) => Boolean(await pointOnNode(dbg, tab, target.backendNodeId ?? 0)))
  } catch (error) {
    if ((error as { code?: string }).code === 'AMBIGUOUS') throw error
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
      if (!queried.nodeId) throw new Error(mt('main.page.noFileInput'))
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
      reject(new Error(mt('main.page.loadTimeout')))
    }, timeoutMs)
    const done = (): void => {
      cleanup()
      resolve()
    }
    const fail = (_event: unknown, code: number, desc: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || code === -3) return
      cleanup()
      reject(new Error(desc || mt('main.page.loadFailed')))
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
      reject(new Error(mt('main.page.loadTimeout')))
    }, timeoutMs)
    const onStart = (): void => {
      started = true
    }
    const onStop = (): void => {
      if (!started) return
      cleanup()
      resolve()
    }
    // 重页面（广告、长连接）did-stop-loading 可能一直不来：dom-ready 后静置一下就放行
    const onDomReady = (): void => {
      if (!started) return
      setTimeout(() => {
        cleanup()
        resolve()
      }, 1_200)
    }
    wc.on('dom-ready', onDomReady)
    const onFail = (_event: unknown, code: number, desc: string, _url: string, isMainFrame: boolean): void => {
      if (!isMainFrame || code === -3) return
      if (!started) return
      cleanup()
      reject(new Error(desc || mt('main.page.loadFailed')))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-start-loading', onStart)
      wc.removeListener('did-stop-loading', onStop)
      wc.removeListener('did-fail-load', onFail)
      wc.removeListener('dom-ready', onDomReady)
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

export async function screenshot(
  tab: TabRuntime,
  dir: string,
  grid = 100,
  edgeOnly = false
): Promise<{ path: string; width: number; height: number; origin: { x: number; y: number }; coordinateSpace: 'viewport'; shot: ShotRef }> {
  await ensureActive(tab)
  return captureFull(tab, dir, grid, edgeOnly)
}

async function captureFull(
  tab: TabRuntime,
  dir: string,
  grid = 0,
  edgeOnly = false
): Promise<{ path: string; width: number; height: number; origin: { x: number; y: number }; coordinateSpace: 'viewport'; shot: ShotRef }> {
  const wc = wcOf(tab)
  const reveal = (): void => {
    const runtime = windows.get(tab.envId)
    if (!runtime || runtime.headless) return
    if (runtime.win.isMinimized()) runtime.win.restore()
    else if (!runtime.win.isVisible()) runtime.win.showInactive()
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
  if (!image) throw new Error(lastError instanceof Error ? lastError.message : mt('main.page.noScreenshot'))
  let output = image
  if (grid > 0) {
    const runtime = windows.get(tab.envId)
    const bounds = tab.view?.getBounds()
    const size = image.getSize()
    if (runtime) {
      output = await renderGrid(runtime.win.webContents, image, {
        step: grid,
        edgeOnly,
        spanWidth: bounds?.width || size.width,
        spanHeight: bounds?.height || size.height
      })
    }
  }
  const size = output.getSize()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `shot-${Date.now()}.png`)
  writeFileSync(path, output.toPNG())
  return { path, width: size.width, height: size.height, origin: { x: 0, y: 0 }, coordinateSpace: 'viewport', shot: { width: size.width, height: size.height } }
}

export async function pageSource(tab: TabRuntime, kind: 'dom' | 'response'): Promise<string> {
  if (kind === 'response') {
    if (!tab.documentHtml) throw new Error(mt('main.page.noHtml'))
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
      // page_source 只需要能读，存整份大文档会把主进程堆撑起来；超过 2MB 截断
      onHtml(html.length > 2 * 1024 * 1024 ? html.slice(0, 2 * 1024 * 1024) : html)
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
    timer = setTimeout(() => reject(new Error(mt('main.page.scriptTimeout'))), 120_000)
  })
  try {
    return await Promise.race([wcOf(tab).executeJavaScript(source, true), timeout])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Script failed to execute')) throw new Error(message + mt('main.page.scriptConsole'))
    throw error
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
  const base = { tag: el.tagName, id: el.id || '', cls: String(el.className || '').slice(0, 80), rect: { x: r.left, y: r.top, w: r.width, h: r.height } }
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
  const m = bg && bg.match(/url\\(["']?(.+?)["']?\\)/)
  if (m) return { ...base, kind: 'image', src: abs(m[1]), via: 'background' }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return { ...base, kind: 'input' }
  return { ...base, kind: 'text', text: String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100) }
}`

export type ElementInfo = {
  kind: 'video' | 'image' | 'canvas' | 'audio' | 'link' | 'input' | 'text'
  tag: string
  id?: string
  cls?: string
  src?: string
  poster?: string
  href?: string
  via?: string
  text?: string
  rect: { x: number; y: number; w: number; h: number }
}

export async function inspectElement(tab: TabRuntime, target: { locator?: Locator; point?: { x: number; y: number } }): Promise<ElementInfo> {
  if (target.locator?.pierce) {
    const source = `(() => {
      const el = (${DEEP_FIND})(${JSON.stringify(target.locator.selector || '')}, ${JSON.stringify(target.locator.xpath || '')})
      if (!el) return null
      return (${CLASSIFY_JS}).call(el)
    })()`
    const info = await evalSource(tab, source)
    if (!info) throw new Error(mt('main.page.pierceInspect', { label: locatorLabel(target.locator) }))
    return info as ElementInfo
  }
  if (target.locator) {
    const resolved = await resolveLocator(tab, target.locator)
    const info = await withDebugger(wcOf(tab), (dbg) => callOnBackend(dbg, resolved.backendNodeId ?? 0, CLASSIFY_JS))
    if (!info) throw new Error(mt('main.page.inspectFail', { label: locatorLabel(target.locator) }))
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
    if (!info) throw new Error(mt('main.page.pointEmpty', { x: target.point.x, y: target.point.y }))
    return info as ElementInfo
  }
  throw new Error(mt('main.page.needTarget'))
}

export async function downloadUrl(wc: WebContents, url: string, referer?: string, onProgress?: (received: number, total: number) => void): Promise<{ buf: Buffer; contentType: string }> {
  const ses = wc.session
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: ses })
    const ref = referer || wc.getURL()
    if (ref) req.setHeader('Referer', ref)
    const ua = wc.getUserAgent()
    if (ua) req.setHeader('User-Agent', ua)
    const chunks: Buffer[] = []
    let contentType = ''
    req.on('response', (res) => {
      contentType = String(res.headers['content-type'] || '')
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(mt('main.page.downloadFailed', { status: res.statusCode })))
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

export async function downloadMedia(tab: TabRuntime, url: string, path: string, referer?: string, onProgress?: (received: number, total?: number) => void): Promise<void> {
  try {
    const got = await downloadUrl(wcOf(tab), url, referer, onProgress)
    writeFileSync(path, got.buf)
  } catch {
    await fetchToFile(tab, url, path, onProgress)
  }
}

export async function recordVideo(tab: TabRuntime, seconds: number, dir: string, savePath?: string): Promise<{ path: string; bytes: number; seconds: number }> {
  if (savePath && existsSync(savePath) && statSync(savePath).isDirectory()) {
    dir = savePath
    savePath = undefined
  }
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
  if (armed !== 'recording') throw new Error(armed === 'no video' ? mt('main.page.recordNoVideo') : mt('main.page.recordUnsupported'))
  const path = savePath || join(dir, `record-${Date.now()}.webm`)
  writeFileSync(path, Buffer.alloc(0))
  const dlId = downloadBegin(mt('main.page.recordTitle', { title: tab.title || mt('main.page.emptyText') }), tab.url, '', 0, undefined, undefined, tab.envId)
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
  if (bytes === 0) throw new Error(mt('main.page.recordEmpty'))
  return { path, bytes: statSync(path).size, seconds: Math.round(ms / 1000) }
}

async function pullChunks(tab: TabRuntime, key: string, path: string, deadlineMs: number, onProgress?: (received: number, total?: number) => void): Promise<number> {
  let bytes = 0
  for (;;) {
    await sleep(700)
    const pulled = (await evalSource(
      tab,
      `(() => { const r = window.${key} || { chunks: [], done: true }; const chunks = r.chunks; r.chunks = []; return { chunks, done: r.done, error: r.error || '' } })()`
    ).catch(() => ({ chunks: [] as string[], done: true, error: mt('main.page.pageDisconnected') }))) as { chunks: string[]; done: boolean; error: string }
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
    if (Date.now() > deadlineMs) throw new Error(mt('main.page.fetchTimeout'))
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
  if (armed !== 'started') throw new Error(mt('main.page.downloadStartFailed'))
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
  throw new Error(mt('main.page.unknownShape', { shape }))
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

export type InkPoint = { x: number; y: number; pressure?: number; tiltX?: number; tiltY?: number; twist?: number }

export type CanvasSums = { supported: boolean; reason?: string; sums: number[] }

export type DrawCheck = { supported: boolean; reason?: string; painted: number; kept: number; wiped: boolean; empty: boolean }

const PATCH_RADIUS = 3
const PATCH_CHANGED = 240

function probeSumsSource(points: InkPoint[], radius: number): string {
  return `(() => {
    const points = ${JSON.stringify(points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })))}
    const P = ${radius}
    const first = points[0]
    const el = document.elementFromPoint(first.x, first.y)
    if (!(el instanceof HTMLCanvasElement)) return { supported: false, reason: mt('main.page.probeNotCanvas'), sums: [] }
    let ctx = null
    try { ctx = el.getContext('2d') } catch (e) { ctx = null }
    if (!ctx) return { supported: false, reason: mt('main.page.probeNoContext'), sums: [] }
    const rect = el.getBoundingClientRect()
    const sx = el.width / Math.max(1, rect.width)
    const sy = el.height / Math.max(1, rect.height)
    const sums = []
    for (const point of points) {
      const cx = Math.round((point.x - rect.left) * sx)
      const cy = Math.round((point.y - rect.top) * sy)
      if (cx < 0 || cy < 0 || cx >= el.width || cy >= el.height) { sums.push(-1); continue }
      const x0 = Math.max(0, cx - P)
      const y0 = Math.max(0, cy - P)
      const w = Math.min(el.width - x0, P * 2 + 1)
      const h = Math.min(el.height - y0, P * 2 + 1)
      let data
      try { data = ctx.getImageData(x0, y0, w, h).data } catch (e) { return { supported: false, reason: mt('main.page.probeTainted'), sums: [] } }
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2] + data[i + 3]
      sums.push(sum)
    }
    return { supported: true, sums }
  })()`
}

export async function canvasSums(tab: TabRuntime, points: InkPoint[], radius = PATCH_RADIUS): Promise<CanvasSums> {
  const value = await evalSource(tab, probeSumsSource(points, radius)) as CanvasSums | undefined
  return value && typeof value === 'object' ? value : { supported: false, reason: mt('main.page.probeUnreadable'), sums: [] }
}

export function thinPoints<T extends { x: number; y: number }>(points: T[], max = 36): T[] {
  if (points.length <= max) return points
  const out: T[] = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)])
  return out
}

/**
 * 画完再读两次：先看有没有新像素，再等半秒看还在不在。
 * 站点把画布按自己的文档重绘时，这一笔会被抹掉，这里就能看出来。
 */
export async function checkStroke(tab: TabRuntime, points: InkPoint[], before: CanvasSums, radius = PATCH_RADIUS): Promise<DrawCheck> {
  if (!before.supported) return { supported: false, reason: before.reason, painted: 0, kept: 0, wiped: false, empty: false }
  await sleep(140)
  const after = await canvasSums(tab, points, radius)
  await sleep(520)
  const later = await canvasSums(tab, points, radius)
  if (!after.supported || !later.supported) return { supported: false, reason: after.reason || later.reason, painted: 0, kept: 0, wiped: false, empty: false }
  const changed = (base: number[], next: number[]): number => base.reduce((count, value, index) => count + (Math.abs(value - (next[index] ?? value)) > PATCH_CHANGED ? 1 : 0), 0)
  const painted = changed(before.sums, after.sums)
  const kept = changed(before.sums, later.sums)
  return { supported: true, painted, kept, wiped: painted > 0 && kept === 0, empty: painted === 0 }
}

export async function drawPath(tab: TabRuntime, via: GestureVia, points: InkPoint[], close = false, smooth = false, guard?: () => Promise<void>): Promise<{ points: number }> {
  if (smooth && points.length >= 3) points = smoothPath(points, close)
  if (points.length < 2) throw new Error(mt('main.page.pathTooShort'))
  const [width, height] = viewport(tab)
  for (const p of points) {
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) throw new Error(mt('main.page.pointOutside', { x: Math.round(p.x), y: Math.round(p.y), width, height }))
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
        delay: 8 + Math.random() * 12,
        pressure: p.pressure,
        tiltX: p.tiltX,
        tiltY: p.tiltY,
        twist: p.twist
      })
    }
    prev = p
  }
  if (close) track.push({ x: points[0].x, y: points[0].y, delay: 30 })
  await runTrack(tab, via, points[0].x, points[0].y, track, guard)
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
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i += 1 } else if (cmd === '') { throw new Error(mt('main.page.pathMustStart')) }
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

export async function drawPaths(tab: TabRuntime, via: GestureVia, subpaths: SvgPoint[][], guard?: () => Promise<void>): Promise<{ paths: number; points: number }> {
  let total = 0
  for (const points of subpaths) {
    if (points.length < 2) continue
    await drawPath(tab, via, points, false, false, guard)
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

export function fillSerpentine(points: SvgPoint[], spacing = 5): SvgPoint[] {
  const segments = fillScanlines(points, spacing)
  // 蛇形连笔：端点都在区域内部，连接处贴着边界走，笔不离纸
  const path: SvgPoint[] = []
  let flip = false
  for (const seg of segments) {
    const [a, b] = flip ? [seg[1], seg[0]] : [seg[0], seg[1]]
    path.push(a)
    path.push(b)
    flip = !flip
  }
  return path
}

export function fillScanlines(points: SvgPoint[], spacing = 5): SvgPoint[][] {
  if (points.length < 3) return []
  const ys = points.map((p) => p.y)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const segments: SvgPoint[][] = []
  const n = points.length
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs: number[] = []
    for (let i = 0; i < n; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % n]
      if ((a.y > y) === (b.y > y)) continue
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((m, n2) => m - n2)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 2) continue
      segments.push([{ x: xs[i], y }, { x: xs[i + 1], y }])
    }
  }
  return segments
}

type TurtleState = { x: number; y: number; heading: number; down: boolean }

export async function turtleRun(tab: TabRuntime, via: GestureVia, script: string, start?: { x?: number; y?: number; heading?: number }): Promise<{ strokes: number; points: number }> {
  const [viewW, viewH] = viewport(tab)
  const state: TurtleState = { x: start?.x ?? Math.round(viewW / 2), y: start?.y ?? Math.round(viewH / 2), heading: start?.heading ?? 0, down: true }
  let strokesCount = 0
  let current: SvgPoint[] = []
  let fillFrom: number | null = null
  let spacing = 5
  let total = 0
  const flush = async (): Promise<void> => {
    if (current.length >= 2) {
      await drawPath(tab, via, current)
      total += current.length
      strokesCount += 1
    }
    current = []
  }
  const move = (nx: number, ny: number): void => {
    if (nx < 0 || ny < 0 || nx > viewW || ny > viewH) throw new Error(mt('main.page.trackOutside', { x: Math.round(nx), y: Math.round(ny) }))
    if (state.down) current.push({ x: nx, y: ny })
    state.x = nx
    state.y = ny
  }
  const penup = async (): Promise<void> => { await flush(); state.down = false }
  for (const raw of script.split(/[\n;]+/)) {
    const parts = raw.trim().split(/\s+/)
    if (!parts[0]) continue
    const cmd = parts[0].toLowerCase()
    const arg = Number(parts[1])
    if (cmd === 'fd' || cmd === 'forward') {
      const rad = (state.heading * Math.PI) / 180
      move(state.x + arg * Math.cos(rad), state.y + arg * Math.sin(rad))
    } else if (cmd === 'bk' || cmd === 'backward') {
      const rad = (state.heading * Math.PI) / 180
      move(state.x - arg * Math.cos(rad), state.y - arg * Math.sin(rad))
    } else if (cmd === 'lt' || cmd === 'left') {
      state.heading = (state.heading - arg + 360) % 360
    } else if (cmd === 'rt' || cmd === 'right') {
      state.heading = (state.heading + arg) % 360
    } else if (cmd === 'setheading' || cmd === 'seth') {
      state.heading = ((arg % 360) + 360) % 360
    } else if (cmd === 'goto' || cmd === 'setpos') {
      move(Number(parts[1]), Number(parts[2]))
    } else if (cmd === 'penup' || cmd === 'pu') {
      await penup()
    } else if (cmd === 'pendown' || cmd === 'pd') {
      state.down = true
      current = [{ x: state.x, y: state.y }]
    } else if (cmd === 'circle') {
      const r = arg
      const extent = parts[2] !== undefined ? Number(parts[2]) : 360
      const steps = Math.max(12, Math.round((Math.abs(extent) / 360) * Math.abs(r) / 2))
      const turn = extent / steps
      const chord = 2 * Math.abs(r) * Math.sin(Math.PI / steps)
      for (let k = 0; k < steps; k += 1) {
        state.heading = (state.heading + (r > 0 ? -turn : turn) / 2 + 360) % 360
        const rad = (state.heading * Math.PI) / 180
        move(state.x + chord * Math.cos(rad), state.y + chord * Math.sin(rad))
        state.heading = (state.heading + (r > 0 ? -turn : turn) / 2 + 360) % 360
      }
    } else if (cmd === 'beginfill') {
      if (state.down) fillFrom = 0
      else fillFrom = null
    } else if (cmd === 'endfill') {
      if (current.length >= 3) {
        await drawPath(tab, via, current, true)
        total += current.length
        strokesCount += 1
        await drawPath(tab, via, fillSerpentine(current, spacing))
        current = []
      } else {
        await flush()
      }
    } else if (cmd === 'spacing') {
      spacing = Math.max(3, arg || 5)
    } else {
      throw new Error(mt('main.page.unknownTurtle', { cmd }))
    }
  }
  await flush()
  return { strokes: strokesCount, points: total }
}

const INJECT_HOVER = `function () {
  const el = this
  if (!(el instanceof Element)) return false
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const pointer = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse' }
  const mouse = { bubbles: true, cancelable: true, clientX: x, clientY: y }
  el.dispatchEvent(new PointerEvent('pointerover', pointer))
  el.dispatchEvent(new MouseEvent('mouseover', mouse))
  el.dispatchEvent(new PointerEvent('pointerenter', { ...pointer, bubbles: false }))
  el.dispatchEvent(new MouseEvent('mouseenter', { ...mouse, bubbles: false }))
  el.dispatchEvent(new MouseEvent('mousemove', mouse))
  return true
}`

async function hoverAtCdp(tab: TabRuntime, x: number, y: number): Promise<void> {
  await ensureActive(tab)
  const ix = Math.round(x)
  const iy = Math.round(y)
  await withDebugger(wcOf(tab), async (dbg) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ix, y: iy, button: 'none', buttons: 0, pointerType: 'mouse' })
  })
}

async function hoverKnown(tab: TabRuntime, target: AxRef, via: ActVia): Promise<void> {
  await ensureActive(tab)
  const wc = wcOf(tab)
  if (via === 'inject') {
    const hovered = await withDebugger(wc, async (dbg) => {
      const backendNodeId = await backendFor(dbg, target)
      await scrollNodeIntoView(dbg, backendNodeId)
      return callOnBackend(dbg, backendNodeId, INJECT_HOVER)
    })
    if (hovered !== true) throw new Error(mt('main.page.hoverFail', { name: target.name || target.role }))
    return
  }
  const point = await withDebugger(wc, async (dbg) => {
    const backendNodeId = await backendFor(dbg, target)
    return pointForClick(dbg, tab, backendNodeId)
  })
  if (!point) throw new Error(mt('main.page.hoverBlocked', { name: target.name || target.role }))
  if (via === 'cdp') await hoverAtCdp(tab, point.x, point.y)
  else wc.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) })
}

export async function hoverLocator(tab: TabRuntime, locator: Locator, via: ActVia = 'cdp'): Promise<void> {
  await ensureActive(tab)
  if (locator.pierce) {
    const match = await deepOne(tab, locator, true)
    await hoverPoint(tab, match.x + match.w / 2, match.y + match.h / 2, undefined, via)
    return
  }
  const target = await resolveLocator(tab, locator)
  await hoverKnown(tab, target, via)
}

export async function hoverPoint(tab: TabRuntime, x: number, y: number, shot?: ShotRef, via: ActVia = 'cdp'): Promise<void> {
  await ensureActive(tab)
  const point = mapPoint(tab, x, y, shot)
  if (via === 'cdp') await hoverAtCdp(tab, point.x, point.y)
  else wcOf(tab).sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) })
}

export async function screenshotRegion(
  tab: TabRuntime,
  target: { locator?: Locator; rect?: { x: number; y: number; width: number; height: number } },
  dir: string,
  grid = 100,
  edgeOnly = false
): Promise<{
  path: string
  width: number
  height: number
  x: number
  y: number
  full: boolean
  origin: { x: number; y: number }
  coordinateSpace: 'viewport'
  shot: ShotRef
}> {
  await ensureActive(tab)
  const wc = wcOf(tab)
  let rect = target.rect
  if (!rect && target.locator?.pierce) {
    const match = await deepOne(tab, target.locator, true)
    rect = { x: match.x, y: match.y, width: match.w, height: match.h }
  }
  if (!rect && target.locator) {
    const found = await resolveLocator(tab, target.locator)
    rect = await withDebugger(wc, async (dbg) => {
      const backendNodeId = await backendFor(dbg, found)
      await scrollNodeIntoView(dbg, backendNodeId)
      await sleep(150)
      const box = (await dbg.sendCommand('DOM.getBoxModel', { backendNodeId }).catch(() => undefined)) as
        | { model?: { content: number[] } }
        | undefined
      const quad = box?.model?.content
      if (!quad || quad.length < 8) return undefined
      const xs = [quad[0], quad[2], quad[4], quad[6]]
      const ys = [quad[1], quad[3], quad[5], quad[7]]
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
    })
  }
  if (!rect) {
    if (target.locator) throw new Error(mt('main.page.regionInvisible'))
    const shot = await screenshot(tab, dir, grid, edgeOnly)
    return { ...shot, x: 0, y: 0, full: true }
  }
  const [vw, vh] = viewport(tab)
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.max(1, Math.min(Math.ceil(rect.width), vw - x))
  const height = Math.max(1, Math.min(Math.ceil(rect.height), vh - y))
  const capture = async (): Promise<{
    path: string
    width: number
    height: number
    x: number
    y: number
    full: boolean
    origin: { x: number; y: number }
    coordinateSpace: 'viewport'
    shot: ShotRef
  }> => {
    const reveal = (): void => {
      const runtime = windows.get(tab.envId)
      if (!runtime || runtime.headless) return
      if (runtime.win.isMinimized()) runtime.win.restore()
      else if (!runtime.win.isVisible()) runtime.win.showInactive()
    }
    reveal()
    let image = await wc.capturePage({ x, y, width, height }).catch(() => undefined)
    if (!image || image.isEmpty()) {
      reveal()
      await sleep(250)
      image = await wc.capturePage({ x, y, width, height }).catch(() => undefined)
    }
    if (!image || image.isEmpty()) throw new Error(mt('main.page.regionCapture'))
    let output = image
    if (grid > 0) {
      const runtime = windows.get(tab.envId)
      if (runtime) {
        output = await renderGrid(runtime.win.webContents, image, {
          step: grid,
          originX: x,
          originY: y,
          showOrigin: true,
          edgeOnly,
          spanWidth: width,
          spanHeight: height
        })
      }
    }
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `shot-${Date.now()}.png`)
    writeFileSync(path, output.toPNG())
    return {
      path,
      width: output.getSize().width,
      height: output.getSize().height,
      x,
      y,
      full: false,
      origin: { x, y },
      coordinateSpace: 'viewport',
      shot: { width: output.getSize().width, height: output.getSize().height, originX: x, originY: y, scale: output.getSize().width / width }
    }
  }
  return capture()
}

export async function findInPage(
  tab: TabRuntime,
  text: string,
  options: { forward?: boolean; findNext?: boolean; stop?: boolean } = {}
): Promise<{ matches: number; active: number; stopped?: boolean }> {
  if (options.stop) {
    await evalSource(tab, `(() => { const selection = window.getSelection(); if (selection) selection.removeAllRanges(); return true })()`).catch(() => undefined)
    return { matches: 0, active: 0, stopped: true }
  }
  const forward = options.forward !== false
  const findNext = Boolean(options.findNext)
  const found = (await evalSource(
    tab,
    `(() => {
      const text = ${JSON.stringify(text)}
      const forward = ${forward}
      const findNext = ${findNext}
      if (!text) return { matches: 0, active: 0 }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT
          const style = getComputedStyle(parent)
          if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        }
      })
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      const needle = text.toLowerCase()
      const hits = []
      for (const node of nodes) {
        const hay = node.nodeValue.toLowerCase()
        let from = 0
        while (true) {
          const at = hay.indexOf(needle, from)
          if (at < 0) break
          hits.push({ node, at, length: text.length })
          from = at + Math.max(1, needle.length)
        }
      }
      if (!hits.length) return { matches: 0, active: 0 }
      const state = window.__bpFind || (window.__bpFind = { text: '', index: 0 })
      if (state.text !== text || !findNext) state.index = 0
      else state.index = (state.index + (forward ? 1 : -1) + hits.length) % hits.length
      state.text = text
      const hit = hits[state.index]
      const range = document.createRange()
      range.setStart(hit.node, hit.at)
      range.setEnd(hit.node, hit.at + hit.length)
      const selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
      if (hit.node.parentElement) hit.node.parentElement.scrollIntoView({ block: 'center', inline: 'nearest' })
      return { matches: hits.length, active: state.index + 1 }
    })()`
  )) as { matches: number; active: number } | undefined
  if (!found) throw new Error(mt('main.page.findNothing'))
  return found
}

export type TextHit = { x: number; y: number; w: number; h: number; label: string; tag: string; dom?: boolean; blocked?: string }

const TEXT_HIT_SOURCE = `(function (text, match) {
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
  const wanted = norm(text)
  const nodes = [...document.querySelectorAll('a,button,input,label,li,span,div,td,th,h1,h2,h3,h4,p,summary')]
  const hits = []
  for (const el of nodes) {
    if (el === document.body || el === document.documentElement) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue
    if (rect.width * rect.height > 400000) continue
    const label = norm(el.innerText || el.value || el.getAttribute('aria-label') || '')
    if (!label) continue
    if (match === 'exact' ? label !== wanted : !label.includes(wanted)) continue
    hits.push({ el, label, rect })
  }
  hits.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
  const best = hits[0]
  if (!best) return null
  // 文字元素不一定可点：带 for 的标签、包着隐藏 radio 的自定义控件，改点它的可点代理
  let target = null
  const related = (best.el.getAttribute && best.el.getAttribute('for')) || ''
  if (related) {
    const input = document.getElementById(related)
    if (input) {
      const proxy = input.closest('.ui-radio') || input.closest('.ui-checkbox') || input.closest('label')
      target = proxy ? (proxy.querySelector('a.jqradio') || proxy.querySelector('a.jqcheck') || proxy.querySelector('label') || proxy) : input
      if (target === input && input.getBoundingClientRect().width < 2) {
        input.click()
        return { x: best.rect.left, y: best.rect.top, w: best.rect.width, h: best.rect.height, label: best.label.slice(0, 80), tag: 'input', dom: true }
      }
    }
  }
  if (!target) target = best.el.closest('a,button,input,select,textarea,label,summary,[role=button],[onclick]') || best.el
  const rect = target.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) {
    target.click()
    return { x: best.rect.left, y: best.rect.top, w: best.rect.width, h: best.rect.height, label: best.label.slice(0, 80), tag: target.tagName.toLowerCase(), dom: true }
  }
  // 检查中心点有没有被弹层/遮罩盖住，别把点击送给遮罩
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const at = document.elementFromPoint(cx, cy)
  const cover = at && at !== target && !target.contains(at) && !at.contains(target)
    ? at.tagName.toLowerCase() + (at.className ? '.' + String(at.className).split(' ')[0] : '')
    : ''
  return {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
    label: best.label.slice(0, 80),
    tag: target.tagName.toLowerCase(),
    blocked: cover
  }
})`

const FRAME_ELEMENT_SOURCE = `(function (selector, xpath) {
  let el = null
  if (selector) { try { el = document.querySelector(selector) } catch (e) { el = null } }
  else if (xpath) {
    try { el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue } catch (e) { el = null }
  }
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, tag: el.tagName.toLowerCase() }
})`

const FRAME_FOCUS_SOURCE = `(function (selector, xpath) {
  let el = null
  if (selector) { try { el = document.querySelector(selector) } catch (e) { el = null } }
  else if (xpath) {
    try { el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue } catch (e) { el = null }
  }
  if (!el) return false
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
  el.focus()
  return true
})`

function frameLocatorSource(locator: Locator): string {
  return `(${FRAME_ELEMENT_SOURCE})(${JSON.stringify(locator.selector || '')}, ${JSON.stringify(locator.xpath || '')})`
}

async function frameOffset(tab: TabRuntime, frameMatch: string): Promise<{ x: number; y: number }> {
  const offset = (await evalSource(tab, `(() => {
    const found = [...document.querySelectorAll('iframe')].find((item) => (item.src || '').includes(${JSON.stringify(frameMatch)}))
    if (!found) return null
    const rect = found.getBoundingClientRect()
    return { x: rect.left, y: rect.top }
  })()`)) as { x: number; y: number } | null
  if (!offset) throw new Error(mt('main.page.noIframe', { frame: frameMatch }))
  return offset
}

export async function clickText(tab: TabRuntime, text: string, match: 'exact' | 'contains' = 'contains', via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalSource(tab, `(${TEXT_HIT_SOURCE})(${JSON.stringify(text)}, ${JSON.stringify(match)})`)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.textNotFound', { mode: match === 'exact' ? mt('main.page.modeExact') : mt('main.page.modeContains'), text }))
  if (hit.blocked) throw new Error(mt('main.page.textBlocked', { text, blocked: hit.blocked }))
  if (!hit.dom) await clickPoint(tab, hit.x + hit.w / 2, hit.y + hit.h / 2, via)
  return hit
}

export async function hoverText(tab: TabRuntime, text: string, match: 'exact' | 'contains' = 'contains', via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalSource(tab, `(${TEXT_HIT_SOURCE})(${JSON.stringify(text)}, ${JSON.stringify(match)})`)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.textNoElement', { mode: match === 'exact' ? mt('main.page.modeExact') : mt('main.page.modeContains'), text }))
  await hoverPoint(tab, hit.x + hit.w / 2, hit.y + hit.h / 2, undefined, via)
  return hit
}

export async function clickTextInFrame(tab: TabRuntime, frame: string, text: string, match: 'exact' | 'contains' = 'contains', via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalInFrame(tab, `(${TEXT_HIT_SOURCE})(${JSON.stringify(text)}, ${JSON.stringify(match)})`, frame)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.frameTextNoElement', { mode: match === 'exact' ? mt('main.page.modeExact') : mt('main.page.modeContains'), text }))
  if (hit.blocked) throw new Error(mt('main.page.frameTextBlocked', { text, blocked: hit.blocked }))
  if (!hit.dom) {
    const offset = await frameOffset(tab, frame)
    await clickPoint(tab, offset.x + hit.x + hit.w / 2, offset.y + hit.y + hit.h / 2, via)
  }
  return hit
}

export async function clickLocatorInFrame(tab: TabRuntime, frame: string, locator: Locator, via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalInFrame(tab, frameLocatorSource(locator), frame)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.frameNoLabel', { label: locatorLabel(locator) }))
  const offset = await frameOffset(tab, frame)
  await clickPoint(tab, offset.x + hit.x + hit.w / 2, offset.y + hit.y + hit.h / 2, via)
  return hit
}

export async function typeLocatorInFrame(tab: TabRuntime, frame: string, locator: Locator, text: string): Promise<void> {
  await ensureActive(tab)
  const focused = await evalInFrame(tab, `(${FRAME_FOCUS_SOURCE})(${JSON.stringify(locator.selector || '')}, ${JSON.stringify(locator.xpath || '')})`, frame)
  if (focused !== true) throw new Error(mt('main.page.frameNoLabel', { label: locatorLabel(locator) }))
  await typeByCdp(tab, text)
}

export async function hoverLocatorInFrame(tab: TabRuntime, frame: string, locator: Locator, via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalInFrame(tab, frameLocatorSource(locator), frame)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.frameNoLabel', { label: locatorLabel(locator) }))
  const offset = await frameOffset(tab, frame)
  await hoverPoint(tab, offset.x + hit.x + hit.w / 2, offset.y + hit.y + hit.h / 2, undefined, via)
  return hit
}

export async function hoverTextInFrame(tab: TabRuntime, frame: string, text: string, match: 'exact' | 'contains' = 'contains', via: ActVia = 'cdp'): Promise<TextHit> {
  await ensureActive(tab)
  const hit = (await evalInFrame(tab, `(${TEXT_HIT_SOURCE})(${JSON.stringify(text)}, ${JSON.stringify(match)})`, frame)) as TextHit | null
  if (!hit) throw new Error(mt('main.page.frameNoText', { text }))
  const offset = await frameOffset(tab, frame)
  await hoverPoint(tab, offset.x + hit.x + hit.w / 2, offset.y + hit.y + hit.h / 2, undefined, via)
  return hit
}

export type HitQuery = {
  selector?: string
  xpath?: string
  testId?: string
  alt?: string
  text?: string
  textMatch?: 'exact' | 'contains'
  role?: string
  name?: string
  nameMatch?: 'exact' | 'contains'
  within?: string
  index?: number
}

const HIT_SOURCE = `(function (query) {
  const norm = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  const wantedText = norm(query.text || '')
  const wantedName = norm(query.name || '')
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase()
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && el.hasAttribute('href')) return 'link'
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'search') return 'searchbox'
      return 'textbox'
    }
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'img') return 'img'
    return ''
  }
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria) return norm(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const target = document.getElementById(by)
      if (target) return norm(target.innerText)
    }
    if (el.id) {
      try {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
        if (label) return norm(label.innerText)
      } catch (e) { /* id 里有特殊字符 */ }
    }
    const wrap = el.closest('label')
    if (wrap) return norm(wrap.innerText)
    return norm(el.innerText || el.value || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '')
  }
  let withinSelector = query.within || ''
  let withinText = ''
  const marker = ':has-text('
  const markerAt = withinSelector.indexOf(marker)
  if (markerAt >= 0) {
    const markerEnd = withinSelector.indexOf(')', markerAt)
    const raw = withinSelector.slice(markerAt + marker.length, markerEnd).trim()
    withinText = norm(raw.replace(/^["']|["']$/g, ''))
    withinSelector = (withinSelector.slice(0, markerAt) + withinSelector.slice(markerEnd + 1)).trim()
  }
  let roots = withinSelector ? [...document.querySelectorAll(withinSelector)] : [document]
  if (withinText) roots = roots.filter((el) => norm(el.innerText).includes(withinText))
  if (!roots.length) return null
  const seen = new Set()
  const items = []
  const collect = (root) => {
    let found = []
    if (query.testId) {
      found = [...root.querySelectorAll('[data-testid], [data-test], [data-test-id]')]
        .filter((el) => ['data-testid', 'data-test', 'data-test-id'].some((name) => el.getAttribute(name) === query.testId))
    } else if (query.alt) {
      found = [...root.querySelectorAll('img[alt], input[type=image][alt]')]
        .filter((el) => norm(el.getAttribute('alt')).includes(norm(query.alt)))
    } else if (query.selector) {
      try { found = [...root.querySelectorAll(query.selector)] } catch (e) { found = [] }
    } else if (query.xpath) {
      try {
        const result = document.evaluate(query.xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        for (let i = 0; i < result.snapshotLength; i += 1) found.push(result.snapshotItem(i))
      } catch (e) { found = [] }
    } else {
      found = [...root.querySelectorAll('a,button,input,select,textarea,label,li,span,div,td,th,h1,h2,h3,h4,p,summary,[role]')]
    }
    for (const el of found) {
      if (!el || el.nodeType !== 1 || seen.has(el)) continue
      seen.add(el)
      if (el === document.body || el === document.documentElement) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue
      if (rect.width * rect.height > 600000) continue
      if (query.role && roleOf(el) !== String(query.role).toLowerCase()) continue
      const name = nameOf(el)
      if (query.name) {
        const exact = query.nameMatch === 'exact'
        if (exact ? name !== wantedName : !name.includes(wantedName)) continue
      }
      if (query.text) {
        const text = norm(el.innerText || el.value || '')
        const exact = query.textMatch === 'exact'
        if (exact ? text !== wantedText : !text.includes(wantedText)) continue
      }
      items.push({ el, label: name || norm(el.innerText), rect })
    }
  }
  for (const root of roots) collect(root)
  if (!items.length) return null
  let best = null
  if (typeof query.index === 'number' && query.index >= 0) {
    if (query.index >= items.length) return { missing: true, total: items.length }
    best = items[query.index]
  } else {
    items.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
    best = items[0]
  }
  let target = null
  const related = (best.el.getAttribute && best.el.getAttribute('for')) || ''
  if (related) {
    const input = document.getElementById(related)
    if (input) {
      const proxy = input.closest('.ui-radio') || input.closest('.ui-checkbox') || input.closest('label')
      target = proxy ? (proxy.querySelector('a.jqradio') || proxy.querySelector('a.jqcheck') || proxy.querySelector('label') || proxy) : input
      if (target === input && input.getBoundingClientRect().width < 2) {
        input.click()
        return { x: best.rect.left, y: best.rect.top, w: best.rect.width, h: best.rect.height, label: best.label.slice(0, 80), tag: 'input', dom: true, total: items.length }
      }
    }
  }
  if (!target) target = best.el.closest('a,button,input,select,textarea,label,summary,[role=button],[onclick]') || best.el
  const rect = target.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) {
    target.click()
    return { x: best.rect.left, y: best.rect.top, w: best.rect.width, h: best.rect.height, label: best.label.slice(0, 80), tag: target.tagName.toLowerCase(), dom: true, total: items.length }
  }
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const at = document.elementFromPoint(cx, cy)
  const cover = at && at !== target && !target.contains(at) && !at.contains(target)
    ? at.tagName.toLowerCase() + (at.className ? '.' + String(at.className).split(' ')[0] : '')
    : ''
  return {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
    label: best.label.slice(0, 80),
    tag: target.tagName.toLowerCase(),
    blocked: cover,
    total: items.length
  }
})`

const LABEL_FOCUS_SOURCE = `(function (text) {
  const norm = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  const wanted = norm(text)
  const focus = (el) => {
    if (!el) return false
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    el.focus()
    return true
  }
  for (const label of document.querySelectorAll('label')) {
    if (!norm(label.innerText).includes(wanted)) continue
    const forId = label.getAttribute('for')
    if (forId) {
      const input = document.getElementById(forId)
      if (input && focus(input)) return true
    }
    const inner = label.querySelector('input,textarea,select')
    if (inner && focus(inner)) return true
  }
  for (const input of document.querySelectorAll('input,textarea,select')) {
    const hints = [input.getAttribute('aria-label'), input.getAttribute('placeholder'), input.getAttribute('name'), input.getAttribute('title')]
    if (hints.some((hint) => hint && norm(hint).includes(wanted))) {
      if (focus(input)) return true
    }
  }
  return false
})`

export async function resolveHit(tab: TabRuntime, query: HitQuery, frame?: string): Promise<(TextHit & { total?: number }) | null> {
  await ensureActive(tab)
  const source = `(${HIT_SOURCE})(${JSON.stringify(query)})`
  const hit = (frame ? await evalInFrame(tab, source, frame) : await evalSource(tab, source)) as (TextHit & { total?: number; missing?: boolean }) | null
  if (!hit) return null
  if (hit.missing) throw new Error(mt('main.page.indexMissing', { total: hit.total ?? 0, index: (query.index ?? 0) + 1 }))
  if (frame && !hit.dom) {
    const offset = await frameOffset(tab, frame)
    hit.x += offset.x
    hit.y += offset.y
  }
  return hit
}

export async function clickHit(tab: TabRuntime, hit: TextHit, via: ActVia = 'cdp', offsetX = 0, offsetY = 0): Promise<void> {
  if (hit.blocked) throw new Error(mt('main.page.targetBlocked', { blocked: hit.blocked }))
  if (!hit.dom) await clickPoint(tab, hit.x + hit.w / 2 + offsetX, hit.y + hit.h / 2 + offsetY, via)
}

export async function hoverHit(tab: TabRuntime, hit: TextHit, via: ActVia = 'cdp'): Promise<void> {
  await hoverPoint(tab, hit.x + hit.w / 2, hit.y + hit.h / 2, undefined, via)
}

export async function typeByLabel(tab: TabRuntime, label: string, text: string): Promise<void> {
  await ensureActive(tab)
  const focused = await evalSource(tab, `(${LABEL_FOCUS_SOURCE})(${JSON.stringify(label)})`)
  if (focused !== true) throw new Error(mt('main.page.labelMissing', { label }))
  await typeByCdp(tab, text)
}

export async function clickRef(tab: TabRuntime, ref: string, via: ActVia = 'cdp'): Promise<{ role: string; name: string }> {
  await ensureActive(tab)
  const target = tab.refs.get(ref)
  if (!target || !target.backendNodeId) throw new Error(mt('main.page.refStale', { ref }))
  await clickKnown(tab, target, via)
  return { role: target.role, name: target.name }
}

export async function hoverRef(tab: TabRuntime, ref: string, via: ActVia = 'cdp'): Promise<{ role: string; name: string }> {
  await ensureActive(tab)
  const target = tab.refs.get(ref)
  if (!target || !target.backendNodeId) throw new Error(mt('main.page.refStale', { ref }))
  await hoverKnown(tab, target, via)
  return { role: target.role, name: target.name }
}

export async function typeRef(tab: TabRuntime, ref: string, text: string): Promise<{ role: string; name: string }> {
  await ensureActive(tab)
  const target = tab.refs.get(ref)
  if (!target || !target.backendNodeId) throw new Error(mt('main.page.refStale', { ref }))
  await focusResolved(tab, target)
  await typeByCdp(tab, text)
  return { role: target.role, name: target.name }
}

export async function elementBox(tab: TabRuntime, locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const source = `(() => {
    let el = null
    const selector = ${JSON.stringify(locator.selector || '')}
    const xpath = ${JSON.stringify(locator.xpath || '')}
    if (selector) { try { el = document.querySelector(selector) } catch (e) { el = null } }
    else if (xpath) {
      try { el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue } catch (e) { el = null }
    }
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  })()`
  const box = (await evalSource(tab, source)) as { x: number; y: number; width: number; height: number } | null
  if (!box) throw new Error(mt('main.page.noLabelBox', { label: locatorLabel(locator) }))
  return box
}

export type OverlayInfo = { kind: string; tag: string; id: string; cls: string; rect: { x: number; y: number; width: number; height: number }; src?: string }

export async function listOverlays(tab: TabRuntime): Promise<OverlayInfo[]> {
  const source = `(() => {
    const vw = innerWidth
    const vh = innerHeight
    const out = []
    const add = (kind, el, extra) => {
      const rect = el.getBoundingClientRect()
      out.push({
        kind,
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: String(el.className || '').slice(0, 80),
        rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        ...(extra || {})
      })
    }
    for (const frame of document.querySelectorAll('iframe')) {
      const rect = frame.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 40) continue
      if (rect.width * rect.height < vw * vh * 0.05) continue
      add('iframe', frame, { src: String(frame.src || '').slice(0, 120) })
    }
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      if (style.position !== 'fixed' && style.position !== 'sticky') continue
      const z = Number(style.zIndex)
      if (!(z >= 100)) continue
      if (style.pointerEvents === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height < vw * vh * 0.2) continue
      add('overlay', el, { z })
    }
    return out.slice(0, 20)
  })()`
  return (await evalSource(tab, source)) as OverlayInfo[]
}

export async function dismissOverlays(tab: TabRuntime): Promise<{ hidden: number; clicked: number }> {
  const source = `(() => {
    let hidden = 0
    let clicked = 0
    const hide = (el) => {
      if (!el) return
      el.style.setProperty('display', 'none', 'important')
      hidden += 1
    }
    for (const el of document.querySelectorAll('#aswift_0, #aswift_1, #aswift_2, #aswift_3, ins.adsbygoogle, [id^="aswift_"], [id^="google_ads"]')) hide(el)
    for (const el of document.querySelectorAll('.layui-layer-close, .modal .close, [aria-label="Close"], [aria-label="关闭"]')) { /* i18n-ignore 站点的关闭按钮文案 */
      try {
        el.click()
        clicked += 1
      } catch (e) { /* 点不到就算了 */ }
    }
    return { hidden, clicked }
  })()`
  return (await evalSource(tab, source)) as { hidden: number; clicked: number }
}
