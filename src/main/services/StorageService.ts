import { app } from 'electron'
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_ENV,
  defaultSettings,
  type EnvInfo,
  type GroupInfo,
  type WorkflowApp,
  type HistoryEntry,
  type BookmarkEntry,
  type PermissionRule,
  type SessionState,
  type Settings
} from '@shared/types'
import { createId, rememberId } from '../ids'
import { mt } from '../i18n'

export type StoredEnv = {
  id: string
  name: string
  remark: string
  sites: { domain: string; lastOpenedAt: number }[]
}

export type StoredGroup = {
  id: string
  envId: string
  name: string
  color: string
}

export type StoredPassword = {
  id: string
  envId: string
  origin: string
  username: string
  secret: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

type RunLog = {
  id: string
  workflowId: string
  at: number
  ok: boolean
  node?: string
  title?: string
  error?: string
  screenshot?: string
  outputs?: Record<string, unknown>
  files?: string[]
}

function file(name: string): string {
  return join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  const path = file(name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(name), JSON.stringify(value, null, 2), 'utf8')
}

export class StorageService {
  envs: StoredEnv[] = []
  groups: StoredGroup[] = []
  workflows: WorkflowApp[] = []
  runs: RunLog[] = []
  settings: Settings = defaultSettings()
  history: HistoryEntry[] = []
  bookmarks: BookmarkEntry[] = []
  permissions: PermissionRule[] = []
  passwords: StoredPassword[] = []
  sessions: Record<string, SessionState> = {}

  load(): void {
    mkdirSync(app.getPath('userData'), { recursive: true })
    mkdirSync(this.dir('screenshots'), { recursive: true })
    mkdirSync(this.dir('runs'), { recursive: true })
    mkdirSync(this.dir('exports'), { recursive: true })
    this.envs = readJson<StoredEnv[]>('envs.json', [])
    if (!this.envs.some((e) => e.id === DEFAULT_ENV)) {
      this.envs.unshift({ id: DEFAULT_ENV, name: mt('main.misc.defaultEnv'), remark: '', sites: [] })
    }
    this.groups = readJson<StoredGroup[]>('groups.json', [])
    this.workflows = readJson<WorkflowApp[]>('workflows.json', []).filter(
      (item) => item?.kind === 'app' && item.app?.mode === 'workflow' && Array.isArray(item.workflow?.graph?.nodes)
    )
    this.runs = readJson<RunLog[]>('runs.json', [])
    this.history = readJson<HistoryEntry[]>('history.json', [])
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.url === 'string' && typeof item.title === 'string' && typeof item.visitedAt === 'number')
      .slice(0, 3000)
    this.bookmarks = readJson<BookmarkEntry[]>('bookmarks.json', [])
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.url === 'string' && typeof item.title === 'string')
      .slice(0, 500)
    this.permissions = readJson<PermissionRule[]>('permissions.json', [])
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.origin === 'string' && typeof item.permission === 'string')
      .slice(0, 500)
    this.passwords = readJson<StoredPassword[]>('passwords.json', [])
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.origin === 'string' && typeof item.secret === 'string')
      .slice(0, 1000)
    this.sessions = readJson<Record<string, SessionState>>('session.json', {})
    this.settings = { ...defaultSettings(), ...readJson<Partial<Settings>>('settings.json', {}) }
    for (const env of this.envs) rememberId(env.id)
    for (const group of this.groups) rememberId(group.id)
    for (const item of this.workflows) rememberId(item.id)
  }

  saveEnvs(): void {
    writeJson('envs.json', this.envs)
  }

  saveGroups(): void {
    writeJson('groups.json', this.groups)
  }

  saveWorkflows(): void {
    writeJson('workflows.json', this.workflows)
  }

  saveSettings(): void {
    writeJson('settings.json', this.settings)
  }

  savePasswords(): void {
    writeJson('passwords.json', this.passwords)
    if (process.platform !== 'win32') {
      try {
        chmodSync(file('passwords.json'), 0o600)
      } catch {
        /* 文件系统不支持权限时忽略 */
      }
    }
  }

  addRun(run: RunLog): void {
    this.runs.unshift(run)
    this.runs = this.runs.slice(0, 200)
    writeJson('runs.json', this.runs)
  }

  addHistory(input: { envId: string; url: string; title: string; favicon?: string }): void {
    const now = Date.now()
    const last = this.history[0]
    if (last && last.envId === input.envId && last.url === input.url && now - last.visitedAt < 10_000) {
      last.title = input.title || last.title
      last.favicon = input.favicon || last.favicon
      last.visitedAt = now
    } else {
      this.history.unshift({
        id: createId('hist'),
        envId: input.envId,
        url: input.url,
        title: input.title || input.url,
        favicon: input.favicon,
        visitedAt: now
      })
      this.history = this.history.slice(0, 3000)
    }
    writeJson('history.json', this.history)
  }

  historyFor(envId: string): HistoryEntry[] {
    return this.history.filter((item) => item.envId === envId)
  }

  deleteHistory(id: string): void {
    const next = this.history.filter((item) => item.id !== id)
    if (next.length === this.history.length) return
    this.history = next
    writeJson('history.json', this.history)
  }

  clearHistory(envId: string): void {
    this.history = this.history.filter((item) => item.envId !== envId)
    writeJson('history.json', this.history)
  }

  removeHistoryWhere(envId: string, filter: { id?: string; url?: string; all?: boolean }): number {
    const before = this.history.length
    this.history = this.history.filter((item) => {
      if (item.envId !== envId) return true
      if (filter.all) return false
      if (filter.id) return item.id !== filter.id
      if (filter.url) return item.url !== filter.url
      return true
    })
    const removed = before - this.history.length
    if (removed) writeJson('history.json', this.history)
    return removed
  }

  bookmarksFor(envId: string): BookmarkEntry[] {
    return this.bookmarks.filter((item) => item.envId === envId)
  }

  toggleBookmark(input: { envId: string; url: string; title: string; favicon?: string }): boolean {
    const existing = this.bookmarks.find((item) => item.envId === input.envId && item.url === input.url)
    if (existing) {
      this.bookmarks = this.bookmarks.filter((item) => item.id !== existing.id)
      writeJson('bookmarks.json', this.bookmarks)
      return false
    }
    this.bookmarks.unshift({
      id: createId('bm'),
      envId: input.envId,
      url: input.url,
      title: input.title || input.url,
      favicon: input.favicon,
      createdAt: Date.now()
    })
    this.bookmarks = this.bookmarks.slice(0, 500)
    writeJson('bookmarks.json', this.bookmarks)
    return true
  }

  addBookmark(input: { envId: string; url: string; title?: string; favicon?: string }): BookmarkEntry {
    const existing = this.bookmarks.find((item) => item.envId === input.envId && item.url === input.url)
    if (existing) {
      existing.title = input.title || existing.title
      existing.favicon = input.favicon ?? existing.favicon
      writeJson('bookmarks.json', this.bookmarks)
      return existing
    }
    const entry: BookmarkEntry = {
      id: createId('bm'),
      envId: input.envId,
      url: input.url,
      title: input.title || input.url,
      favicon: input.favicon,
      createdAt: Date.now()
    }
    this.bookmarks.unshift(entry)
    this.bookmarks = this.bookmarks.slice(0, 500)
    writeJson('bookmarks.json', this.bookmarks)
    return entry
  }

  removeBookmarkWhere(envId: string, filter: { id?: string; url?: string; all?: boolean }): number {
    const before = this.bookmarks.length
    this.bookmarks = this.bookmarks.filter((item) => {
      if (item.envId !== envId) return true
      if (filter.all) return false
      if (filter.id) return item.id !== filter.id
      if (filter.url) return item.url !== filter.url
      return true
    })
    const removed = before - this.bookmarks.length
    if (removed) writeJson('bookmarks.json', this.bookmarks)
    return removed
  }

  removeBookmark(id: string): void {
    this.bookmarks = this.bookmarks.filter((item) => item.id !== id)
    writeJson('bookmarks.json', this.bookmarks)
  }

  clearBookmarks(envId: string): void {
    this.bookmarks = this.bookmarks.filter((item) => item.envId !== envId)
    writeJson('bookmarks.json', this.bookmarks)
  }

  permissionFor(envId: string, origin: string, permission: string): PermissionRule['decision'] | undefined {
    return this.permissions.find((item) => item.envId === envId && item.origin === origin && item.permission === permission)?.decision
  }

  setPermission(input: { envId: string; origin: string; permission: string; decision: PermissionRule['decision'] }): void {
    const existing = this.permissions.find((item) => item.envId === input.envId && item.origin === input.origin && item.permission === input.permission)
    if (existing) {
      existing.decision = input.decision
      existing.updatedAt = Date.now()
    } else {
      this.permissions.unshift({ id: createId('perm'), ...input, updatedAt: Date.now() })
      this.permissions = this.permissions.slice(0, 500)
    }
    writeJson('permissions.json', this.permissions)
  }

  permissionsFor(envId: string): PermissionRule[] {
    return this.permissions.filter((item) => item.envId === envId)
  }

  revokePermission(id: string): void {
    this.permissions = this.permissions.filter((item) => item.id !== id)
    writeJson('permissions.json', this.permissions)
  }

  clearPermissions(envId: string): void {
    this.permissions = this.permissions.filter((item) => item.envId !== envId)
    writeJson('permissions.json', this.permissions)
  }

  saveSession(envId: string, state: { tabs: SessionState['tabs']; activeUrl?: string }): void {
    this.sessions[envId] = { ...state, tabs: state.tabs.slice(0, 30), savedAt: Date.now() }
    writeJson('session.json', this.sessions)
  }

  sessionFor(envId: string): SessionState | undefined {
    return this.sessions[envId]
  }

  clearSession(envId: string): void {
    delete this.sessions[envId]
    writeJson('session.json', this.sessions)
  }

  dir(name: string): string {
    return join(app.getPath('userData'), name)
  }

  userData(): string {
    return app.getPath('userData')
  }
}

export function toEnvInfo(
  env: StoredEnv,
  windowOpen: boolean,
  headless: boolean,
  cookieDomains: Set<string>
): EnvInfo {
  return {
    id: env.id,
    name: env.name,
    remark: env.remark,
    isDefault: env.id === DEFAULT_ENV,
    windowOpen,
    headless,
    sites: env.sites.map((site) => ({
      ...site,
      cookiePresent: cookieDomains.has(site.domain)
    }))
  }
}

export function toGroupInfo(group: StoredGroup, tabIds: string[]): GroupInfo {
  return { ...group, tabIds }
}
