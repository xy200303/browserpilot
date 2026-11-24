import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync } from 'fs'
import { join } from 'path'
import { profileRoot } from './env-path'
import { readJsonOr, writeJsonAtomic } from './json-file'

/**
 * 一次性迁移：把老的 `Partitions\<env>` 搬到 `profiles\<env>`。
 *
 * 用的是同一卷上的 rename，失败才退回复制 + 把源改名为 `.migrated`。
 * 全程不删除任何原始数据——真出问题，把目录名字改回去就能回滚。
 */
export type MigrationReport = {
  done: boolean
  at: number
  moved: string[]
  skipped: string[]
  errors: string[]
  /** `Partitions\` 里存在、但环境清单里没有的目录，只记录不处理 */
  orphans: string[]
}

// 每次都要新建一份：数组是引用类型，共用一份会跨调用累积
function emptyReport(): MigrationReport {
  return { done: false, at: 0, moved: [], skipped: [], errors: [], orphans: [] }
}

function markerFile(): string {
  return join(app.getPath('userData'), 'migration.json')
}

function partitionsDir(): string {
  return join(app.getPath('userData'), 'Partitions')
}

export function readMigrationMarker(): MigrationReport {
  return { ...emptyReport(), ...readJsonOr<Partial<MigrationReport>>(markerFile(), {}) }
}

function isEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length === 0
  } catch {
    return false
  }
}

function moveDir(source: string, target: string): void {
  try {
    renameSync(source, target)
    return
  } catch (error) {
    // 跨卷时 rename 会抛 EXDEV，退回复制
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  cpSync(source, target, { recursive: true })
  renameSync(source, `${source}.migrated`)
}

/**
 * 迁移所有环境的 profile 目录。`dryRun` 只出报告，不动磁盘。
 * 已经迁移过的会直接返回上一次的标记，重复调用是安全的。
 */
export function migrateEnvProfiles(envIds: string[], dryRun = false): MigrationReport {
  const previous = readMigrationMarker()
  // 已经迁过：返回上一次的报告，但把 moved 清空——否则每次启动都会重复报"迁移了 N 个"
  if (previous.done) return { ...previous, moved: [], skipped: [], errors: [] }

  const report: MigrationReport = { ...emptyReport(), at: Date.now() }
  const from = partitionsDir()
  const known = new Set(envIds)

  if (!dryRun) mkdirSync(join(app.getPath('userData'), 'profiles'), { recursive: true })

  for (const envId of envIds) {
    const source = join(from, envId)
    const target = profileRoot(envId)
    if (!existsSync(source)) {
      report.skipped.push(envId)
      continue
    }
    if (existsSync(target) && !isEmptyDir(target)) {
      // 目标已经有内容：可能是新布局先建了目录，别覆盖，留给人工确认
      report.skipped.push(envId)
      continue
    }
    if (dryRun) {
      report.moved.push(envId)
      continue
    }
    try {
      if (existsSync(target)) rmdirSync(target)
      moveDir(source, target)
      report.moved.push(envId)
    } catch (error) {
      report.errors.push(`${envId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 环境清单里没有的旧目录：只记录，不自动删——里面可能是用户忘了的账号
  if (existsSync(from)) {
    try {
      for (const entry of readdirSync(from)) {
        if (!known.has(entry)) report.orphans.push(entry)
      }
    } catch {
      /* 读不到就算了 */
    }
  }

  if (!dryRun) {
    report.done = report.errors.length === 0
    writeJsonAtomic(markerFile(), report)
    // 全部搬完且没有孤儿时，把空的 Partitions 目录收掉
    if (report.done && report.orphans.length === 0 && existsSync(from) && isEmptyDir(from)) {
      rmSync(from, { recursive: true, force: true })
    }
  }
  return report
}
