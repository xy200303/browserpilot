import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * 写 JSON：先写同目录的 `.tmp`，再 rename 覆盖。
 * 同卷 rename 是原子的，崩在中间不会留下半截文件；`writeFileSync` 直接覆盖则会先截断。
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const text = JSON.stringify(value, null, 2)
  const temp = `${path}.tmp`
  writeFileSync(temp, text, 'utf8')
  try {
    renameSync(temp, path)
  } catch (error) {
    // Windows 上目标偶尔被别的句柄占着（杀毒、索引服务），退回直接写并留日志，
    // 总比抛出去让上层丢掉这次写入好。
    console.error('[storage] atomic replace failed, falling back to direct write', path, error)
    writeFileSync(path, text, 'utf8')
    try {
      unlinkSync(temp)
    } catch {
      /* 删不掉就留着，下次启动会被覆盖 */
    }
  }
}

/**
 * 读 JSON：解析失败时把坏文件改名隔离，返回 fallback，并打日志。
 * 绝不静默清空——静默返回空数组会让下一次写入把空数据覆盖回去，那才是真正的数据丢失。
 */
export function readJsonOr<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    const quarantine = `${path}.corrupt-${Date.now()}`
    try {
      renameSync(path, quarantine)
      console.error(`[storage] ${path} failed to parse, quarantined as ${quarantine}`, error)
    } catch (renameError) {
      console.error(`[storage] ${path} failed to parse and could not be quarantined`, error, renameError)
    }
    return fallback
  }
}
