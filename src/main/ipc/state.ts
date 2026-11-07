import { app, session } from 'electron'
import { DEFAULT_ENV, type UiState } from '@shared/types'
import { workflowPage } from '@shared/market'
import type { StoredEnv } from '../services/StorageService'
import { storage } from '../services/store'
import { workflowParams } from '../services/RecordService'
import { listDownloads } from '../services/DownloadService'
import { netList } from '../services/NetService'
import { windows, type WindowRuntime } from '../runtime'

async function cookieDomains(envId: string): Promise<Set<string>> {
  const cookies = await session.fromPartition(`persist:${envId}`).cookies.get({})
  return new Set(cookies.flatMap((cookie) => (cookie.domain ? [cookie.domain.replace(/^\./, '')] : [])))
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

export async function buildState(runtime: WindowRuntime): Promise<UiState> {
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)
  const nav = active?.view?.webContents.navigationHistory
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
          ? '设置'
          : tab.kind === 'market'
            ? '工作流'
            : tab.kind === 'history'
              ? '历史记录'
              : tab.kind === 'bookmarks'
                ? '书签'
                : tab.kind === 'workflow'
                  ? (storage.workflows.find((item) => tab.url === workflowPage(item.id))?.app.name ?? tab.title)
                  : tab.title || '新标签页',
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
      graph: item.workflow.graph
    })),
    captures: active ? netList(active.id) : [],
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

export function broadcast(envId?: string): void {
  const list = envId ? [windows.get(envId)].filter((item): item is WindowRuntime => Boolean(item)) : [...windows.values()]
  for (const runtime of list) {
    void buildState(runtime).then((state) => {
      if (!runtime.win.isDestroyed()) runtime.win.webContents.send('state', state)
      if (runtime.popupView && !runtime.popupView.webContents.isDestroyed()) runtime.popupView.webContents.send('state', state)
      if (runtime.railView && !runtime.railView.webContents.isDestroyed()) runtime.railView.webContents.send('state', state)
    })
  }
}
