import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { rm } from 'fs/promises'
import { readJsonOr, writeJsonAtomic } from './json-file'
import { listWorkflows, migrateLegacyWorkflows } from './workflow-store'
import { migrateEnvProfiles } from './env-migration'
import { envDataDir, forgetOrphan, listOrphans, profileRoot } from './env-path'
import { insertRun, listRuns, migrateRunsJson, trimRuns, type StoredRun } from './run-store'
import {
  deleteHistory as deleteHistoryRows,
  insertHistory,
  listHistory,
  migrateGlobalHistoryJson,
  migrateHistoryJson,
  refreshHistory,
  trimHistory,
  type StoredHistory
} from './history-store'
import {
  DEFAULT_ENV,
  defaultSettings,
  type EnvInfo,
  type GroupInfo,
  type HistoryEntry,
  type BookmarkEntry,
  type PermissionRule,
  type SessionState,
  type Settings
} from '@shared/types'
import { createId, rememberId } from '../ids'
import { mt } from '../i18n'

/** 按环境分目录存储的几类用户数据。 */
type ScopedCollection = 'bookmarks' | 'permissions' | 'passwords' | 'session'

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

type RunLog = StoredRun

function file(name: string): string {
  return join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  return readJsonOr(file(name), fallback)
}

function writeJson(name: string, value: unknown): void {
  writeJsonAtomic(file(name), value)
}

/**
 * 读数组：文件里是合法 JSON 但不是数组时（手改坏了、被别的版本写过），
 * 不能让它把启动整个带崩——记一条日志，当空处理。
 */
function readArray<T>(name: string): T[] {
  const value = readJson<unknown>(name, [])
  if (Array.isArray(value)) return value as T[]
  if (existsSync(file(name))) console.warn(`[storage] ${name} is not an array, ignoring its content`)
  return []
}

export class StorageService {
  envs: StoredEnv[] = []
  groups: StoredGroup[] = []
  runs: RunLog[] = []
  settings: Settings = defaultSettings()
  history: HistoryEntry[] = []
  bookmarks: BookmarkEntry[] = []
  permissions: PermissionRule[] = []
  passwords: StoredPassword[] = []
  sessions: Record<string, SessionState> = {}

  /** 上一次写进磁盘的内容，用来跳过没变化的重复写盘（历史每导航一次就存一次） */
  private scopedCache = new Map<string, string>()

  private scopedItems(name: ScopedCollection): Array<{ envId: string }> {
    if (name === 'bookmarks') return this.bookmarks
    if (name === 'permissions') return this.permissions
    return this.passwords
  }

  /**
   * 按环境落盘：每套环境一个文件，写在 `profiles\<env>\browserpilot\<name>.json`。
   * 内容没变的环境直接跳过，避免每次导航都把十几套环境的历史全写一遍。
   */
  private saveScoped(name: ScopedCollection): void {
    if (name === 'session') {
      for (const [envId, state] of Object.entries(this.sessions)) {
        const text = JSON.stringify(state, null, 2)
        const key = `session\u0000${envId}`
        if (this.scopedCache.get(key) === text) continue
        writeJsonAtomic(join(envDataDir(envId), 'session.json'), state)
        this.scopedCache.set(key, text)
      }
      return
    }
    const byEnv = new Map<string, Array<{ envId: string }>>()
    for (const env of this.envs) byEnv.set(env.id, [])
    for (const item of this.scopedItems(name)) {
      const list = byEnv.get(item.envId)
      if (list) list.push(item)
      else byEnv.set(item.envId, [item])
    }
    for (const [envId, list] of byEnv) {
      const text = JSON.stringify(list, null, 2)
      const key = `${name}\u0000${envId}`
      if (this.scopedCache.get(key) === text) continue
      const target = join(envDataDir(envId), `${name}.json`)
      writeJsonAtomic(target, list)
      this.scopedCache.set(key, text)
      if (name === 'passwords' && process.platform !== 'win32') {
        try {
          chmodSync(target, 0o600)
        } catch {
          /* 文件系统不支持权限时忽略 */
        }
      }
    }
  }

  /** 读某个集合：先读每套环境自己的文件，再叠加还没迁移的老全局文件。 */
  private loadScoped<T>(name: ScopedCollection): T[] {
    const out: T[] = []
    for (const env of this.envs) {
      const list = readJsonOr<unknown>(join(envDataDir(env.id), `${name}.json`), [])
      if (Array.isArray(list)) out.push(...(list as T[]))
    }
    const legacy = file(`${name}.json`)
    if (existsSync(legacy)) {
      const raw = readJsonOr<unknown>(legacy, [])
      if (Array.isArray(raw)) out.push(...(raw as T[]))
    }
    return out
  }

  private loadSessions(): Record<string, SessionState> {
    const out: Record<string, SessionState> = {}
    for (const env of this.envs) {
      const state = readJsonOr<SessionState | null>(join(envDataDir(env.id), 'session.json'), null)
      if (state && Array.isArray(state.tabs)) out[env.id] = state
    }
    if (existsSync(file('session.json'))) {
      const legacy = readJsonOr<Record<string, SessionState>>('session.json', {})
      for (const [envId, state] of Object.entries(legacy)) {
        if (!out[envId] && state && Array.isArray(state.tabs)) out[envId] = state
      }
    }
    return out
  }

  /**
   * 把老的全局 JSON 按 envId 拆进各自 profile，然后把原文件改名成 `.migrated`。
   * 必须在 loadScoped 之后调用——那时候数据已经在内存里了。
   */
  private migrateLegacyScopedFiles(): void {
    const names: ScopedCollection[] = ['bookmarks', 'permissions', 'passwords', 'session']
    for (const name of names) {
      const legacy = file(`${name}.json`)
      if (!existsSync(legacy)) continue
      this.saveScoped(name)
      try {
        renameSync(legacy, `${legacy}.migrated`)
      } catch (error) {
        console.error(`[storage] could not rename ${name}.json after splitting`, error)
      }
    }
  }

  load(): void {
    mkdirSync(app.getPath('userData'), { recursive: true })
    mkdirSync(this.dir('screenshots'), { recursive: true })
    mkdirSync(this.dir('runs'), { recursive: true })
    mkdirSync(this.dir('exports'), { recursive: true })
    this.envs = readArray<StoredEnv>('envs.json')
    if (!this.envs.some((e) => e.id === DEFAULT_ENV)) {
      this.envs.unshift({ id: DEFAULT_ENV, name: mt('main.misc.defaultEnv'), remark: '', sites: [] })
    }
    this.groups = readArray<StoredGroup>('groups.json')
    // 运行记录换成 SQLite，老的 runs.json 在这里一次性导入
    const movedRuns = migrateRunsJson(file('runs.json'))
    if (movedRuns.moved) console.log(`[runs] migrated ${movedRuns.moved} runs into runs.db`)
    this.runs = listRuns()
    // 历史换 SQLite：先把老的 JSON 搬进各自的库，再读出来
    for (const env of this.envs) {
      const skippedGlobal = migrateHistoryJson(env.id, join(envDataDir(env.id), 'history.json'))
      if (skippedGlobal.moved) console.log(`[history] migrated ${skippedGlobal.moved} rows for ${env.id}`)
    }
    const movedHistory = migrateGlobalHistoryJson(file('history.json'))
    if (movedHistory.moved) console.log(`[history] migrated ${movedHistory.moved} rows from the old global file`)
    this.history = this.envs
      .flatMap((env) => (existsSync(join(envDataDir(env.id), 'history.db')) ? listHistory(env.id) : []))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, 3000)
    this.bookmarks = this.loadScoped<BookmarkEntry>('bookmarks')
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.url === 'string' && typeof item.title === 'string')
      .slice(0, 500)
    this.permissions = this.loadScoped<PermissionRule>('permissions')
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.origin === 'string' && typeof item.permission === 'string')
      .slice(0, 500)
    this.passwords = this.loadScoped<StoredPassword>('passwords')
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.origin === 'string' && typeof item.secret === 'string')
      .slice(0, 1000)
    this.sessions = this.loadSessions()
    this.settings = { ...defaultSettings(), ...readJson<Partial<Settings>>('settings.json', {}) }
    for (const env of this.envs) rememberId(env.id)
    for (const group of this.groups) rememberId(group.id)
    // 会话目录搬家：Partitions\<env> → profiles\<env>，必须赶在任何窗口打开之前
    const migration = migrateEnvProfiles(this.envs.map((env) => env.id))
    if (migration.moved.length) console.log(`[env] migrated ${migration.moved.length} partition dirs into profiles/`)
    if (migration.errors.length) console.error('[env] migration errors', migration.errors)
    if (migration.orphans.length) console.warn('[env] orphan partition dirs (kept on disk)', migration.orphans)
    // 用户数据也按环境分目录：老的全局 JSON 在这里拆开
    this.migrateLegacyScopedFiles()
    // 上次没删掉的 profile 目录：开机再试一次，失败就留到下次，不阻塞启动
    for (const orphanId of listOrphans()) {
      if (this.envs.some((env) => env.id === orphanId)) {
        forgetOrphan(orphanId)
        continue
      }
      void rm(profileRoot(orphanId), { recursive: true, force: true, maxRetries: 2, retryDelay: 200 })
        .then(() => forgetOrphan(orphanId))
        .catch(() => undefined)
    }
    // 工作流现在是一文件一份，老的 workflows.json 在这里一次性拆开
    const migrated = migrateLegacyWorkflows()
    if (migrated.moved) console.log(`[workflow] migrated ${migrated.moved} workflows into workflows/`)
    for (const line of migrated.renamed) console.warn(`[workflow] slug collision, suffixed: ${line}`)
    for (const item of listWorkflows()) rememberId(item.id)
  }

  saveEnvs(): void {
    writeJson('envs.json', this.envs)
  }

  saveGroups(): void {
    writeJson('groups.json', this.groups)
  }

  saveSettings(): void {
    writeJson('settings.json', this.settings)
  }

  savePasswords(): void {
    // 权限收紧在 saveScoped 里按文件做
    this.saveScoped('passwords')
  }

  addRun(run: RunLog): void {
    insertRun(run)
    trimRuns()
    this.runs.unshift(run)
    this.runs = this.runs.slice(0, 200)
  }

  addHistory(input: { envId: string; url: string; title: string; favicon?: string }): void {
    const now = Date.now()
    const last = this.history[0]
    if (last && last.envId === input.envId && last.url === input.url && now - last.visitedAt < 10_000) {
      last.title = input.title || last.title
      last.favicon = input.favicon || last.favicon
      last.visitedAt = now
      refreshHistory(input.envId, last.id, { title: input.title || undefined, favicon: input.favicon, visitedAt: now })
      return
    }
    const entry: StoredHistory = {
      id: createId('hist'),
      envId: input.envId,
      url: input.url,
      title: input.title || input.url,
      favicon: input.favicon,
      visitedAt: now
    }
    this.history.unshift(entry)
    this.history = this.history.slice(0, 3000)
    insertHistory(entry)
    trimHistory(input.envId)
  }

  historyFor(envId: string): HistoryEntry[] {
    return this.history.filter((item) => item.envId === envId)
  }

  deleteHistory(id: string): void {
    const found = this.history.find((item) => item.id === id)
    const next = this.history.filter((item) => item.id !== id)
    if (next.length === this.history.length) return
    this.history = next
    if (found) deleteHistoryRows(found.envId, { id })
  }

  clearHistory(envId: string): void {
    this.history = this.history.filter((item) => item.envId !== envId)
    deleteHistoryRows(envId, { all: true })
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
    if (removed) deleteHistoryRows(envId, filter)
    return removed
  }

  bookmarksFor(envId: string): BookmarkEntry[] {
    return this.bookmarks.filter((item) => item.envId === envId)
  }

  toggleBookmark(input: { envId: string; url: string; title: string; favicon?: string }): boolean {
    const existing = this.bookmarks.find((item) => item.envId === input.envId && item.url === input.url)
    if (existing) {
      this.bookmarks = this.bookmarks.filter((item) => item.id !== existing.id)
      this.saveScoped('bookmarks')
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
    this.saveScoped('bookmarks')
    return true
  }

  addBookmark(input: { envId: string; url: string; title?: string; favicon?: string }): BookmarkEntry {
    const existing = this.bookmarks.find((item) => item.envId === input.envId && item.url === input.url)
    if (existing) {
      existing.title = input.title || existing.title
      existing.favicon = input.favicon ?? existing.favicon
      this.saveScoped('bookmarks')
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
    this.saveScoped('bookmarks')
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
    if (removed) this.saveScoped('bookmarks')
    return removed
  }

  removeBookmark(id: string): void {
    this.bookmarks = this.bookmarks.filter((item) => item.id !== id)
    this.saveScoped('bookmarks')
  }

  clearBookmarks(envId: string): void {
    this.bookmarks = this.bookmarks.filter((item) => item.envId !== envId)
    this.saveScoped('bookmarks')
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
    this.saveScoped('permissions')
  }

  permissionsFor(envId: string): PermissionRule[] {
    return this.permissions.filter((item) => item.envId === envId)
  }

  revokePermission(id: string): void {
    this.permissions = this.permissions.filter((item) => item.id !== id)
    this.saveScoped('permissions')
  }

  clearPermissions(envId: string): void {
    this.permissions = this.permissions.filter((item) => item.envId !== envId)
    this.saveScoped('permissions')
  }

  saveSession(envId: string, state: { tabs: SessionState['tabs']; activeUrl?: string }): void {
    this.sessions[envId] = { ...state, tabs: state.tabs.slice(0, 30), savedAt: Date.now() }
    this.saveScoped('session')
  }

  sessionFor(envId: string): SessionState | undefined {
    return this.sessions[envId]
  }

  clearSession(envId: string): void {
    delete this.sessions[envId]
    this.saveScoped('session')
  }

  /** 各目录占用（字节）：设置页的「存储」区块和诊断用。 */
  diskUsage(): Record<'screenshots' | 'runs' | 'media' | 'exports' | 'partitions' | 'cache', number> {
    const measure = (dir: string): number => {
      let total = 0
      const walk = (path: string): void => {
        let entries: string[] = []
        try {
          entries = readdirSync(path)
        } catch {
          return
        }
        for (const name of entries) {
          const full = join(path, name)
          try {
            const stat = statSync(full)
            if (stat.isDirectory()) walk(full)
            else total += stat.size
          } catch {
            /* 文件刚被删 */
          }
        }
      }
      walk(dir)
      return total
    }
    return {
      screenshots: measure(this.dir('screenshots')),
      runs: measure(this.dir('runs')),
      media: measure(this.dir('media')),
      exports: measure(this.dir('exports')),
      // 环境数据：老布局在 Partitions\，新布局在 profiles\，迁移期两者都算
      partitions: measure(this.dir('Partitions')) + measure(this.dir('profiles')),
      cache: measure(this.dir('Cache')) + measure(this.dir('Code Cache')) + measure(this.dir('GrShaderCache')) + measure(this.dir('GPUCache'))
    }
  }

  /**
   * 保留策略：截图最多 120 张、不超过 80MB 且只留 14 天；runs/media 只留 30 天。
   * 只动这些可再生成的目录，不碰登录数据、导出和下载。
   */
  pruneStorage(_scope: 'auto' | 'all' = 'all'): { files: number; bytes: number } {
    let files = 0
    let bytes = 0
    const remove = (path: string, size: number): void => {
      try {
        unlinkSync(path)
        files += 1
        bytes += size
      } catch {
        /* 已经删掉 */
      }
    }
    const olderThan = (dir: string, days: number): void => {
      const cutoff = Date.now() - days * 86_400_000
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const name of entries) {
        const full = join(dir, name)
        try {
          const stat = statSync(full)
          if (stat.isFile() && stat.mtimeMs < cutoff) remove(full, stat.size)
        } catch {
          /* 刚被删 */
        }
      }
    }
    const shots: Array<{ path: string; size: number; mtime: number }> = []
    const shotCutoff = Date.now() - 14 * 86_400_000
    try {
      for (const name of readdirSync(this.dir('screenshots'))) {
        const full = join(this.dir('screenshots'), name)
        try {
          const stat = statSync(full)
          if (!stat.isFile()) continue
          if (stat.mtimeMs < shotCutoff) {
            remove(full, stat.size)
            continue
          }
          shots.push({ path: full, size: stat.size, mtime: stat.mtimeMs })
        } catch {
          /* 刚被删 */
        }
      }
    } catch {
      /* 目录还没建 */
    }
    shots.sort((a, b) => a.mtime - b.mtime)
    let total = shots.reduce((sum, shot) => sum + shot.size, 0)
    let count = shots.length
    for (const shot of shots) {
      if (count <= 120 && total <= 80 * 1024 * 1024) break
      remove(shot.path, shot.size)
      total -= shot.size
      count -= 1
    }
    // 运行记录、旧版遗留的 media/videos 也能再生成；导出和下载属于用户素材，不动
    olderThan(this.dir('runs'), 30)
    olderThan(this.dir('media'), 30)
    olderThan(this.dir('videos'), 30)
    return { files, bytes }
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
