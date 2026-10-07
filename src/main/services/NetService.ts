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

export type MockRule = {
  urlContains: string
  status?: number
  body?: string
  headers?: Record<string, string>
}

const mockRules = new Map<string, MockRule[]>()

export async function netMock(tabId: string, rules: MockRule[]): Promise<void> {
  const found = findTab(tabId)
  if (!found?.tab.view) throw new Error(`没有这个标签 ${tabId}`)
  const wc = found.tab.view.webContents
  const dbg = holdDebugger(wc)
  await dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  onDebuggerMessage(wc, (method, params) => {
    if (method !== 'Fetch.requestPaused') return
    void onPaused(tabId, wc, params as { requestId: string; request?: { url?: string } })
  })
  mockRules.set(tabId, rules)
}

export async function netMockOff(tabId: string): Promise<void> {
  mockRules.delete(tabId)
  const found = findTab(tabId)
  const wc = found?.tab.view?.webContents
  if (!wc?.debugger.isAttached()) return
  try {
    await wc.debugger.sendCommand('Fetch.disable')
  } catch {
    /* 调试器已断开 */
  }
  releaseDebugger(wc)
}

async function onPaused(tabId: string, wc: Electron.WebContents, params: { requestId: string; request?: { url?: string } }): Promise<void> {
  const url = params.request?.url ?? ''
  const rule = (mockRules.get(tabId) ?? []).find((item) => url.includes(item.urlContains))
  try {
    if (rule) {
      await wc.debugger.sendCommand('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: rule.status ?? 200,
        responseHeaders: Object.entries({ 'content-type': 'application/json; charset=utf-8', ...(rule.headers ?? {}) }).map(([name, value]) => ({ name, value })),
        body: Buffer.from(rule.body ?? '{}', 'utf8').toString('base64')
      })
    } else {
      await wc.debugger.sendCommand('Fetch.continueRequest', { requestId: params.requestId })
    }
  } catch {
    /* 请求已被页面取消 */
  }
}

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
