import { app, session, type Session } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 环境 = 一个完整的 Chromium profile 目录：`<userData>/profiles/<envId>/`。
 *
 * 所有取 session 的地方都只从这里进，别再散落 `fromPartition`——
 * 那样改一次要动十几个文件，还容易漏。
 */
export function profileRoot(envId: string): string {
  return join(app.getPath('userData'), 'profiles', envId)
}

/** 应用自己的数据（历史、书签、密码等）放在 profile 里的子目录，避免和 Chromium 的文件撞名。 */
export function envDataDir(envId: string): string {
  return join(profileRoot(envId), 'browserpilot')
}

export function ensureProfileDir(envId: string): string {
  const dir = profileRoot(envId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 取一套环境的持久会话。同一个路径多次调用拿到的还是同一个 Session，
 * 所以这里可以放心被频繁调用。
 */
export function sessionForEnv(envId: string): Session {
  return session.fromPath(ensureProfileDir(envId))
}

/** 磁盘上现有的 profile 目录（可能包含已经不是环境的孤儿）。 */
export function listProfileIds(): string[] {
  try {
    return readdirSync(join(app.getPath('userData'), 'profiles'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * 删不掉的 profile 目录记在这里，下次启动再试。
 *
 * Windows 上 Chromium 常常还攥着目录里的文件，`rm` 会卡住几十秒甚至失败。
 * 与其让 `env_delete` 卡死，不如先把环境从列表里去掉，目录留到下次开机再删。
 */
function orphansFile(): string {
  return join(app.getPath('userData'), 'orphans.json')
}

export function listOrphans(): string[] {
  try {
    const raw = JSON.parse(readFileSync(orphansFile(), 'utf8')) as { dirs?: unknown }
    return Array.isArray(raw.dirs) ? raw.dirs.map(String) : []
  } catch {
    return []
  }
}

export function rememberOrphan(envId: string): void {
  const dirs = new Set(listOrphans())
  dirs.add(envId)
  try {
    writeFileSync(orphansFile(), JSON.stringify({ dirs: [...dirs] }, null, 2), 'utf8')
  } catch (error) {
    console.error('[env] could not record orphan', envId, error)
  }
}

export function forgetOrphan(envId: string): void {
  const dirs = listOrphans().filter((item) => item !== envId)
  try {
    writeFileSync(orphansFile(), JSON.stringify({ dirs }, null, 2), 'utf8')
  } catch {
    /* 写不进去就下次再试 */
  }
}

/** 目录还在不在（给调用方判断是否要记孤儿）。 */
export function profileExists(envId: string): boolean {
  return existsSync(profileRoot(envId))
}
