import { MARKET_HOME } from '@shared/market'
import { importWorkflowText } from './RecordService'

const OWNER = 'xy200303'
const REPO = 'browserpilot-market'
const BRANCH = 'main'

export type MarketEntry = {
  slug: string
  name: string
  description: string
  author: string
  category: string
  site: string
  icon: string
  file: string
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'BrowserPilot'
}

function parseCatalog(raw: unknown): MarketEntry[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { workflows?: unknown }).workflows)
    ? (raw as { workflows: unknown[] }).workflows
    : []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const slug = typeof row.slug === 'string' ? row.slug : ''
    const name = typeof row.name === 'string' ? row.name : ''
    const file = typeof row.file === 'string' ? row.file : ''
    if (!slug || !name || !file) return []
    return [{
      slug,
      name,
      description: typeof row.description === 'string' ? row.description : '',
      author: typeof row.author === 'string' ? row.author : '',
      category: typeof row.category === 'string' && row.category.trim() ? row.category.trim() : '其他',
      site: typeof row.site === 'string' ? row.site.trim() : '',
      icon: typeof row.icon === 'string' ? row.icon.trim() : '',
      file
    }]
  })
}

async function readGithub(apiUrl: string): Promise<string> {
  const response = await fetch(apiUrl, { headers, cache: 'no-store', signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
  const body = await response.json() as { content?: string }
  if (typeof body.content !== 'string' || !body.content) throw new Error('GitHub 没有返回文件')
  return Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8')
}

function contentsUrl(path: string, ref = BRANCH): string {
  const clean = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${clean}?ref=${encodeURIComponent(ref)}`
}

function apiFromGithubUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error('这不是一个网址')
  }
  if (parsed.protocol !== 'https:') throw new Error('只接受 https 的 GitHub 地址')
  if (parsed.hostname === 'api.github.com') {
    if (!parsed.pathname.includes('/contents/') || !parsed.pathname.endsWith('.json')) throw new Error('工作流文件要是 JSON')
    return parsed.toString()
  }
  if (parsed.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, branch, ...rest] = parsed.pathname.split('/').filter(Boolean)
    const file = rest.join('/')
    if (!owner || !repo || !branch || !file.endsWith('.json')) throw new Error('这个地址里没有工作流文件')
    return `https://api.github.com/repos/${owner}/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
  }
  if (parsed.hostname !== 'github.com') throw new Error('只接受 GitHub 上的工作流')
  const parts = parsed.pathname.split('/').filter(Boolean)
  const marker = parts[2]
  if ((marker !== 'blob' && marker !== 'raw') || parts.length < 5) throw new Error('这个地址里没有工作流文件')
  const file = parts.slice(4).join('/')
  if (!file.endsWith('.json')) throw new Error('工作流文件要是 JSON')
  return `https://api.github.com/repos/${parts[0]}/${parts[1]}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(parts[3])}`
}

export async function listMarket(): Promise<{ items: MarketEntry[]; source: string }> {
  const text = await readGithub(contentsUrl('index.json'))
  const items = parseCatalog(JSON.parse(text))
  if (!items.length) throw new Error('市场上还没有工作流')
  return { items, source: MARKET_HOME }
}

export async function installMarketFile(file: string): Promise<{ workflow: string; name: string }> {
  const relative = file.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!relative || relative.includes('..') || relative.startsWith('/') || !relative.endsWith('.json')) {
    throw new Error('市场里的文件路径不对')
  }
  const saved = importWorkflowText(await readGithub(contentsUrl(relative)))
  return { workflow: saved.id, name: saved.app.name }
}

export async function installMarketUrl(url: string): Promise<{ workflow: string; name: string }> {
  const saved = importWorkflowText(await readGithub(apiFromGithubUrl(url)))
  return { workflow: saved.id, name: saved.app.name }
}
