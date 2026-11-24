import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { envDataDir } from './env-path'

/**
 * 历史：每个环境一个 SQLite（`profiles/<env>/browserpilot/history.db`）。
 *
 * 之前是每次导航都把整套环境的历史全量写一遍，几千条时一次导航要写几百 KB。
 * 现在一次导航只写一行；按 URL 搜索走 `history_url` 索引。
 */
export type StoredHistory = {
  id: string
  envId: string
  url: string
  title: string
  favicon?: string
  visitedAt: number
}

const MAX_HISTORY = 3000
const dbs = new Map<string, DatabaseSync>()

function open(envId: string): DatabaseSync {
  const existing = dbs.get(envId)
  if (existing) return existing
  const dir = envDataDir(envId)
  mkdirSync(dir, { recursive: true })
  const handle = new DatabaseSync(join(dir, 'history.db'))
  handle.exec('PRAGMA journal_mode = WAL')
  handle.exec('PRAGMA synchronous = NORMAL')
  handle.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      favicon TEXT,
      visited_at INTEGER NOT NULL
    )
  `)
  handle.exec('CREATE INDEX IF NOT EXISTS history_visited ON history (visited_at DESC)')
  handle.exec('CREATE INDEX IF NOT EXISTS history_url ON history (url)')
  dbs.set(envId, handle)
  return handle
}

type HistoryRow = {
  id: string
  url: string
  title: string
  favicon: string | null
  visited_at: number
}

function toEntry(envId: string, row: HistoryRow): StoredHistory {
  const entry: StoredHistory = { id: row.id, envId, url: row.url, title: row.title, visitedAt: row.visited_at }
  if (row.favicon) entry.favicon = row.favicon
  return entry
}

export function listHistory(envId: string, limit = MAX_HISTORY): StoredHistory[] {
  const rows = open(envId)
    .prepare('SELECT id, url, title, favicon, visited_at FROM history ORDER BY visited_at DESC LIMIT ?')
    .all(limit) as unknown as HistoryRow[]
  return rows.map((row) => toEntry(envId, row))
}

export type HistoryQuery = { urlContains?: string; limit?: number }

export function queryHistory(envId: string, query: HistoryQuery = {}): StoredHistory[] {
  const limit = Math.max(1, Math.min(MAX_HISTORY, query.limit ?? MAX_HISTORY))
  if (!query.urlContains) return listHistory(envId, limit)
  const rows = open(envId)
    .prepare(
      'SELECT id, url, title, favicon, visited_at FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT ?'
    )
    .all(`%${query.urlContains}%`, `%${query.urlContains}%`, limit) as unknown as HistoryRow[]
  return rows.map((row) => toEntry(envId, row))
}

export function insertHistory(entry: StoredHistory): void {
  open(entry.envId)
    .prepare('INSERT OR REPLACE INTO history (id, url, title, favicon, visited_at) VALUES (?, ?, ?, ?, ?)')
    .run(entry.id, entry.url, entry.title, entry.favicon ?? null, entry.visitedAt)
}

/** 同一 URL 十秒内重复访问：只更新时间/标题/图标，不新增一行。 */
export function refreshHistory(envId: string, id: string, next: { title?: string; favicon?: string; visitedAt: number }): void {
  open(envId)
    .prepare('UPDATE history SET title = COALESCE(?, title), favicon = COALESCE(?, favicon), visited_at = ? WHERE id = ?')
    .run(next.title ?? null, next.favicon ?? null, next.visitedAt, id)
}

/** 只保留最新 N 条；返回删掉的行数。 */
export function trimHistory(envId: string, keep = MAX_HISTORY): number {
  const result = open(envId)
    .prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY visited_at DESC LIMIT ?)')
    .run(keep)
  return Number(result.changes ?? 0)
}

export function deleteHistory(envId: string, filter: { id?: string; url?: string; all?: boolean }): number {
  const handle = open(envId)
  if (filter.all) {
    const result = handle.prepare('DELETE FROM history').run()
    return Number(result.changes ?? 0)
  }
  if (filter.id) {
    const result = handle.prepare('DELETE FROM history WHERE id = ?').run(filter.id)
    return Number(result.changes ?? 0)
  }
  if (filter.url) {
    const result = handle.prepare('DELETE FROM history WHERE url = ?').run(filter.url)
    return Number(result.changes ?? 0)
  }
  return 0
}

export function countHistory(envId: string): number {
  const row = open(envId).prepare('SELECT COUNT(*) AS total FROM history').get() as { total: number } | undefined
  return Number(row?.total ?? 0)
}

/** 关掉某个环境的库句柄；删环境时用，不然文件删了句柄还开着。 */
export function closeHistory(envId: string): void {
  const handle = dbs.get(envId)
  if (!handle) return
  try {
    handle.close()
  } catch {
    /* 已经关了 */
  }
  dbs.delete(envId)
}

/**
 * 把某个环境自己的 `history.json` 搬进 `history.db`，然后把原文件改名 `.migrated`。
 * 坏文件隔离成 `.corrupt-<ts>`，不硬塞进去。
 */
export function migrateHistoryJson(envId: string, file: string): { moved: number; skipped: boolean } {
  if (!existsSync(file)) return { moved: 0, skipped: false }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    const quarantine = `${file}.corrupt-${Date.now()}`
    try {
      renameSync(file, quarantine)
    } catch {
      /* 改不了名就原地留着 */
    }
    console.error(`[history] ${file} is not valid JSON, quarantined as ${quarantine}`, error)
    return { moved: 0, skipped: true }
  }
  if (!Array.isArray(raw)) {
    console.error(`[history] ${file} is not an array, left untouched`)
    return { moved: 0, skipped: true }
  }
  let moved = 0
  for (const item of raw as StoredHistory[]) {
    if (!item || typeof item.id !== 'string' || typeof item.url !== 'string' || typeof item.visitedAt !== 'number') continue
    insertHistory({ ...item, envId, title: item.title || item.url })
    moved += 1
  }
  trimHistory(envId)
  try {
    renameSync(file, `${file}.migrated`)
  } catch (error) {
    console.error('[history] renamed failed after import', error)
  }
  return { moved, skipped: false }
}

/**
 * 老的全局 `history.json`（P1 之前那种）：按 envId 拆进各自库，再改名。
 * 只有第一次启动需要，之后不会再出现。
 */
export function migrateGlobalHistoryJson(file: string): { moved: number } {
  if (!existsSync(file)) return { moved: 0 }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    const quarantine = `${file}.corrupt-${Date.now()}`
    try {
      renameSync(file, quarantine)
    } catch {
      /* 同上 */
    }
    console.error(`[history] ${file} is not valid JSON, quarantined as ${quarantine}`, error)
    return { moved: 0 }
  }
  if (!Array.isArray(raw)) return { moved: 0 }
  let moved = 0
  for (const item of raw as StoredHistory[]) {
    if (!item || typeof item.id !== 'string' || typeof item.envId !== 'string' || typeof item.url !== 'string') continue
    if (typeof item.visitedAt !== 'number') continue
    insertHistory({ ...item, title: item.title || item.url })
    moved += 1
  }
  for (const envId of new Set((raw as StoredHistory[]).map((item) => item?.envId).filter(Boolean))) {
    trimHistory(String(envId))
  }
  try {
    renameSync(file, `${file}.migrated`)
  } catch (error) {
    console.error('[history] renamed failed after import', error)
  }
  return { moved }
}
