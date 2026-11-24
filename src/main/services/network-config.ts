import type { Session } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readJsonOr, writeJsonAtomic } from './json-file'
import { envDataDir, sessionForEnv } from './env-path'
import { chromeUserAgent } from '../ua'
import { mt } from '../i18n'

/**
 * 每套环境一份网络配置：`profiles/<env>/browserpilot/network.json`。
 *
 * 没有独立出口 IP，UA/时区这些伪装意义很小——所以代理先行。
 * 配置写进环境目录，换机器带走整个 profile 就带走了。
 */
export type ProxyConfig =
  | { mode: 'direct' }
  | { mode: 'fixed'; rules: string; bypass?: string }
  | { mode: 'pac'; pacScript: string }

export type NetworkConfig = {
  proxy: ProxyConfig
  userAgent: string | null
  acceptLanguages: string | null
  timezone: string | null
  locale: string | null
  webrtcPolicy: 'default' | 'default_public_and_private_interfaces' | 'default_public_interface_only' | 'disable_non_proxied_udp'
  /** 本期不实现，只预留结构 */
  fingerprint: Record<string, unknown>
}

export function defaultNetwork(): NetworkConfig {
  return {
    proxy: { mode: 'direct' },
    userAgent: null,
    acceptLanguages: null,
    timezone: null,
    locale: null,
    webrtcPolicy: 'default',
    fingerprint: {}
  }
}

function file(envId: string): string {
  return join(envDataDir(envId), 'network.json')
}

const POLICIES = new Set([
  'default',
  'default_public_and_private_interfaces',
  'default_public_interface_only',
  'disable_non_proxied_udp'
])

function normalize(raw: unknown): NetworkConfig {
  const base = defaultNetwork()
  if (!raw || typeof raw !== 'object') return base
  const saved = raw as Partial<NetworkConfig> & { proxy?: unknown }
  if (saved.proxy && typeof saved.proxy === 'object') {
    const proxy = saved.proxy as { mode?: unknown; rules?: unknown; bypass?: unknown; pacScript?: unknown }
    if (proxy.mode === 'fixed' && typeof proxy.rules === 'string' && proxy.rules.trim()) {
      base.proxy = { mode: 'fixed', rules: proxy.rules.trim() }
      if (typeof proxy.bypass === 'string' && proxy.bypass.trim()) base.proxy.bypass = proxy.bypass.trim()
    } else if (proxy.mode === 'pac' && typeof proxy.pacScript === 'string' && proxy.pacScript.trim()) {
      base.proxy = { mode: 'pac', pacScript: proxy.pacScript.trim() }
    }
  }
  if (typeof saved.userAgent === 'string' && saved.userAgent.trim()) base.userAgent = saved.userAgent.trim()
  if (typeof saved.acceptLanguages === 'string' && saved.acceptLanguages.trim()) {
    base.acceptLanguages = saved.acceptLanguages.trim()
  }
  if (typeof saved.timezone === 'string' && saved.timezone.trim()) base.timezone = saved.timezone.trim()
  if (typeof saved.locale === 'string' && saved.locale.trim()) base.locale = saved.locale.trim()
  if (typeof saved.webrtcPolicy === 'string' && POLICIES.has(saved.webrtcPolicy)) {
    base.webrtcPolicy = saved.webrtcPolicy as NetworkConfig['webrtcPolicy']
  }
  if (saved.fingerprint && typeof saved.fingerprint === 'object') base.fingerprint = saved.fingerprint as Record<string, unknown>
  return base
}

export function readNetwork(envId: string): NetworkConfig {
  return normalize(readJsonOr<unknown>(file(envId), null))
}

export type NetworkPatch = {
  proxy?: ProxyConfig
  userAgent?: string | null
  acceptLanguages?: string | null
  timezone?: string | null
  locale?: string | null
  webrtcPolicy?: string
}

/** 主机只能是 ASCII 字母数字点横线，或 [IPv6]；端口 1–5 位。中文、"!" 之类一律拒掉。 */
const PROXY_HOST = '(?:\\[[0-9a-fA-F:]+\\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)'
const PROXY_SEGMENT = new RegExp(
  `^(?:[a-z0-9]+=)?(?:[a-z][a-z0-9+.-]*://)?(?:[^\\s:@/]+(?::[^\\s@/]*)?@)?${PROXY_HOST}(?::\\d{1,5})?$`,
  'i'
)

function assertProxyRules(rules: string): void {
  const segments = rules
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (!segments.length) throw new Error(mt('main.net.needRules'))
  for (const segment of segments) {
    if (!PROXY_SEGMENT.test(segment)) throw new Error(mt('main.net.badRule', { rule: segment }))
  }
}

/** 校验并合并。只动了传进来的字段，其他保持不变。 */
export function writeNetwork(envId: string, patch: NetworkPatch): NetworkConfig {
  const next = readNetwork(envId)
  if (patch.proxy) {
    if (patch.proxy.mode === 'fixed') {
      const rules = patch.proxy.rules?.trim()
      if (!rules) throw new Error(mt('main.net.needRules'))
      assertProxyRules(rules)
      next.proxy = { mode: 'fixed', rules }
      if (patch.proxy.bypass?.trim()) next.proxy.bypass = patch.proxy.bypass.trim()
    } else if (patch.proxy.mode === 'pac') {
      if (!patch.proxy.pacScript?.trim()) throw new Error(mt('main.net.needPac'))
      next.proxy = { mode: 'pac', pacScript: patch.proxy.pacScript.trim() }
    } else {
      next.proxy = { mode: 'direct' }
    }
  }
  if (patch.userAgent !== undefined) next.userAgent = patch.userAgent?.trim() || null
  if (patch.acceptLanguages !== undefined) next.acceptLanguages = patch.acceptLanguages?.trim() || null
  if (patch.timezone !== undefined) next.timezone = patch.timezone?.trim() || null
  if (patch.locale !== undefined) next.locale = patch.locale?.trim() || null
  if (patch.webrtcPolicy !== undefined) {
    if (!POLICIES.has(patch.webrtcPolicy)) throw new Error(mt('main.net.badPolicy', { allowed: [...POLICIES].join(' / ') }))
    next.webrtcPolicy = patch.webrtcPolicy as NetworkConfig['webrtcPolicy']
  }
  writeJsonAtomic(file(envId), next)
  return next
}

/** 已应用过的配置快照，用来判断要不要重新下发。 */
const applied = new Map<string, string>()
const lastError = new Map<string, string>()
const pending = new Map<string, Promise<void>>()

export function networkError(envId: string): string | undefined {
  return lastError.get(envId)
}

/**
 * 把配置下发到会话：代理走 `setProxy`，UA/语言走 `setUserAgent`。
 * 代理失败会保留错误（`network_get` 能查到），不会静默回退直连。
 */
export async function applySessionNetwork(envId: string): Promise<void> {
  const ses: Session = sessionForEnv(envId)
  const config = readNetwork(envId)
  try {
    if (config.proxy.mode === 'fixed') {
      await ses.setProxy({ proxyRules: config.proxy.rules, proxyBypassRules: config.proxy.bypass })
    } else if (config.proxy.mode === 'pac') {
      await ses.setProxy({ pacScript: config.proxy.pacScript })
    } else {
      await ses.setProxy({ mode: 'direct' })
    }
    lastError.delete(envId)
    applied.set(envId, JSON.stringify(config.proxy))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lastError.set(envId, message)
    console.error('[net] proxy failed for', envId, message)
    throw new Error(mt('main.net.applyFailed', { message }))
  }
  const ua = config.userAgent ?? chromeUserAgent()
  ses.setUserAgent(ua, config.acceptLanguages ?? undefined)
}

/** 窗口创建时调用：同一环境只会真正下发一次。 */
export function ensureSessionNetwork(envId: string): Promise<void> {
  const running = pending.get(envId)
  if (running) return running
  const task = applySessionNetwork(envId).catch(() => undefined)
  pending.set(envId, task)
  return task
}

/** 标签创建前等它：保证首个请求就走上代理。 */
export function networkReady(envId: string): Promise<void> {
  return pending.get(envId) ?? Promise.resolve()
}

export function userAgentFor(envId: string): { ua: string; languages?: string } {
  const config = readNetwork(envId)
  return { ua: config.userAgent ?? chromeUserAgent(), languages: config.acceptLanguages ?? undefined }
}

export function webrtcPolicyFor(envId: string): NetworkConfig['webrtcPolicy'] {
  return readNetwork(envId).webrtcPolicy
}

/** 环境被删掉时清掉缓存，避免 envId 复用拿到旧值。 */
export function forgetNetwork(envId: string): void {
  applied.delete(envId)
  lastError.delete(envId)
  pending.delete(envId)
}

/** 给工具用：配置 + 实际生效状态。 */
export function describeNetwork(envId: string): {
  config: NetworkConfig
  applied: boolean
  error?: string
  file: string
} {
  const config = readNetwork(envId)
  return {
    config,
    applied: applied.get(envId) === JSON.stringify(config.proxy),
    error: lastError.get(envId),
    file: file(envId)
  }
}

/** 配置文件在不在（给验收用）。 */
export function networkFileExists(envId: string): boolean {
  return existsSync(file(envId))
}

