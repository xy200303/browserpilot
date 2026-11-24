import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { WorkflowApp } from '@shared/types'
import { readJsonOr, writeJsonAtomic } from './json-file'
import { mt } from '../i18n'

/**
 * 工作流一文件一份：`<userData>/workflows/<slug>.json`。
 * slug 是身份也是文件名——rename（改显示名）不动文件，同一 slug 再装一次就是覆盖。
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_SLUG = 64

export function workflowsDir(): string {
  return join(app.getPath('userData'), 'workflows')
}

export function isWorkflowSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

/** 纯 ASCII 名字走 kebab-case；含中文等非 ASCII 的一律用稳定哈希，避免"BOOS"和"BOSS 直聘"撞成同一个。 */
export function slugFromName(name: string): string {
  if (/^[\x20-\x7e]+$/.test(name)) {
    const ascii = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG)
    if (SLUG_PATTERN.test(ascii)) return ascii
  }
  return `wf-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`
}

type Entry = { app: WorkflowApp; mtime: number }

let cache: Map<string, Entry> | null = null
let cacheStamp = -1

function dirStamp(): number {
  try {
    return statSync(workflowsDir()).mtimeMs
  } catch {
    return 0
  }
}

function loadAll(): Map<string, Entry> {
  const stamp = dirStamp()
  if (cache && stamp === cacheStamp) return cache
  const next = new Map<string, Entry>()
  const dir = workflowsDir()
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue
      const slug = entry.slice(0, -'.json'.length)
      if (!isWorkflowSlug(slug)) continue
      const full = join(dir, entry)
      let mtime = 0
      try {
        mtime = statSync(full).mtimeMs
      } catch {
        continue
      }
      // readJsonOr 会把坏文件隔离掉，这里拿到的要么是好数据要么是 null
      const parsed = readJsonOr<WorkflowApp | null>(full, null)
      if (!parsed || typeof parsed !== 'object') continue
      next.set(slug, { app: { ...parsed, slug }, mtime })
    }
  }
  cache = next
  cacheStamp = stamp
  return cache
}

function invalidate(): void {
  cache = null
  cacheStamp = -1
}

/** 按最近改动的排前面，和以前 unshift 到数组头部的观感一致。 */
export function listWorkflows(): WorkflowApp[] {
  return [...loadAll().entries()]
    .sort((a, b) => b[1].mtime - a[1].mtime || a[0].localeCompare(b[0]))
    .map(([, entry]) => entry.app)
}

/** 按 slug / id / 显示名找。三种标识都能用，调用方不用关心是哪种。 */
export function findWorkflow(key: string): WorkflowApp | undefined {
  const all = loadAll()
  const direct = all.get(key)
  if (direct) return direct.app
  for (const entry of all.values()) {
    if (entry.app.id === key || entry.app.app.name === key) return entry.app
  }
  return undefined
}

export type SaveWorkflowOptions = {
  /** 显式指定 slug（市场安装用市场那边的 slug）。 */
  slug?: string
  /** 同 slug 但显示名不同时怎么办，默认报错，不静默覆盖。 */
  onConflict?: 'error' | 'overwrite'
}

export function saveWorkflow(source: WorkflowApp, options: SaveWorkflowOptions = {}): WorkflowApp {
  const slug = options.slug ?? source.slug ?? slugFromName(source.app.name)
  if (!isWorkflowSlug(slug)) throw new Error(mt('main.wf.slugInvalid', { slug }))
  const existing = loadAll().get(slug)
  if (
    existing &&
    existing.app.app.name !== source.app.name &&
    (options.onConflict ?? 'error') === 'error'
  ) {
    throw new Error(mt('main.wf.slugConflict', { slug, name: existing.app.app.name }))
  }
  const saved: WorkflowApp = { ...source, slug }
  writeJsonAtomic(join(workflowsDir(), `${slug}.json`), saved)
  invalidate()
  return saved
}

/** 删掉一个工作流文件，返回被删的那份。 */
export function removeWorkflow(key: string): WorkflowApp {
  const found = findWorkflow(key)
  if (!found) throw new Error(mt('main.wf.noWorkflow', { id: key }))
  const slug = found.slug ?? slugFromName(found.app.name)
  if (!isWorkflowSlug(slug)) throw new Error(mt('main.wf.slugInvalid', { slug }))
  try {
    unlinkSync(join(workflowsDir(), `${slug}.json`))
  } catch {
    /* 已经不在了，视为删除成功 */
  }
  invalidate()
  return found
}

/**
 * 把老的 `workflows.json` 数组拆成一文件一份，然后把原文件改名成 `.migrated`。
 * 撞 slug 的用 `-2`、`-3` 后缀，绝不丢数据。
 */
export function migrateLegacyWorkflows(): { moved: number; renamed: string[] } {
  const legacy = join(app.getPath('userData'), 'workflows.json')
  if (!existsSync(legacy)) return { moved: 0, renamed: [] }
  const list = readJsonOr<WorkflowApp[]>(legacy, [])
  if (!Array.isArray(list) || list.length === 0) {
    try {
      renameSync(legacy, `${legacy}.migrated`)
    } catch {
      /* 改不了名字也不要紧，下次再试 */
    }
    return { moved: 0, renamed: [] }
  }
  const taken = new Set(loadAll().keys())
  const renamed: string[] = []
  let moved = 0
  for (const item of list) {
    if (!item || typeof item !== 'object' || !item.app?.name) continue
    let slug = item.slug && isWorkflowSlug(item.slug) ? item.slug : slugFromName(item.app.name)
    if (taken.has(slug)) {
      let index = 2
      while (taken.has(`${slug.slice(0, MAX_SLUG - 3)}-${index}`)) index += 1
      const next = `${slug.slice(0, MAX_SLUG - 3)}-${index}`
      renamed.push(`${item.app.name}: ${slug} → ${next}`)
      slug = next
    }
    writeJsonAtomic(join(workflowsDir(), `${slug}.json`), { ...item, slug })
    taken.add(slug)
    moved += 1
  }
  invalidate()
  try {
    renameSync(legacy, `${legacy}.migrated`)
  } catch {
    /* 留到下次 */
  }
  return { moved, renamed }
}
