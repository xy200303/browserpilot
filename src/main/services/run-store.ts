import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'

/**
 * 运行记录：全局一个 SQLite（`<userData>/runs.db`）。
 *
 * 为什么换掉 runs.json：运行记录只增不减，每次跑完都要"读整个数组 → 插一条 → 写回"，
 * 200 条时就已经是每次全量重写；保留策略还得先把整个数组解析出来再过滤。
 */
export type StoredRun = {
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

type RunRow = {
  id: string
  workflow_id: string
  workflow_name: string | null
  node: string | null
  ok: number
  error: string | null
  screenshot: string | null
  started_at: number
  outputs: string | null
  files: string | null
}

const MAX_RUNS = 200

let db: DatabaseSync | undefined

function open(): DatabaseSync {
  if (db) return db
  const target = join(app.getPath('userData'), 'runs.db')
  mkdirSync(dirname(target), { recursive: true })
  const handle = new DatabaseSync(target)
  handle.exec('PRAGMA journal_mode = WAL')
  handle.exec('PRAGMA synchronous = NORMAL')
  handle.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_name TEXT,
      node TEXT,
      ok INTEGER NOT NULL,
      error TEXT,
      screenshot TEXT,
      started_at INTEGER NOT NULL,
      outputs TEXT,
      files TEXT
    )
  `)
  handle.exec('CREATE INDEX IF NOT EXISTS runs_started ON runs (started_at DESC)')
  handle.exec('CREATE INDEX IF NOT EXISTS runs_workflow ON runs (workflow_id, started_at DESC)')
  db = handle
  return handle
}

function toRun(row: RunRow): StoredRun {
  const run: StoredRun = {
    id: row.id,
    workflowId: row.workflow_id,
    at: row.started_at,
    ok: row.ok === 1
  }
  if (row.workflow_name) run.title = row.workflow_name
  if (row.node) run.node = row.node
  if (row.error) run.error = row.error
  if (row.screenshot) run.screenshot = row.screenshot
  if (row.outputs) {
    try {
      run.outputs = JSON.parse(row.outputs) as Record<string, unknown>
    } catch {
      /* 坏行就当没有 outputs */
    }
  }
  if (row.files) {
    try {
      const files = JSON.parse(row.files) as unknown
      if (Array.isArray(files)) run.files = files.map(String)
    } catch {
      /* 同上 */
    }
  }
  return run
}

export function listRuns(limit = MAX_RUNS): StoredRun[] {
  const rows = open().prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as unknown as RunRow[]
  return rows.map(toRun)
}

export function insertRun(run: StoredRun): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO runs
         (id, workflow_id, workflow_name, node, ok, error, screenshot, started_at, outputs, files)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.workflowId,
      run.title ?? null,
      run.node ?? null,
      run.ok ? 1 : 0,
      run.error ?? null,
      run.screenshot ?? null,
      run.at,
      run.outputs === undefined ? null : JSON.stringify(run.outputs),
      run.files === undefined ? null : JSON.stringify(run.files)
    )
}

/** 只保留最新的 N 条；返回删掉的行数。 */
export function trimRuns(keep = MAX_RUNS): number {
  const handle = open()
  const result = handle
    .prepare('DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT ?)')
    .run(keep)
  return Number(result.changes ?? 0)
}

export function clearRuns(): void {
  open().exec('DELETE FROM runs')
}

export function countRuns(): number {
  const row = open().prepare('SELECT COUNT(*) AS total FROM runs').get() as { total: number } | undefined
  return Number(row?.total ?? 0)
}

/**
 * 把老的 runs.json 搬进来，然后把原文件改名 `.migrated`。
 * 内容坏掉时不动原文件——留着让人能查。
 */
export function migrateRunsJson(file: string): { moved: number; skipped: boolean } {
  if (!existsSync(file)) return { moved: 0, skipped: false }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    // 坏文件不改名成 .migrated：留一份 .corrupt-<ts> 让人能翻
    const quarantine = `${file}.corrupt-${Date.now()}`
    try {
      renameSync(file, quarantine)
    } catch {
      /* 改不了名就原地留着 */
    }
    console.error(`[runs] ${file} is not valid JSON, quarantined as ${quarantine}`, error)
    return { moved: 0, skipped: true }
  }
  if (!Array.isArray(raw)) {
    console.error(`[runs] ${file} is not an array, left untouched`)
    return { moved: 0, skipped: true }
  }
  let moved = 0
  for (const item of raw as StoredRun[]) {
    if (!item || typeof item.id !== 'string' || typeof item.workflowId !== 'string' || typeof item.at !== 'number') continue
    insertRun(item)
    moved += 1
  }
  trimRuns()
  try {
    renameSync(file, `${file}.migrated`)
  } catch (error) {
    console.error('[runs] renamed failed after import', error)
  }
  return { moved, skipped: false }
}