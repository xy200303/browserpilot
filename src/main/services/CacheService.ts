import { app, session } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { storage } from './store'

// 只清缓存类存储：cookie、localStorage、IndexedDB 都不动，登录和站点数据保留。
const CACHE_STORAGES = ['cachestorage', 'serviceworkers', 'shadercache'] as const
const WEEK_MS = 7 * 86_400_000
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let pending: Promise<void> = Promise.resolve()

function stampFile(): string {
  return join(app.getPath('userData'), 'cache-cleanup.json')
}

/** 清掉一个环境的 HTTP 缓存、代码缓存和 Service Worker 缓存。 */
export async function clearEnvCache(envId: string): Promise<void> {
  const ses = session.fromPartition(`persist:${envId}`)
  await ses.clearCache().catch(() => undefined)
  await ses.clearCodeCaches({}).catch(() => undefined)
  await ses.clearStorageData({ storages: [...CACHE_STORAGES] }).catch(() => undefined)
}

/** 应用外壳和默认会话的缓存，和登录数据无关，可以放心清。 */
export async function clearDefaultCache(): Promise<void> {
  const ses = session.defaultSession
  await ses.clearCache().catch(() => undefined)
  await ses.clearCodeCaches({}).catch(() => undefined)
  await ses.clearStorageData({ storages: [...CACHE_STORAGES] }).catch(() => undefined)
}

/** 关窗时清理：排队执行，应用退出前会等它一下，避免清到一半就没了。 */
export function scheduleClearEnvCache(envId: string): void {
  pending = pending.then(() => clearEnvCache(envId)).catch(() => undefined)
}

/** 退出前最多等 3 秒，让排队中的清理跑完。 */
export async function waitCacheCleanup(): Promise<void> {
  await Promise.race([pending, sleep(3_000)])
}

function lastCleanupAt(): number {
  try {
    const raw = JSON.parse(readFileSync(stampFile(), 'utf8')) as { at?: number }
    return typeof raw.at === 'number' ? raw.at : 0
  } catch {
    return 0
  }
}

function markCleanup(): void {
  try {
    writeFileSync(stampFile(), JSON.stringify({ at: Date.now() }))
  } catch {
    /* 写不了就下个周期再来 */
  }
}

/** 设置是 weekly 且距上次超过 7 天（还没标记）。 */
export function cacheCleanupDue(): boolean {
  if (storage.settings.cacheCleanup !== 'weekly') return false
  return Date.now() - lastCleanupAt() >= WEEK_MS
}

/** 清指定环境的缓存。 */
export async function cleanupEnvs(envIds: string[]): Promise<number> {
  let count = 0
  for (const envId of envIds) {
    await clearEnvCache(envId)
    count += 1
  }
  return count
}

/** 启动时调用：清所有没开着的环境，并标记本周已清。开着的那扇留给启动后再清。 */
export async function cleanupIfDue(openEnvIds: Set<string>): Promise<number> {
  if (!cacheCleanupDue()) return 0
  await clearDefaultCache()
  const closed = storage.envs.map((env) => env.id).filter((id) => !openEnvIds.has(id))
  const count = await cleanupEnvs(closed)
  markCleanup()
  return count
}
