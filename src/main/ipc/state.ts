import { app, session } from 'electron'
import { DEFAULT_ENV, type UiState } from '@shared/types'
import { workflowPage } from '@shared/market'
import type { StoredEnv } from '../services/StorageService'
import { storage } from '../services/store'
import { workflowParams } from '../services/RecordService'
import { listDownloads } from '../services/DownloadService'
import { netList } from '../services/NetService'
import { windows, type WindowRuntime } from '../runtime'
import { mt } from '../i18n'

const cookieCache = new Map<string, { at: number; domains: Set<string> }>()

async function cookieDomains(envId: string): Promise<Set<string>> {
  const cached = cookieCache.get(envId)
  if (cached && Date.now() - cached.at < 5_000) return cached.domains
  const cookies = await session.fromPartition(`persist:${envId}`).cookies.get({})
  const domains = new Set(cookies.flatMap((cookie) => (cookie.domain ? [cookie.domain.replace(/^\./, '')] : [])))
  cookieCache.set(envId, { at: Date.now(), domains })
  return domains
}

async function envView(item: StoredEnv): Promise<UiState['envs'][number]> {
  const domains = windows.has(item.id) ? await cookieDomains(item.id) : new Set<string>()
  return {
    id: item.id,
    name: item.name,
    remark: item.remark,
    isDefault: item.id === DEFAULT_ENV,
    windowOpen: windows.has(item.id),
    headless: windows.get(item.id)?.headless ?? false,
    sites: item.sites.map((site) => ({
      ...site,
      cookiePresent: [...domains].some((domain) => domain === site.domain || domain.endsWith(`.${site.domain}`))
    }))
  }
}

export async function buildState(runtime: WindowRuntime, full = true): Promise<UiState> {
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  const nav = active?.view?.webContents.navigationHistory
  // 普通浏览时只发轻状态；工作流图、抓包正文这类重字段等真正打开对应页面再发
  const heavy = full || active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow'
  return {
    envId: runtime.envId,
    envName: storage.envs.find((item) => item.id === runtime.envId)?.name ?? runtime.envId,
    headless: runtime.headless,
    layout: storage.settings.tabLayout,
    tabs: runtime.tabs.map((tab) => ({
      id: tab.id,
      envId: tab.envId,
      groupId: tab.groupId,
      kind: tab.kind,
      title:
        tab.kind === 'settings'
          ? mt('address.kind.settings')
          : tab.kind === 'market'
            ? mt('address.kind.market')
            : tab.kind === 'history'
              ? mt('address.kind.history')
              : tab.kind === 'bookmarks'
                ? mt('address.kind.bookmarks')
                : tab.kind === 'workflow'
                  ? (storage.workflows.find((item) => tab.url === workflowPage(item.id))?.app.name ?? tab.title)
                  : tab.title || mt('shell.tabs.untitled'),
      url: tab.url,
      favicon: tab.favicon || '',
      loading: tab.loading,
      progress: tab.progress,
      error: tab.error,
      active: tab.id === runtime.activeTabId,
      pinned: Boolean(tab.pinned),
      muted: Boolean(tab.muted),
      audible: Boolean(tab.audible),
      hibernated: Boolean(tab.hibernated),
      control: tab.control === 'handoff' ? 'handoff' : tab.control === 'agent' ? 'agent' : 'shared'
    })),
    groups: storage.groups
      .filter((group) => group.envId === runtime.envId)
      .map((group) => ({
        ...group,
        tabIds: runtime.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id)
      })),
    envs: await Promise.all(storage.envs.map((item) => envView(item))),
    workflows: storage.workflows.map((item) => ({
      id: item.id,
      name: item.app.name,
      remark: item.app.description,
      icon: item.app.icon || '',
      params: workflowParams(item),
      graph: heavy ? item.workflow.graph : { nodes: [], edges: [] }
    })),
    captures: heavy && active ? netList(active.id) : [],
    canBack: Boolean(nav?.canGoBack()),
    canForward: Boolean(nav?.canGoForward()),
    screenRecording: runtime.screenRecording,
    handoffMessage: active?.control === 'handoff' ? active.handoffMessage : '',
    settings: storage.settings,
    bookmarks: storage.bookmarksFor(runtime.envId),
    permissions: storage.permissionsFor(runtime.envId),
    version: app.getVersion(),
    maximized: runtime.win.isMaximized(),
    railPinned: runtime.railPinned,
    downloads: listDownloads()
  }
}

let stateTimer: ReturnType<typeof setTimeout> | null = null
const pendingEnvs = new Set<string>()
let pendingAll = false

async function flushState(runtime: WindowRuntime): Promise<void> {
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  const full = active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow'
  const state = await buildState(runtime, full)
  if (runtime.win.isDestroyed()) return
  runtime.win.webContents.send('state', state)
  if (runtime.popupOpen && runtime.popupView && !runtime.popupView.webContents.isDestroyed()) {
    runtime.popupView.webContents.send('state', state)
  }
  if ((runtime.railOpen || runtime.railPinned) && runtime.railView && !runtime.railView.webContents.isDestroyed()) {
    runtime.railView.webContents.send('state', state)
  }
}

/**
 * 一次页面加载会连续触发标题、favicon、进度、加载完成等事件，
 * 80ms 内合并成一次状态构建，避免同一份状态被重复序列化给三四个渲染进程。
 */
export function broadcast(envId?: string): void {
  if (envId) pendingEnvs.add(envId)
  else pendingAll = true
  if (stateTimer) return
  stateTimer = setTimeout(() => {
    stateTimer = null
    const all = pendingAll
    const ids = [...pendingEnvs]
    pendingEnvs.clear()
    pendingAll = false
    const list = all ? [...windows.values()] : ids.map((id) => windows.get(id)).filter((item): item is WindowRuntime => Boolean(item))
    for (const runtime of list) void flushState(runtime)
  }, 80)
  stateTimer.unref?.()
}
