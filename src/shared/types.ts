export type Control = 'agent' | 'shared' | 'handoff'

export type TabLayout = 'top' | 'left'

export type SearchEngineId = 'bing' | 'baidu' | 'google' | 'sogou' | 'duckduckgo'

export const searchEngines: { id: SearchEngineId; name: string; home: string; search: string }[] = [
  { id: 'bing', name: '必应', home: 'https://www.bing.com/', search: 'https://www.bing.com/search?q=' },
  { id: 'baidu', name: '百度', home: 'https://www.baidu.com/', search: 'https://www.baidu.com/s?wd=' },
  { id: 'google', name: 'Google', home: 'https://www.google.com/', search: 'https://www.google.com/search?q=' },
  { id: 'sogou', name: '搜狗', home: 'https://www.sogou.com/', search: 'https://www.sogou.com/web?query=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', home: 'https://duckduckgo.com/', search: 'https://duckduckgo.com/?q=' }
]

export function searchEngineOf(id: string | undefined): (typeof searchEngines)[number] {
  return searchEngines.find((item) => item.id === id) ?? searchEngines[0]
}

export type Settings = {
  tabLayout: TabLayout
  searchEngine: SearchEngineId
  mcpEnabled: boolean
  port: number
  batchConcurrency: number
  headlessLimit: number
}

export type SiteInfo = {
  domain: string
  lastOpenedAt: number
  cookiePresent?: boolean
}

export type EnvInfo = {
  id: string
  name: string
  remark: string
  isDefault: boolean
  windowOpen: boolean
  headless: boolean
  sites: SiteInfo[]
}

export type GroupInfo = {
  id: string
  envId: string
  name: string
  color: string
  tabIds: string[]
}

export type TabInfo = {
  id: string
  envId: string
  groupId: string | null
  kind: 'page' | 'settings' | 'market' | 'workflow'
  title: string
  url: string
  favicon?: string
  loading: boolean
  active: boolean
  pinned?: boolean
  muted?: boolean
  control: Control
}

export type CaptureInfo = {
  id: string
  tabId: string
  method: string
  url: string
  status?: number
  resourceType: string
  mimeType?: string
}

export type WorkflowNode = {
  id: string
  position?: { x: number; y: number }
  data: { type: string; title?: string } & Record<string, unknown>
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type WorkflowParamType = 'text' | 'number' | 'time' | 'time-range' | 'select' | 'checkbox'

export type WorkflowParam = {
  name: string
  description?: string
  type: WorkflowParamType
  options: string[]
}

export type WorkflowInfo = {
  id: string
  name: string
  remark: string
  icon: string
  params: WorkflowParam[]
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
}

export type UiState = {
  envId: string
  envName: string
  headless: boolean
  layout: TabLayout
  tabs: TabInfo[]
  groups: GroupInfo[]
  envs: EnvInfo[]
  workflows: WorkflowInfo[]
  captures: CaptureInfo[]
  canBack: boolean
  canForward: boolean
  screenRecording: boolean
  handoffMessage: string
  settings: Settings
  version: string
  maximized: boolean
  railPinned: boolean
  downloads: DownloadItem[]
}

export type DownloadItem = {
  id: string
  name: string
  url: string
  path: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  doneAt?: number
}

export type LayerPayload =
  | { kind: 'menu'; x: number; y: number }
  | { kind: 'context'; x: number; y: number; tab: TabInfo }
  | { kind: 'about' }
  | { kind: 'settings'; section: '环境' | '抓包' | '通用' | '关于' }
  | { kind: 'workflow'; id: string }

export type Locator = { selector?: string; xpath?: string; pierce?: boolean }

export type ActVia = 'inject' | 'native' | 'cdp'
export type GestureVia = 'cdp' | 'native'

export type WorkflowApp = {
  id: string
  kind: 'app'
  version: '0.3.0'
  app: { name: string; mode: 'workflow'; description: string; icon?: string }
  workflow: {
    environment_variables: { name: string; value: string }[]
    conversation_variables: []
    graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
  }
}

export const DEFAULT_ENV = 'env-default'

export const defaultSettings = (): Settings => ({
  tabLayout: 'top',
  searchEngine: 'bing',
  mcpEnabled: true,
  port: 39221,
  batchConcurrency: 3,
  headlessLimit: 3
})
