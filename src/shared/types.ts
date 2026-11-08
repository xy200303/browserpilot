export type Control = 'agent' | 'shared' | 'handoff'

export type TabLayout = 'top' | 'left'

export type SearchEngineId = 'bing' | 'baidu' | 'google' | 'sogou' | 'duckduckgo'

export const searchEngines: { id: SearchEngineId; name: string; home: string; search: string }[] = [
  { id: 'bing', name: '必应', home: 'https://www.bing.com/', search: 'https://www.bing.com/search?q=' }, // i18n-ignore 兜底名称，界面用 searchEngine.*
  { id: 'baidu', name: '百度', home: 'https://www.baidu.com/', search: 'https://www.baidu.com/s?wd=' }, // i18n-ignore
  { id: 'google', name: 'Google', home: 'https://www.google.com/', search: 'https://www.google.com/search?q=' },
  { id: 'sogou', name: '搜狗', home: 'https://www.sogou.com/', search: 'https://www.sogou.com/web?query=' }, // i18n-ignore
  { id: 'duckduckgo', name: 'DuckDuckGo', home: 'https://duckduckgo.com/', search: 'https://duckduckgo.com/?q=' }
]

export function searchEngineOf(id: string | undefined): (typeof searchEngines)[number] {
  return searchEngines.find((item) => item.id === id) ?? searchEngines[0]
}

export type AppLanguage = 'zh-CN' | 'en-US'

export type LanguageSetting = 'auto' | AppLanguage

export type Settings = {
  language: LanguageSetting
  tabLayout: TabLayout
  searchEngine: SearchEngineId
  mcpEnabled: boolean
  port: number
  batchConcurrency: number
  headlessLimit: number
  // 非活动标签空闲多少分钟后休眠（0 关闭）
  tabHibernateMinutes: number
  // 最小化或隐藏的窗口空闲多少分钟后关窗（0 关闭）
  closeIdleMinutes: number
  downloadDir: string
  passwordSave: boolean
  passwordAutofill: boolean
  toolMode: 'full' | 'search'
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
  kind: 'page' | 'settings' | 'market' | 'workflow' | 'downloads' | 'runs' | 'history' | 'bookmarks'
  title: string
  url: string
  favicon?: string
  loading: boolean
  progress: number
  error?: TabError
  active: boolean
  pinned?: boolean
  muted?: boolean
  audible?: boolean
  hibernated?: boolean
  control: Control
}

export type SuggestionKind = 'search' | 'history' | 'bookmark' | 'tab'

export type AddressSuggestion = {
  key: string
  kind: SuggestionKind
  title: string
  url: string
  favicon?: string
  titleIndices: number[]
  urlIndices: number[]
  tabId?: string
  hibernated?: boolean
  score: number
}

export type SuggestionFilters = { history: boolean; bookmarks: boolean; tabs: boolean }

export type SuggestPayload = {
  items: AddressSuggestion[]
  highlight: number
  filters: SuggestionFilters
  query: string
  left: number
  width: number
}

export type TabError = { code: number; description: string; url: string }

export type HistoryEntry = {
  id: string
  envId: string
  url: string
  title: string
  favicon?: string
  visitedAt: number
}

export type BookmarkEntry = {
  id: string
  envId: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

export type PasswordEntry = {
  id: string
  envId: string
  origin: string
  username: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export type PermissionDecision = 'allow' | 'deny'

export type PermissionRule = {
  id: string
  envId: string
  origin: string
  permission: string
  decision: PermissionDecision
  updatedAt: number
}

export type SessionTab = {
  url: string
  title: string
  groupId?: string | null
}

export type SessionState = {
  tabs: SessionTab[]
  activeUrl?: string
  savedAt: number
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
  bookmarks: BookmarkEntry[]
  permissions: PermissionRule[]
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
  envId?: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'paused' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  doneAt?: number
}

export type LayerPayload =
  | { kind: 'menu'; x: number; y: number }
  | { kind: 'context'; x: number; y: number; tab: TabInfo }
  | { kind: 'about' }
  | { kind: 'settings'; section?: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'tabs' }
  | { kind: 'bookmarks'; x: number; y: number }
  | { kind: 'suggest' }
  | { kind: 'env'; envId: string; x: number; y: number }

export type Locator = {
  selector?: string
  xpath?: string
  pierce?: boolean
  /** 按元素的可访问名称（通常是可见文字）定位，工作流里比选择器抗改版 */
  text?: string
  textMatch?: 'exact' | 'contains'
  /** 可访问角色，如 button、link、menuitem */
  role?: string
  /** 角色之外的名称匹配，和 role 一起用等于 getByRole(role, { name }) */
  name?: string
  nameMatch?: 'exact' | 'contains'
}

export type ActVia = 'inject' | 'native' | 'cdp' | 'pointer'
export type GestureVia = 'cdp' | 'native' | 'pointer'

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
  language: 'auto',
  tabLayout: 'top',
  searchEngine: 'bing',
  mcpEnabled: true,
  port: 39221,
  batchConcurrency: 3,
  headlessLimit: 3,
  tabHibernateMinutes: 15,
  closeIdleMinutes: 0,
  downloadDir: '',
  passwordSave: true,
  passwordAutofill: true,
  toolMode: 'search'
})
