import { randomBytes } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CaptureInfo } from '@shared/types'
import { createId } from '../ids'
import { findTab } from '../runtime'
import { holdDebugger, onDebuggerMessage, releaseDebugger } from './debugger'

export type Capture = CaptureInfo & {
  requestHeaders: Record<string, string>
  responseHeaders?: Record<string, string>
  body?: string
}

const captures = new Map<string, Capture[]>()
const watching = new Set<string>()
const requestTab = new Map<string, string>()

function listOf(tabId: string): Capture[] {
  let list = captures.get(tabId)
  if (!list) {
    list = []
    captures.set(tabId, list)
  }
  return list
}

export function isWatching(tabId: string): boolean {
  return watching.has(tabId)
}

export async function netStart(tabId: string): Promise<void> {
  const found = findTab(tabId)
  if (!found?.tab.view) throw new Error(`没有这个标签 ${tabId}`)
  if (watching.has(tabId)) return
  const wc = found.tab.view.webContents
  const dbg = holdDebugger(wc)
  await dbg.sendCommand('Network.enable')
  onDebuggerMessage(wc, (method, params) => onMessage(tabId, method, params))
  watching.add(tabId)
}

export function netStop(tabId: string): void {
  const found = findTab(tabId)
  watching.delete(tabId)
  if (found?.tab.view) releaseDebugger(found.tab.view.webContents)
}

export function netList(tabId: string, urlContains?: string): CaptureInfo[] {
  return listOf(tabId)
    .filter((item) => !urlContains || item.url.includes(urlContains))
    .map(({ requestHeaders: _h, responseHeaders: _r, body: _b, ...info }) => info)
}

export function netGet(reqId: string): Capture | undefined {
  for (const list of captures.values()) {
    const found = list.find((item) => item.id === reqId)
    if (found) return found
  }
  return undefined
}

export function netExport(tabId: string, dir: string): string {
  const entries = listOf(tabId).map((item) => ({
    startedDateTime: new Date().toISOString(),
    request: {
      method: item.method,
      url: item.url,
      headers: Object.entries(item.requestHeaders).map(([name, value]) => ({ name, value }))
    },
    response: {
      status: item.status ?? 0,
      statusText: '',
      headers: Object.entries(item.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
      content: { mimeType: item.mimeType ?? '', text: item.body ?? '' }
    },
    time: 0
  }))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `net-${randomBytes(4).toString('hex')}.har`)
  writeFileSync(path, JSON.stringify({ log: { version: '1.2', creator: { name: 'BrowserPilot', version: '0.1.0' }, entries } }, null, 2))
  return path
}

function onMessage(tabId: string, method: string, params: unknown): void {
  if (!watching.has(tabId)) return
  const data = params as {
    requestId?: string
    type?: string
    request?: { method?: string; url?: string; headers?: Record<string, string> }
    response?: { status?: number; mimeType?: string; headers?: Record<string, string> }
  }
  if (method === 'Network.requestWillBeSent' && data.requestId && data.request?.url) {
    requestTab.set(data.requestId, tabId)
    const list = listOf(tabId)
    list.unshift({
      id: createId('req'),
      tabId,
      method: data.request.method ?? 'GET',
      url: data.request.url,
      resourceType: data.type ?? 'Other',
      requestHeaders: data.request.headers ?? {}
    })
    if (list.length > 500) list.pop()
    const created = list[0]
    requestOwners.set(data.requestId, created.id)
  }
  if (method === 'Network.responseReceived' && data.requestId && data.response) {
    const id = requestOwners.get(data.requestId)
    const item = listOf(tabId).find((entry) => entry.id === id)
    if (!item) return
    item.status = data.response.status
    item.mimeType = data.response.mimeType
    item.responseHeaders = data.response.headers
    const mime = item.mimeType ?? ''
    if (mime.includes('json') || mime.startsWith('text/')) {
      void pullBody(tabId, data.requestId, item)
    }
  }
}

const requestOwners = new Map<string, string>()

async function pullBody(tabId: string, requestId: string, item: Capture): Promise<void> {
  const found = findTab(tabId)
  const wc = found?.tab.view?.webContents
  if (!wc?.debugger.isAttached()) return
  try {
    const body = (await wc.debugger.sendCommand('Network.getResponseBody', { requestId })) as {
      body: string
      base64Encoded: boolean
    }
    const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
    if (text.length <= 1024 * 1024) item.body = text
  } catch {
    /* body evicted */
  }
}
