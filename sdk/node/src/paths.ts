import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * App 在 index.ts 里把 userData 固定成 `<appData>/BrowserPilot`，
 * 所以端点文件的位置只跟系统有关，跟 App 装在哪儿无关。
 */
export function appDataRoot(platform: NodeJS.Platform = process.platform, env = process.env): string {
  if (platform === 'win32') return env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

/** `%APPDATA%\BrowserPilot\mcp.json` / `~/Library/Application Support/...` / `~/.config/...` */
export function mcpFile(platform: NodeJS.Platform = process.platform, env = process.env): string {
  return join(appDataRoot(platform, env), 'BrowserPilot', 'mcp.json')
}

/** SDK 自己的目录：下载缓存和便携副本都放这儿。 */
export function dataHome(env = process.env): string {
  return env.BROWSERPILOT_HOME || join(homedir(), '.browserpilot')
}

export function sdkDir(version: string): string {
  return join(dataHome(), 'sdk', version)
}

export function downloadsDir(): string {
  return join(dataHome(), 'downloads')
}

/**
 * 确认某个路径真是应用本体，而不是同目录下的 cli/browserpilot。
 * 打包后的 App 一定有 `resources/app.asar`；AppImage 是一整个大文件。
 */
export function looksLikeApp(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return false
    if (process.platform === 'darwin' && path.includes('.app/Contents/MacOS/')) return true
    if (stat.size > 20 * 1024 * 1024) return true
    const root = join(path, '..')
    return existsSync(join(root, 'resources', 'app.asar'))
  } catch {
    return false
  }
}

/** 桌面版的默认安装位置。SDK 优先用这些，因为登录态都在用户日常那份里。 */
export function installCandidates(platform: NodeJS.Platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const pf = env.ProgramFiles || 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      join(local, 'Programs', 'BrowserPilot', 'BrowserPilot.exe'),
      join(pf, 'BrowserPilot', 'BrowserPilot.exe'),
      join(pf86, 'BrowserPilot', 'BrowserPilot.exe'),
      ...fromPath('BrowserPilot.exe', env)
    ]
  }
  if (platform === 'darwin') {
    return [
      '/Applications/BrowserPilot.app/Contents/MacOS/BrowserPilot',
      join(homedir(), 'Applications', 'BrowserPilot.app', 'Contents', 'MacOS', 'BrowserPilot')
    ]
  }
  return ['/opt/BrowserPilot/BrowserPilot', '/usr/lib/browserpilot/BrowserPilot', ...fromPath('BrowserPilot', env)]
}

/** 安装包会把 CLI 放进 PATH；同一个目录里通常就是应用本体。 */
function fromPath(exe: string, env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.PATH || env.Path || '').split(process.platform === 'win32' ? ';' : ':')
  return dirs.filter(Boolean).map((dir) => join(dir, exe))
}
