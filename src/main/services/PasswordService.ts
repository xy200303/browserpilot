import { safeStorage } from 'electron'
import type { PasswordEntry } from '@shared/types'
import { createId } from '../ids'
import { storage } from './store'
import type { StoredPassword } from './StorageService'

const ENCRYPTED = 'enc:'
const PLAIN = 'b64:'

function encrypt(secret: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) return ENCRYPTED + safeStorage.encryptString(secret).toString('base64')
  } catch {
    /* 系统密钥不可用时退回本机编码，至少不写明文 */
  }
  return PLAIN + Buffer.from(secret, 'utf8').toString('base64')
}

function decrypt(secret: string): string {
  try {
    if (secret.startsWith(ENCRYPTED)) return safeStorage.decryptString(Buffer.from(secret.slice(ENCRYPTED.length), 'base64'))
    if (secret.startsWith(PLAIN)) return Buffer.from(secret.slice(PLAIN.length), 'base64').toString('utf8')
  } catch {
    /* 换机器或密钥失效时解不出来，当作没有 */
  }
  return ''
}

export type PasswordStorageStatus = { available: boolean; secure: boolean; backend?: string }

// Linux 上有没有钥匙环由桌面环境决定：Ubuntu 服务器/minimal 安装常常没有，
// 这时 Chromium 会退回 basic_text（固定密钥，等同本机编码），要如实告诉用户
export function passwordStorageStatus(): PasswordStorageStatus {
  try {
    const available = safeStorage.isEncryptionAvailable()
    let backend: string | undefined
    if (process.platform === 'linux') {
      try {
        backend = safeStorage.getSelectedStorageBackend()
      } catch {
        backend = undefined
      }
    }
    return { available, secure: available && backend !== 'basic_text', backend }
  } catch {
    return { available: false, secure: false }
  }
}

function view(item: StoredPassword): PasswordEntry {
  return {
    id: item.id,
    envId: item.envId,
    origin: item.origin,
    username: item.username,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastUsedAt: item.lastUsedAt
  }
}

export function listPasswords(envId: string): PasswordEntry[] {
  return storage.passwords
    .filter((item) => item.envId === envId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(view)
}

export function revealPassword(id: string): { origin: string; username: string; password: string; locked: boolean } | null {
  const item = storage.passwords.find((entry) => entry.id === id)
  if (!item) return null
  const password = decrypt(item.secret)
  return { origin: item.origin, username: item.username, password, locked: !password }
}

export function savePassword(envId: string, origin: string, username: string, secret: string): PasswordEntry | null {
  if (!envId || !origin || !secret) return null
  const now = Date.now()
  const name = username.trim()
  const existing = storage.passwords.find((item) => item.envId === envId && item.origin === origin && item.username === name)
  if (existing) {
    existing.secret = encrypt(secret)
    existing.updatedAt = now
    storage.savePasswords()
    return view(existing)
  }
  const entry: StoredPassword = {
    id: createId('pwd'),
    envId,
    origin,
    username: name,
    secret: encrypt(secret),
    createdAt: now,
    updatedAt: now
  }
  storage.passwords.unshift(entry)
  storage.passwords = storage.passwords.slice(0, 1000)
  storage.savePasswords()
  return view(entry)
}

export function markPasswordUsed(envId: string, origin: string): void {
  const item = storage.passwords.find((entry) => entry.envId === envId && entry.origin === origin)
  if (!item) return
  item.lastUsedAt = Date.now()
  storage.savePasswords()
}

export function removePassword(id: string): boolean {
  const before = storage.passwords.length
  storage.passwords = storage.passwords.filter((item) => item.id !== id)
  if (storage.passwords.length === before) return false
  storage.savePasswords()
  return true
}

export function clearPasswords(envId: string): void {
  storage.passwords = storage.passwords.filter((item) => item.envId !== envId)
  storage.savePasswords()
}

export function autofillFor(envId: string, origin: string): { username: string; password: string } | null {
  const item = storage.passwords
    .filter((entry) => entry.envId === envId && entry.origin === origin)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (!item) return null
  const password = decrypt(item.secret)
  if (!password) return null
  return { username: item.username, password }
}
