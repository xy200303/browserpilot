import { app, clipboard } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { mcpConnectInfo } from './McpService'
import { buildConnectPrompt } from './PromptService'

const SKILL_URL = 'https://raw.githubusercontent.com/xy200303/browserpilot/main/skills/browserpilot/SKILL.md'

export type ConnectInfoData = {
  prompt: string
  url: string
  file: string
  cliPath: string
  skillPath?: string
}

export function connectInfo(): ConnectInfoData {
  const info = mcpConnectInfo()
  const name = process.platform === 'win32' ? 'browserpilot.exe' : 'browserpilot'
  const cliPath =
    [join(process.resourcesPath, 'cli', name), join(app.getAppPath(), 'cli', name)].find((item) => existsSync(item)) ??
    'browserpilot'
  const skillPath = [
    join(process.resourcesPath, 'skills', 'browserpilot', 'SKILL.md'),
    join(app.getAppPath(), 'skills', 'browserpilot', 'SKILL.md')
  ].find((item) => existsSync(item))
  const prompt = buildConnectPrompt({
    url: info.url,
    token: info.token,
    file: info.file,
    skillUrl: SKILL_URL,
    skillPath,
    cliPath,
    version: app.getVersion()
  })
  return { prompt, url: info.url, file: info.file, cliPath, skillPath }
}

export async function copyConnectInfo(): Promise<ConnectInfoData> {
  const data = connectInfo()
  const written = clipboard.writeText(data.prompt) as unknown
  if (written instanceof Promise) await written
  return data
}
