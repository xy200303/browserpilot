import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { InstallError } from './errors.js'
import { downloadsDir, installCandidates, looksLikeApp, sdkDir } from './paths.js'
import { APP_VERSION } from './version.js'

const run = promisify(execFile)

const RELEASE_API = 'https://api.github.com/repos/xy200303/browserpilot/releases/tags'

export type AssetKind = 'zip' | 'appimage'

export type Asset = {
  /** Release 里的资产文件名。 */
  name: string
  kind: AssetKind
  /** 应用本体相对安装目录的路径。 */
  exe: string
}

/**
 * 这是实际存在的组合，不是猜的：发布流水线只产出这三个平台。
 * 别的组合直接报错，不要下到一半才发现。
 */
export function assetFor(version = APP_VERSION, platform: NodeJS.Platform = process.platform, arch = process.arch): Asset {
  if (platform === 'win32' && arch === 'x64') {
    return { name: `BrowserPilot-${version}-win.zip`, kind: 'zip', exe: 'BrowserPilot.exe' }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      name: `BrowserPilot-${version}-arm64-mac.zip`,
      kind: 'zip',
      exe: join('BrowserPilot.app', 'Contents', 'MacOS', 'BrowserPilot')
    }
  }
  if (platform === 'linux' && arch === 'x64') {
    return { name: `BrowserPilot-${version}.AppImage`, kind: 'appimage', exe: 'BrowserPilot.AppImage' }
  }
  throw new InstallError(
    `没有 ${platform}-${arch} 的 BrowserPilot 构建。目前只发布 Windows x64、macOS arm64、Linux x64。` +
      `如果你本机已经装了桌面版，把 BROWSERPILOT_EXE 指向它就能用。`
  )
}

export type AppSource = 'env' | 'installed' | 'cache' | 'downloaded'

export type AppLocation = {
  exe: string
  source: AppSource
  /** 只有 SDK 自己装的那份才知道确切版本。 */
  version?: string
}

export type DownloadProgress = { asset: string; received: number; total: number }

export type EnsureOptions = {
  /** 显式指定可执行文件，优先于环境变量。 */
  exe?: string
  version?: string
  /** 只找不下载。 */
  offline?: boolean
  onDownload?: (progress: DownloadProgress) => void
  log?: (message: string) => void
}

/**
 * 找一份能用的 BrowserPilot：环境变量 → 桌面版安装位置 → SDK 缓存。
 * 已经装好的优先，因为用户的登录态都在那份里。
 */
export function locateApp(options: EnsureOptions = {}): AppLocation | null {
  const explicit = options.exe || process.env.BROWSERPILOT_EXE
  if (explicit) {
    if (!existsSync(explicit)) throw new InstallError(`BROWSERPILOT_EXE 指向的 ${explicit} 不存在`)
    return { exe: explicit, source: 'env' }
  }

  for (const candidate of installCandidates()) {
    if (looksLikeApp(candidate)) return { exe: candidate, source: 'installed' }
  }

  const version = options.version ?? APP_VERSION
  const cached = join(sdkDir(version), assetFor(version).exe)
  if (looksLikeApp(cached)) return { exe: cached, source: 'cache', version }

  return null
}

export async function ensureApp(options: EnsureOptions = {}): Promise<AppLocation> {
  const found = locateApp(options)
  if (found) return found

  if (options.offline || process.env.BROWSERPILOT_OFFLINE === '1') {
    throw new InstallError('没找到 BrowserPilot，而且现在是离线模式（BROWSERPILOT_OFFLINE=1）。')
  }

  const version = options.version ?? APP_VERSION
  const exe = await downloadApp(version, options)
  return { exe, source: 'downloaded', version }
}

type ReleaseAsset = {
  name: string
  browser_download_url: string
  size: number
  digest?: string
}

async function releaseAsset(version: string, name: string): Promise<ReleaseAsset> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'browserpilot-sdk'
  }
  // 没登录的 GitHub API 是 60 次/小时，CI 里塞个 token 更稳。
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  let response: Response
  try {
    response = await fetch(`${RELEASE_API}/v${version}`, { headers, signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    throw new InstallError(`查 v${version} 的发行版失败`, { cause: error })
  }
  if (response.status === 404) throw new InstallError(`GitHub 上没有 v${version} 这个版本`)
  if (!response.ok) throw new InstallError(`GitHub 返回 ${response.status}，可能触发了限流`)

  const payload = (await response.json()) as { assets?: ReleaseAsset[] }
  const asset = payload.assets?.find((item) => item.name === name)
  if (!asset) throw new InstallError(`v${version} 里没有 ${name}`)
  return asset
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function downloadApp(version: string, options: EnsureOptions): Promise<string> {
  const asset = assetFor(version)
  const log = options.log ?? (() => {})
  const info = await releaseAsset(version, asset.name)

  mkdirSync(downloadsDir(), { recursive: true })
  const archive = join(downloadsDir(), asset.name)
  const partial = `${archive}.part`
  const expected = info.digest?.replace(/^sha256:/, '')

  // 上次下好且校验通过就不再下。
  const reusable = existsSync(archive) && (!expected || (await sha256File(archive)) === expected)

  if (!reusable) {
    log(`下载 ${asset.name}（${(info.size / 1024 / 1024).toFixed(0)} MB）`)
    const response = await fetch(info.browser_download_url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30 * 60_000)
    })
    if (!response.ok || !response.body) throw new InstallError(`下载失败：HTTP ${response.status}`)

    const hash = createHash('sha256')
    let received = 0
    const total = Number(response.headers.get('content-length') ?? info.size ?? 0)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        received += chunk.length
        options.onDownload?.({ asset: asset.name, received, total })
        callback(null, chunk)
      }
    })

    try {
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(partial))
    } catch (error) {
      rmSync(partial, { force: true })
      throw new InstallError('下载中断', { cause: error })
    }

    const actual = hash.digest('hex')
    if (expected && expected !== actual) {
      rmSync(partial, { force: true })
      throw new InstallError(`SHA-256 不匹配：期望 ${expected}，实际 ${actual}`)
    }
    renameSync(partial, archive)
  }

  const target = sdkDir(version)
  await mkdir(target, { recursive: true })

  if (asset.kind === 'appimage') {
    const exe = join(target, asset.exe)
    copyFileSync(archive, exe)
    chmodSync(exe, 0o755)
    return exe
  }

  await extractZip(archive, target)
  const exe = join(target, asset.exe)
  if (!existsSync(exe)) throw new InstallError(`解压后没找到 ${asset.exe}`)
  chmodSync(exe, 0o755)
  return exe
}

async function extractZip(archive: string, target: string): Promise<void> {
  // Windows 10+ 自带 bsdtar，macOS/Linux 也有 tar，一个命令覆盖三个平台。
  try {
    await run('tar', ['-xf', archive, '-C', target])
    return
  } catch {
    /* 换下一个 */
  }
  if (process.platform === 'win32') {
    try {
      await run('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`
      ])
      return
    } catch {
      /* 换下一个 */
    }
  }
  try {
    await run('unzip', ['-o', '-q', archive, '-d', target])
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => {})
    throw new InstallError('解压失败：tar、Expand-Archive、unzip 都没成功', { cause: error })
  }
}
