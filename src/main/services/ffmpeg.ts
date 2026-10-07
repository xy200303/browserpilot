import { execFile } from 'child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { storage } from './store'

const MIRROR = 'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.0'

let cached: string | null | undefined

function assetName(): string | null {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32' && arch === 'x64') return 'ffmpeg-win32-x64.gz'
  if (platform === 'darwin' && arch === 'arm64') return 'ffmpeg-darwin-arm64.gz'
  if (platform === 'darwin' && arch === 'x64') return 'ffmpeg-darwin-x64.gz'
  if (platform === 'linux' && arch === 'x64') return 'ffmpeg-linux-x64.gz'
  if (platform === 'linux' && arch === 'arm64') return 'ffmpeg-linux-arm64.gz'
  return null
}

function whichFfmpeg(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], (error, stdout) => {
      const found = String(stdout).split(/\r?\n/)[0].trim()
      resolve(!error && found ? found : null)
    })
  })
}

async function downloadFfmpeg(target: string, asset: string): Promise<void> {
  mkdirSync(join(storage.userData(), 'tools'), { recursive: true })
  const tmp = `${target}.download`
  const res = await fetch(`${MIRROR}/${asset}`)
  if (!res.ok || !res.body) throw new Error(`ffmpeg 下载失败 HTTP ${res.status}`)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createGunzip(), createWriteStream(tmp))
  renameSync(tmp, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
}

export async function ensureFfmpeg(): Promise<string | null> {
  if (cached !== undefined) return cached
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const local = join(storage.userData(), 'tools', exe)
  if (existsSync(local)) {
    cached = local
    return local
  }
  const onPath = await whichFfmpeg()
  if (onPath) {
    cached = onPath
    return onPath
  }
  const asset = assetName()
  if (!asset) {
    cached = null
    return null
  }
  try {
    await downloadFfmpeg(local, asset)
    cached = local
    return local
  } catch {
    cached = null
    return null
  }
}

export async function runFfmpeg(args: string[], timeoutMs = 600_000): Promise<void> {
  const bin = await ensureFfmpeg()
  if (!bin) throw new Error('没有 ffmpeg，自动下载也失败了')
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs }, (error) => (error ? reject(error) : resolve()))
  })
}
