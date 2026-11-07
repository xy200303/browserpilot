import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_ENV,
  defaultSettings,
  type EnvInfo,
  type GroupInfo,
  type WorkflowApp,
  type HistoryEntry,
  type Settings
} from '@shared/types'
import { createId, rememberId } from '../ids'

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

  load(): void {
    mkdirSync(app.getPath('userData'), { recursive: true })
    mkdirSync(this.dir('screenshots'), { recursive: true })
    mkdirSync(this.dir('videos'), { recursive: true })
    mkdirSync(this.dir('runs'), { recursive: true })
    mkdirSync(this.dir('exports'), { recursive: true })
    this.envs = readJson<StoredEnv[]>('envs.json', [])
    if (!this.envs.some((e) => e.id === DEFAULT_ENV)) {
      this.envs.unshift({ id: DEFAULT_ENV, name: '默认', remark: '', sites: [] })
    }
    this.groups = readJson<StoredGroup[]>('groups.json', [])
    this.workflows = readJson<WorkflowApp[]>('workflows.json', []).filter(
      (item) => item?.kind === 'app' && item.app?.mode === 'workflow' && Array.isArray(item.workflow?.graph?.nodes)
    )
    this.runs = readJson<RunLog[]>('runs.json', [])
    this.history = readJson<HistoryEntry[]>('history.json', [])
      .filter((item) => item && typeof item.id === 'string' && typeof item.envId === 'string' && typeof item.url === 'string' && typeof item.title === 'string' && typeof item.visitedAt === 'number')
      .slice(0, 3000)
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
