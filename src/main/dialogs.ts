import type { WebContents } from 'electron'
import { holdDebugger, onDebuggerMessage } from './services/debugger'
import { recordConsole } from './console-log'

export type PageDialog = {
  type: string
  message: string
  defaultPrompt?: string
  url: string
  at: number
  answer: 'accept' | 'dismiss'
}

type State = {
  wc: WebContents
  tabId: string
  enabled: boolean
  accept: boolean
  once?: boolean
  promptText?: string
  pending?: PageDialog
  recent: PageDialog[]
}

const states = new Map<string, State>()

function answerOf(state: State): boolean {
  const accept = state.once === undefined ? state.accept : state.once
  state.once = undefined
  return accept
}

export function watchDialogs(wc: WebContents, tabId: string): void {
  if (states.has(tabId)) return
  const state: State = { wc, tabId, enabled: false, accept: false, recent: [] }
  states.set(tabId, state)
  holdDebugger(wc)
  onDebuggerMessage(wc, (method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      const details = (params as { exceptionDetails?: { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } } }).exceptionDetails
      if (!details) return
      const description = details.exception?.description ?? details.text ?? 'Uncaught'
      recordConsole(state.wc, {
        level: 'error',
        message: 'Uncaught ' + description.split('\n')[0],
        line: (details.lineNumber ?? 0) + 1,
        source: details.url,
        stack: description,
        at: Date.now()
      })
      return
    }
    if (method !== 'Page.javascriptDialogOpening') return
    const raw = params as { type?: string; message?: string; defaultPrompt?: string; url?: string }
    const type = String(raw.type ?? 'alert')
    const accept = answerOf(state)
    const dialog: PageDialog = {
      type,
      message: String(raw.message ?? ''),
      defaultPrompt: raw.defaultPrompt,
      url: String(raw.url ?? ''),
      at: Date.now(),
      answer: accept ? 'accept' : 'dismiss'
    }
    // 不答就会把渲染进程卡住，连触发弹窗的那次点击都返回不了，所以立刻按策略回掉
    void state.wc.debugger
      .sendCommand('Page.handleJavaScriptDialog', {
        accept,
        ...(type === 'prompt' && accept ? { promptText: state.promptText ?? dialog.defaultPrompt ?? '' } : {})
      })
      .then(() => {
        state.pending = undefined
      })
      .catch(() => {
        state.pending = dialog
      })
    state.recent.unshift(dialog)
    state.recent = state.recent.slice(0, 20)
  })
  // 页面加载完成后再开 Page 域。建标签时就发 Page.enable 会一直不返回。
  const enable = (): void => {
    if (state.enabled) return
    state.enabled = true
    void wc.debugger.sendCommand('Page.enable').catch(() => {
      state.enabled = false
    })
    void wc.debugger.sendCommand('Runtime.enable').catch(() => undefined)
  }
  wc.on('dom-ready', enable)
  wc.on('did-finish-load', enable)
  wc.once('destroyed', () => states.delete(tabId))
}

export function pendingDialog(tabId: string): PageDialog | undefined {
  return states.get(tabId)?.pending
}

export function recentDialogs(tabId: string): PageDialog[] {
  return states.get(tabId)?.recent ?? []
}

export function dialogPolicy(tabId: string): { accept: boolean; once?: boolean } | undefined {
  const state = states.get(tabId)
  if (!state) return undefined
  return { accept: state.accept, once: state.once }
}

export function setDialogPolicy(tabId: string, accept: boolean, once = false, promptText?: string): boolean {
  const state = states.get(tabId)
  if (!state) return false
  if (once) state.once = accept
  else {
    state.accept = accept
    state.once = undefined
  }
  state.promptText = promptText
  return true
}

export async function answerPendingDialog(tabId: string, accept: boolean, promptText?: string): Promise<PageDialog | undefined> {
  const state = states.get(tabId)
  if (!state?.pending) return undefined
  const dialog = state.pending
  await state.wc.debugger.sendCommand('Page.handleJavaScriptDialog', {
    accept,
    ...(dialog.type === 'prompt' && accept ? { promptText: promptText ?? dialog.defaultPrompt ?? '' } : {})
  })
  state.pending = undefined
  return dialog
}

export function clearPendingDialog(tabId: string): void {
  const state = states.get(tabId)
  if (state) state.pending = undefined
}
