import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { clipboard, session } from 'electron'
import { mkdirSync } from 'fs'
import { rm } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { DEFAULT_ENV, type ActVia, type Control, type Locator, type WorkflowApp } from '@shared/types'
import { searchEngines } from '@shared/types'
import { createId } from '../ids'
import { bridge, publicControl, windows, type TabRuntime } from '../runtime'
import { storage } from './store'
import { downloadCancel, downloadCopyLink, downloadForget, downloadOpen, downloadPause, downloadResume, downloadShow, downloadTargetDir, downloadsClear, listDownloads } from './DownloadService'
import { clearPasswords } from './PasswordService'
import { listPasswords, passwordStorageStatus } from './PasswordService'
import { answerPendingDialog, dialogPolicy, pendingDialog, recentDialogs, setDialogPolicy } from '../dialogs'
import { clearConsole, consoleFor } from '../console-log'
import { connectInfo, copyConnectInfo } from './ConnectService'
import { windowPreview } from './WindowPreviewService'
import {
  activateTab,
  addTab,
  applyHeadless,
  beginAgentAction,
  beginHandoff,
  closeTab,
  closeWorkflowPages,
  closeOtherTabs,
  duplicateTab,
  muteTab,
  restoreTab,
  openEnvironment,
  resolveTab,
  saveSessionNow,
  shareControl,
  showAgentMask
} from '../windows'
import {
  clickDeep,
  clickLocator,
  clickHit,
  clickPoint,
  clickText,
  clickTextInFrame,
  clickLocatorInFrame,
  crossQuery,
  deepQuery,
  dragPage,
  drawPath,
  drawPaths,
  drawShapePoints,
  fillScanlines,
  fillSerpentine,
  svgPathToPoints,
  turtleRun,
  evalInFrame,
  evalSource,
  findInPage,
  hitPoint,
  hoverLocator,
  hoverLocatorInFrame,
  hoverHit,
  hoverPoint,
  hoverText,
  hoverTextInFrame,
  inspectElement,
  locatorCenter,
  locatorGesturePoint,
  locatorLabel,
  mapPoint,
  navigate,
  normalizeUrl,
  pageSource,
  pasteLocator,
  pressShortcut,
  readTree,
  queryLocator,
  recordVideo,
  resolveHit,
  resolveLocator,
  saveMedia,
  screenshotRegion,
  screenshot,
  scrollPage,
  selectLocator,
  sendCdp,
  sendCdpBatch,
  swipePage,
  typeAtPoint,
  typeByLabel,
  typeDeep,
  typeLocator,
  typeLocatorInFrame,
  uploadFiles,
  waitForGone,
  waitForLoad,
  waitForLocator
} from '../page'
import { captchaPanelShot, captchaRead, detectCaptcha, solveCaptcha } from '../captcha'
import { deleteWorkflow, exportWorkflow, findWorkflow, importWorkflow, runWorkflow, workflowParams, workflowUpdate, workflowWrite } from './RecordService'
import { netExport, netGet, netList, netMock, netMockOff, netStart, netStop } from './NetService'
import { writeFileSync, readFileSync, statSync } from 'fs'

const tab = z.string().optional()
const env = z.string().optional()

export type ToolResult = {
  ok: boolean
  control: Control
  takenOver?: boolean
  error?: string
  [key: string]: unknown
}

type Tool = {
  name: string
  description: string
  schema: z.ZodTypeAny
  run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

function controlOf(tabId?: string, envId?: string): Control {
  if (tabId) {
    for (const win of windows.values()) {
      const found = win.tabs.find((item) => item.id === tabId)
      if (found) return publicControl(found)
    }
  }
  const win = windows.get(envId || DEFAULT_ENV)
  const active = win?.tabs.find((item) => item.id === win.activeTabId)
  return publicControl(active)
}

async function finish(args: { tabId?: string; env?: string }, data: Record<string, unknown>, tabRef?: TabRuntime): Promise<ToolResult> {
  return { ok: data.ok !== false, control: tabRef ? publicControl(tabRef) : controlOf(args.tabId, args.env), ...data }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function imageOf(path: string): { mimeType: string; data: string; bytes: number } | undefined {
  const data = readFileSync(path)
  if (!data.length || data.length > MAX_IMAGE_BYTES) return undefined
  return { mimeType: 'image/png', data: data.toString('base64'), bytes: data.length }
}

const tools: Tool[] = []
const shapes = new Map<string, z.ZodRawShape>()

function viaOf(value: unknown): ActVia {
  if (value === 'inject' || value === 'native' || value === 'cdp') return value
  return 'cdp'
}

function numArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

const shotRefs = new Map<string, { shot: { width: number; height: number; originX?: number; originY?: number; scale?: number }; at: number }>()

function rememberShot(shot: { width: number; height: number; originX?: number; originY?: number; scale?: number }): string {
  const id = createId('shot')
  shotRefs.set(id, { shot, at: Date.now() })
  if (shotRefs.size > 32) {
    const oldest = [...shotRefs.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) shotRefs.delete(oldest[0])
  }
  return id
}

function pointArgs(args: { x?: unknown; y?: unknown; shotId?: unknown; shotWidth?: unknown; shotHeight?: unknown; shotX?: unknown; shotY?: unknown; shotScale?: unknown }): { x: number; y: number; shot?: { width: number; height: number; originX?: number; originY?: number; scale?: number } } | undefined {
  const hasX = args.x != null && args.x !== ''
  const hasY = args.y != null && args.y !== ''
  if (!hasX && !hasY) return undefined
  const x = numArg(args.x)
  const y = numArg(args.y)
  if (x === undefined || y === undefined) throw new Error('画布坐标要同时写 x 和 y')
  const shotId = typeof args.shotId === 'string' && args.shotId ? args.shotId : ''
  if (shotId) {
    const stored = shotRefs.get(shotId)
    if (!stored) throw new Error(`截图编号已失效：${shotId}，重新截一张再点`)
    return { x, y, shot: stored.shot }
  }
  const hasW = args.shotWidth != null && args.shotWidth !== ''
  const hasH = args.shotHeight != null && args.shotHeight !== ''
  if (hasW !== hasH) throw new Error('截图宽高要一起写')
  if (!hasW) return { x, y }
  const width = numArg(args.shotWidth)
  const height = numArg(args.shotHeight)
  if (width === undefined || height === undefined) throw new Error('截图宽高要是数字')
  const hasOX = args.shotX != null && args.shotX !== ''
  const hasOY = args.shotY != null && args.shotY !== ''
  const hasScale = args.shotScale != null && args.shotScale !== ''
  if (hasOX || hasOY || hasScale) {
    if (!(hasOX && hasOY && hasScale)) throw new Error('shotX、shotY、shotScale 要一起写')
    const originX = numArg(args.shotX)
    const originY = numArg(args.shotY)
    const scale = numArg(args.shotScale)
    if (originX === undefined || originY === undefined || scale === undefined) throw new Error('shotX、shotY、shotScale 要是数字')
    return { x, y, shot: { width, height, originX, originY, scale } }
  }
  return { x, y, shot: { width, height } }
}

function gestureVia(value: unknown): 'cdp' | 'native' {
  return value === 'native' ? 'native' : 'cdp'
}

function locatorFrom(args: { xpath?: unknown; selector?: unknown; pierce?: unknown }): Locator | undefined {
  const xpath = typeof args.xpath === 'string' && args.xpath ? args.xpath : undefined
  const selector = typeof args.selector === 'string' && args.selector ? args.selector : undefined
  if (xpath || selector) return { xpath, selector, pierce: Boolean(args.pierce) || undefined }
  return undefined
}

const locateFields = {
  xpath: z.string().optional(),
  selector: z.string().optional(),
  pierce: z.boolean().optional()
}

const NEED_LOCATOR = '需要 xpath 或 selector'

const DEFAULT_TOOL_TIMEOUT = 90_000
const toolTimeouts = new Map<string, number>()

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function tool(name: string, description: string, schema: z.ZodTypeAny, run: Tool['run']): void {
  tools.push({ name, description, schema, run })
  if (schema instanceof z.ZodObject) shapes.set(name, schema.shape)
}
const TOOL_GROUPS: Array<[string, string]> = [
  ['env_', '环境'],
  ['tab_', '标签'],
  ['group_', '分组'],
  ['page_', '页面'],
  ['screen_', '录屏'],
  ['workflow_', '工作流'],
  ['net_', '网络'],
  ['captcha_', '验证码'],
  ['bookmark_', '书签'],
  ['history_', '历史'],
  ['session_', '会话'],
  ['cookie_', 'Cookie'],
  ['download_', '下载'],
  ['clipboard_', '剪贴板'],
  ['settings_', '设置'],
  ['permission_', '权限'],
  ['password_', '密码'],
  ['search_', '工具检索']
]

const TOOL_KEYWORDS: Record<string, string> = {
  env_close: '关窗 关闭窗口 关掉窗口 保留登录',
  env_headless: '无头 有头 后台 隐藏窗口 显示窗口',
  env_front: '前置窗口 切到前台 显示窗口 窗口聚焦 拿回焦点 录屏前',
  env_delete: '删环境 清登录',
  env_export: '导出登录 导出cookie',
  env_import: '导入登录 恢复登录',
  tab_restore: '恢复标签 重开标签 撤销关闭 刚关的标签',
  tab_duplicate: '复制标签 克隆标签',
  tab_close_others: '关闭其他标签 只留一个',
  tab_mute: '静音 取消静音',
  group_delete: '删分组 解散分组',
  page_screenshot: '截图 截屏 元素截图 区域截图 screenshot 拍图',
  page_snapshot: '快照 无障碍树 snapshot a11y',
  page_dialog: '弹窗 对话框 确认框 alert confirm prompt',
  page_console: '控制台 console 报错 js错误 日志',
  page_find: '页内查找 查找文字 ctrl+f find',
  page_hover: '悬停 悬浮 移上去 hover 按文字 text role name within index frame iframe',
  page_click: '点击 双击 右键 click dblclick 按文字 文本 text role name 角色 名称 within index 第几个 frame iframe',
  page_type: '输入 填写 打字 type label 标签 placeholder frame iframe',
  page_wait: '等待 等元素 wait',
  page_wait_load: '等加载 加载完成 页面加载完',
  page_save_media: '保存图片 保存视频 下载媒体 抓图 存媒体',
  page_record_video: '录像 录制视频 录屏视频',
  page_upload: '上传文件 文件选择',
  page_script: '执行脚本 js eval',
  page_source: '源码 html 源码文本',
  page_hit: '命中元素 坐标反查',
  page_watch: '盯元素 等变化 监听元素',
  download_list: '下载记录 下载列表 文件在哪 落盘路径',
  download_dir: '下载目录 保存位置 改下载路径',
  download_action: '暂停下载 继续下载 取消下载 重试下载 打开文件',
  bookmark_add: '加书签 收藏 保存网址',
  bookmark_list: '书签 收藏夹',
  bookmark_remove: '删书签',
  history_list: '历史记录 浏览记录 访问记录',
  history_remove: '删历史 清历史',
  session_list: '会话列表 标签快照',
  session_save: '保存会话 快照标签',
  session_restore: '恢复会话 打开上次标签 恢复标签组',
  session_clear: '清会话',
  cookie_list: 'cookie 登录态 会话凭证',
  cookie_set: '写cookie 设置cookie',
  cookie_remove: '删cookie 清cookie',
  clipboard_read: '剪贴板 读取剪贴板 复制内容',
  clipboard_write: '写剪贴板 复制到剪贴板',
  settings_get: '设置 配置 读取设置',
  settings_set: '改设置 配置',
  permission_list: '权限 站点权限 摄像头 麦克风 通知 位置',
  password_list: '密码 账号 保存的密码',
  captcha_solve: '验证码 滑块 极验',
  captcha_read: '文字验证码 识别字符',
  captcha_panel: '验证码截图 点选验证码',
  net_start: '抓包 网络请求 监听请求',
  net_export: '导出har 抓包导出',
  net_mock: '拦截请求 假数据 mock',
  workflow_run: '工作流 执行工作流',
  workflow_write: '写工作流 编辑流程',
  screen_start: '录屏 录制窗口',
  window_preview: '整窗预览 整窗截图',
  search_tools: '找工具 搜工具 工具列表'
}

function groupOf(name: string): string {
  return TOOL_GROUPS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? '其它'
}

function rankTool(name: string, tokens: string[]): number {
  if (!tokens.length) return 0
  const lower = name.toLowerCase()
  if (tokens.every((token) => lower === token)) return 0
  if (tokens.every((token) => lower.startsWith(token))) return 1
  if (tokens.every((token) => lower.includes(token))) return 2
  const extra = `${TOOL_KEYWORDS[name] ?? ''} ${groupOf(name)}`.toLowerCase()
  const words = extra.split(/[s,，]+/).filter(Boolean)
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 2.5
  if (tokens.every((token) => extra.includes(token))) return 2.8
  return 3
}

tool('search_tools', '按关键词搜工具，名称、描述、分组都会匹配，空格分隔多个词（全部命中才算）。分页返回 total / page / page_size，每条带参数 schema，查到后直接用 name 调用即可。传 name 精确取一个工具的完整定义；不传关键词就按目录顺序列全部。工具很多时先搜再用，不要凭记忆猜参数。', z.object({
  query: z.string().optional(),
  name: z.string().optional(),
  page: z.number().optional(),
  page_size: z.number().optional()
}), async (args) => {
  const schemaOf = (toolName: string): unknown => {
    const meta = tools.find((item) => item.name === toolName)
    if (!meta) return undefined
    try {
      return zodToJsonSchema(meta.schema, { target: 'jsonSchema7' })
    } catch {
      return undefined
    }
  }
  if (typeof args.name === 'string' && args.name) {
    const wanted = args.name.trim().toLowerCase()
    const exact = tools.find((item) => item.name.toLowerCase() === wanted)
    if (!exact) throw new Error(`没有这个工具：${args.name}。用 search_tools 传 query 先搜`)
    return {
      tool: { name: exact.name, group: groupOf(exact.name), description: exact.description, inputSchema: schemaOf(exact.name) }
    }
  }
  const query = String(args.query ?? '').trim()
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const pageSize = Math.max(1, Math.min(50, Number(args.page_size ?? 10)))
  const matched = tools
    .filter((item) => {
      if (!tokens.length) return true
      const hay = `${item.name} ${item.description} ${groupOf(item.name)} ${TOOL_KEYWORDS[item.name] ?? ''}`.toLowerCase()
      return tokens.every((token) => hay.includes(token))
    })
    .sort((a, b) => rankTool(a.name, tokens) - rankTool(b.name, tokens) || a.name.localeCompare(b.name))
  const pages = Math.max(1, Math.ceil(matched.length / pageSize))
  const page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
  const slice = matched.slice((page - 1) * pageSize, page * pageSize)
  return {
    query,
    total: matched.length,
    page,
    page_size: pageSize,
    pages,
    tools: slice.map((item) => ({
      name: item.name,
      group: groupOf(item.name),
      description: item.description,
      inputSchema: schemaOf(item.name)
    }))
  }
})


export function shapeOf(name: string): z.ZodRawShape {
  return shapes.get(name) ?? {}
}

tool('env_list', '列出环境编号、名称、备注、窗口是否开着、有头还是无头。不返回 Cookie。', z.object({}), async () => ({
  envs: await Promise.all(storage.envs.map(async (item) => ({
    id: item.id,
    name: item.name,
    remark: item.remark,
    isDefault: item.id === DEFAULT_ENV,
    windowOpen: windows.has(item.id),
    headless: windows.get(item.id)?.headless ?? false,
    sites: item.sites
  })))
}))

tool('env_create', '新建一套空环境，并打开一扇有头窗口。remark 必填，写清这套环境用来做什么（例如「客户 A 的后台」「知乎账号 2」），方便以后识别。', z.object({
  name: z.string().min(1),
  remark: z.string().min(1)
}), async (args) => {
  const id = createId('env')
  const name = String(args.name).trim()
  const remark = String(args.remark).trim()
  storage.envs.push({ id, name, remark, sites: [] })
  storage.saveEnvs()
  openEnvironment(id, false)
  return { env: id, name, remark }
})

tool('env_open', '打开已有环境的窗口。人打开时用有头。批量可传 headless true。只保证窗口存在，不会把窗口带到前台；需要让用户看到窗口时用 env_front。', z.object({
  env: z.string(),
  headless: z.boolean().optional()
}), async (args) => {
  const id = String(args.env)
  if (!storage.envs.some((item) => item.id === id)) throw new Error(`没有这套环境 ${id}`)
  const runtime = openEnvironment(id, Boolean(args.headless))
  return { env: id, headless: runtime.headless }
})

tool('env_front', '把某个环境的窗口带到前台并聚焦，可选先切到指定标签。默认所有工具都不会前置窗口；只有需要让用户看窗口、人工交接或录屏前才调用这个。', z.object({
  env: env,
  tabId: z.string().optional()
}), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = openEnvironment(envId, false)
  if (runtime.headless) throw new Error('无头窗口没有画面，先有头打开再前置')
  let tabId = runtime.activeTabId
  if (args.tabId) {
    const tab = runtime.tabs.find((item) => item.id === String(args.tabId))
    if (!tab) throw new Error(`没有这个标签 ${args.tabId}`)
    activateTab(runtime, tab.id, false)
    tabId = tab.id
  }
  if (runtime.win.isMinimized()) runtime.win.restore()
  runtime.win.show()
  // 后台进程直接 focus 会被 Windows 拒绝；先临时置顶保证用户能看到，2 秒后恢复普通层级
  runtime.win.setAlwaysOnTop(true, 'screen-saver')
  runtime.win.moveTop()
  runtime.win.focus()
  setTimeout(() => {
    if (!runtime.win.isDestroyed()) {
      runtime.win.setAlwaysOnTop(false)
      runtime.win.moveTop()
    }
  }, 2000)
  return { env: envId, tabId }
})

tool('env_update', '改环境的名称或备注，编号不变。', z.object({
  env: z.string(),
  name: z.string().optional(),
  remark: z.string().optional()
}), async (args) => {
  const item = storage.envs.find((envItem) => envItem.id === args.env)
  if (!item) throw new Error(`没有这套环境 ${String(args.env)}`)
  if (typeof args.name === 'string') item.name = args.name
  if (typeof args.remark === 'string') item.remark = args.remark
  storage.saveEnvs()
  const runtime = windows.get(item.id)
  if (runtime) runtime.win.setTitle(`${item.name} · BrowserPilot`)
  return { env: item.id, name: item.name, remark: item.remark }
})

tool('env_delete', '关掉这套环境的窗口并清掉登录。默认环境不能删。', z.object({ env: z.string() }), async (args) => {
  const id = String(args.env)
  if (id === DEFAULT_ENV) throw new Error('默认环境不能删除')
  const runtime = windows.get(id)
  runtime?.win.close()
  const ses = session.fromPartition(`persist:${id}`)
  await ses.clearStorageData()
  await ses.clearCache()
  await rm(join(storage.userData(), 'Partitions', id), { recursive: true, force: true }).catch(() => undefined)
  storage.envs = storage.envs.filter((item) => item.id !== id)
  storage.groups = storage.groups.filter((item) => item.envId !== id)
  storage.saveEnvs()
  storage.saveGroups()
  storage.clearSession(id)
  storage.clearHistory(id)
  storage.clearBookmarks(id)
  storage.clearPermissions(id)
  clearPasswords(id)
  return { env: id }
})

tool('tab_list', '列出全部窗口里的标签。编号全局唯一。', z.object({}), async () => ({
  tabs: [...windows.values()].flatMap((win) => win.tabs.map((item) => ({
    id: item.id,
    envId: item.envId,
    groupId: item.groupId,
    title: item.title,
    url: item.url,
    kind: item.kind
  })))
}))

tool('tab_open', '在环境的窗口里新开标签。不传 env 用默认环境。', z.object({
  url: z.string(),
  env: env
}), async (args) => {
  const runtime = openEnvironment(String(args.env || DEFAULT_ENV), windows.get(String(args.env || DEFAULT_ENV))?.headless ?? false)
  const tabRef = addTab(runtime, String(args.url), null, null, false)
  return { tabId: tabRef.id, env: runtime.envId }
})

tool('tab_close', '按全局编号关掉标签。', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  closeTab(win, tabRef.id)
  return { tabId: tabRef.id }
})

tool('tab_activate', '按全局编号切换活动标签。只切标签，不把窗口带到前台；需要显示窗口用 env_front。', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  if (win.headless) applyHeadless(win, false)
  activateTab(win, tabRef.id, false)
  return { tabId: tabRef.id }
})

tool('group_create', '在一套环境的窗口里新建分组。', z.object({
  name: z.string(),
  color: z.string().optional(),
  env: env
}), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const id = createId('grp')
  storage.groups.push({ id, envId, name: String(args.name), color: String(args.color || '#1a73e8') })
  storage.saveGroups()
  return { groupId: id, env: envId }
})

tool('group_update', '改分组的名称或颜色，编号不变。', z.object({
  groupId: z.string(),
  name: z.string().optional(),
  color: z.string().optional()
}), async (args) => {
  const group = storage.groups.find((item) => item.id === args.groupId)
  if (!group) throw new Error(`没有这个分组 ${String(args.groupId)}`)
  if (typeof args.name === 'string') group.name = args.name
  if (typeof args.color === 'string') group.color = args.color
  storage.saveGroups()
  return { groupId: group.id, name: group.name, color: group.color }
})

tool('group_list', '列出分组和里面的标签。', z.object({ env: env }), async (args) => ({
  groups: storage.groups
    .filter((item) => !args.env || item.envId === args.env)
    .map((item) => ({
      ...item,
      tabIds: (windows.get(item.envId)?.tabs ?? []).filter((tabItem) => tabItem.groupId === item.id).map((tabItem) => tabItem.id)
    }))
}))

tool('tab_group', '把标签放进分组。groupId 为空则移出。', z.object({
  tabId: z.string(),
  groupId: z.string().nullable().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const groupId = args.groupId ? String(args.groupId) : null
  if (groupId) {
    const group = storage.groups.find((item) => item.id === groupId)
    if (!group || group.envId !== tabRef.envId) throw new Error('分组不在这个窗口里')
  }
  tabRef.groupId = groupId
  return { tabId: tabRef.id, groupId }
})

const pageArgs = {
  tabId: tab,
  env: env
}

async function pageTab(args: Record<string, unknown>, lock = true): Promise<TabRuntime> {
  const resolved = resolveTab({
    tabId: args.tabId ? String(args.tabId) : undefined,
    env: args.env ? String(args.env) : undefined
  }, true)
  if (lock) beginAgentAction(resolved.tab)
  return resolved.tab
}

tool('env_close', '关掉这套环境的窗口，保留登录态、Cookie 和标签会话。和 env_delete 不同，后者会把登录一起清掉。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) return { env: envId, closed: false }
  runtime.win.close()
  return { env: envId, closed: true }
})

tool('env_headless', '把已经打开的环境在有头和无头之间切换。无头时窗口不可见，截图和脚本照常。', z.object({
  env: env,
  headless: z.boolean()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(`这套环境的窗口没开：${envId}`)
  const headless = Boolean(args.headless)
  applyHeadless(runtime, headless)
  bridge.broadcast(envId)
  return { env: envId, headless }
})

tool('tab_restore', '重新打开刚关掉的标签（按关闭顺序恢复）。没有可恢复的就返回 restored: false。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(`这套环境的窗口没开：${envId}`)
  const restored = restoreTab(runtime)
  return { env: envId, restored: Boolean(restored), tabId: restored?.id, url: restored?.url }
})

tool('tab_duplicate', '复制一个标签：同一个地址再开一个，放在原标签后面。', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const copy = duplicateTab(win, tabRef.id)
  if (!copy) throw new Error(`这个标签复制不了：${tabRef.id}`)
  return { tabId: copy.id, from: tabRef.id, url: copy.url }
})

tool('tab_close_others', '关掉同一个窗口里除这个标签以外的所有标签。', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  closeOtherTabs(win, tabRef.id)
  return { tabId: tabRef.id, remaining: win.tabs.length }
})

tool('tab_mute', '切换标签静音。', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  muteTab(win, tabRef.id)
  return { tabId: tabRef.id, muted: Boolean(tabRef.muted) }
})

tool('group_delete', '删掉一个分组。组里的标签保留，只是不再分组。', z.object({
  groupId: z.string()
}), async (args) => {
  const id = String(args.groupId)
  const group = storage.groups.find((item) => item.id === id)
  if (!group) throw new Error(`没有这个分组 ${id}`)
  storage.groups = storage.groups.filter((item) => item.id !== id)
  storage.saveGroups()
  const runtime = windows.get(group.envId)
  if (runtime) {
    for (const tabRef of runtime.tabs) {
      if (tabRef.groupId === id) tabRef.groupId = null
    }
    bridge.layout(group.envId)
  }
  bridge.broadcast(group.envId)
  return { groupId: id, name: group.name }
})

tool('permission_list', '列出这套环境记住的站点权限（摄像头、麦克风、通知、位置等）。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  return {
    env: envId,
    permissions: storage.permissionsFor(envId).map((item) => ({
      id: item.id,
      origin: item.origin,
      permission: item.permission,
      decision: item.decision,
      updatedAt: item.updatedAt
    }))
  }
})

tool('password_list', '列出这套环境保存的登录账号，只有站点和账号，不含密码。用来判断某个站点能不能靠自动填充登录。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  return { env: envId, passwords: listPasswords(envId), storage: passwordStorageStatus() }
})

const SETTING_KEYS = ['tabLayout', 'searchEngine', 'passwordSave', 'passwordAutofill', 'batchConcurrency', 'headlessLimit', 'toolMode'] as const

function pickSettings(): Record<string, unknown> {
  return {
    tabLayout: storage.settings.tabLayout,
    searchEngine: storage.settings.searchEngine,
    passwordSave: storage.settings.passwordSave,
    passwordAutofill: storage.settings.passwordAutofill,
    batchConcurrency: storage.settings.batchConcurrency,
    headlessLimit: storage.settings.headlessLimit,
    toolMode: storage.settings.toolMode
  }
}

tool('settings_get', '读取浏览器设置：标签栏位置、搜索引擎、密码开关、批量并发、无头窗口上限。端口和 MCP 开关属于本机服务配置，不在这里。', z.object({}), async () => ({ settings: pickSettings() }))

tool('settings_set', '改浏览器设置。只支持 tabLayout（top/left）、searchEngine、passwordSave、passwordAutofill、batchConcurrency、headlessLimit、toolMode（full / search）。改完立即生效。', z.object({
  tabLayout: z.enum(['top', 'left']).optional(),
  searchEngine: z.string().optional(),
  passwordSave: z.boolean().optional(),
  passwordAutofill: z.boolean().optional(),
  batchConcurrency: z.number().optional(),
  headlessLimit: z.number().optional(),
  toolMode: z.enum(['full', 'search']).optional()
}), async (args) => {
  const patch: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    if (args[key] !== undefined) patch[key] = args[key]
  }
  if (!Object.keys(patch).length) throw new Error(`没有要改的字段，可选：${SETTING_KEYS.join('、')}`)
  if (typeof patch.searchEngine === 'string' && !searchEngines.some((item) => item.id === patch.searchEngine)) {
    throw new Error(`不认识这个搜索引擎：${patch.searchEngine}，可选：${searchEngines.map((item) => item.id).join('、')}`)
  }
  if (patch.batchConcurrency !== undefined) patch.batchConcurrency = Math.max(1, Math.min(3, Number(patch.batchConcurrency) || 1))
  if (patch.headlessLimit !== undefined) patch.headlessLimit = Math.max(1, Number(patch.headlessLimit) || 1)
  storage.settings = { ...storage.settings, ...patch }
  storage.saveSettings()
  if (patch.tabLayout !== undefined) {
    for (const runtime of windows.values()) bridge.layout(runtime.envId)
  }
  bridge.broadcast()
  return { settings: pickSettings() }
})

async function readClipboard(): Promise<string> {
  const value = clipboard.readText() as unknown
  if (typeof value === 'string') return value
  return String((await (value as Promise<unknown>)) ?? '')
}

async function writeClipboard(text: string): Promise<void> {
  const written = clipboard.writeText(text) as unknown
  if (written instanceof Promise) await written
}

tool('clipboard_read', '读系统剪贴板里的文本。可能含敏感内容，只在本机用，不要贴到对话里。', z.object({}), async () => ({ text: await readClipboard() }))

tool('clipboard_write', '把一段文本写进系统剪贴板。', z.object({
  text: z.string()
}), async (args) => {
  const text = String(args.text)
  await writeClipboard(text)
  return { ok: true, length: text.length }
})

tool('page_navigate', '打开地址。', z.object({ ...pageArgs, url: z.string() }), async (args) => {
  const tabRef = await pageTab(args)
  await navigate(tabRef, String(args.url))
  return { tabId: tabRef.id, url: tabRef.url }
})

tool('page_back', '后退。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.navigationHistory.goBack()
  return { tabId: tabRef.id }
})

tool('page_forward', '前进。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.navigationHistory.goForward()
  return { tabId: tabRef.id }
})

tool('page_reload', '刷新。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.reload()
  await waitForLoad(tabRef.view!.webContents).catch(() => undefined)
  return { tabId: tabRef.id }
})

tool('page_snapshot', '读取当前无障碍树。编号只对这一次有效。不改变当前是谁在操作。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args, false)
  const tree = await readTree(tabRef)
  return { tabId: tabRef.id, snapshot: tree.text }
})

tool('page_query', '按同一种定位取出所有匹配，返回数组。每一项有序号、文字、当前能不能点到和位置 rect。点击和输入不走这个数组，它们必须恰好匹配一个。pierce 为 true 时穿透 Shadow DOM 和同源 iframe 查找。', z.object({
  ...pageArgs, ...locateFields
}), async (args) => {
  const locator = locatorFrom(args)
  if (!locator) throw new Error(NEED_LOCATOR)
  const tabRef = await pageTab(args, false)
  if (locator.pierce) {
    let found = await deepQuery(tabRef, locator)
    if (found.total === 0) {
      const cross = await crossQuery(tabRef, locator).catch(() => ({ total: 0, matches: [] }))
      found = cross
    }
    return { tabId: tabRef.id, total: found.total, matches: found.matches.map((m, i) => ({ index: i, text: m.text, hittable: m.w > 0 && m.h > 0, rect: { x: m.x, y: m.y, w: m.w, h: m.h } })) }
  }
  const found = await queryLocator(tabRef, locator)
  return { tabId: tabRef.id, total: found.total, matches: found.matches }
})

tool('page_click', '点击元素。优先用 text 按可见文字点（可选 textMatch: exact，默认包含），不用自己算坐标；也可以用 role + name（可访问角色和名称，nameMatch: exact），或用 xpath 或 selector。within 限定了搜索容器（CSS 选择器），index 取第几个匹配（从 0 开始）。跨域 iframe 里的元素传 frame（src 包含的一段）配 selector/xpath 或 text。button 传 right 是右键。画布这种没有稳定节点的目标改用 x 和 y：不带截图信息时是当前视口的 CSS 像素；把 page_screenshot 返回的 shotId 原样传进来，x 和 y 就用图片上的像素，工具会自动换算到视口（也可以继续用 shotWidth、shotHeight、shotX、shotY、shotScale 手动换算）。via 默认 cdp：Input.dispatchMouseEvent。native 用 sendInputEvent。inject 在该点的元素上派发指针事件。untilXpath 或 untilSelector 只在按元素点击时使用，表示点完后要出现的元素；没出现会在同一个定位上再点，最多 3 次。失败时带上匹配个数、文字和当时能不能点到。count 传 2 是双击（最多 3 连击）。', z.object({
  ...pageArgs,
  ...locateFields,
  text: z.string().optional(),
  textMatch: z.enum(['exact', 'contains']).optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  nameMatch: z.enum(['exact', 'contains']).optional(),
  within: z.string().optional(),
  index: z.number().optional(),
  frame: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  button: z.enum(['left', 'right']).optional(),
  untilXpath: z.string().optional(),
  untilSelector: z.string().optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional(),
  count: z.number().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const button = args.button === 'right' ? 'right' as const : 'left' as const
  const count = Math.max(1, Math.min(3, Number(args.count ?? 1))) 
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  const text = typeof args.text === 'string' && args.text.trim() ? String(args.text) : ''
  const textMatch = args.textMatch === 'exact' ? 'exact' as const : 'contains' as const
  const needsHit = Boolean(args.role || args.name || args.within || args.index !== undefined)
  if (needsHit) {
    const hit = await resolveHit(tabRef, {
      selector: typeof args.selector === 'string' ? String(args.selector) : undefined,
      xpath: typeof args.xpath === 'string' ? String(args.xpath) : undefined,
      text: text || undefined,
      textMatch,
      role: args.role ? String(args.role) : undefined,
      name: args.name ? String(args.name) : undefined,
      nameMatch: args.nameMatch === 'exact' ? 'exact' : 'contains',
      within: args.within ? String(args.within) : undefined,
      index: args.index === undefined ? undefined : Number(args.index)
    }, frame || undefined)
    if (!hit) throw new Error('没有匹配到目标元素')
    await clickHit(tabRef, hit, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label, x: Math.round(hit.x), y: Math.round(hit.y), index: typeof args.index === 'number' ? args.index : undefined }
  }
  if (frame) {
    if (text) {
      const hit = await clickTextInFrame(tabRef, frame, text, textMatch, viaOf(args.via))
      return { tabId: tabRef.id, text: hit.label, x: Math.round(hit.x), y: Math.round(hit.y) }
    }
    const located = locatorFrom(args)
    if (!located) throw new Error('frame 里点击需要 xpath 或 selector，或 text')
    const hit = await clickLocatorInFrame(tabRef, frame, located, viaOf(args.via))
    return { tabId: tabRef.id, x: Math.round(hit.x), y: Math.round(hit.y) }
  }
  if (text) {
    const hit = await clickText(tabRef, text, textMatch, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label, x: Math.round(hit.x), y: Math.round(hit.y) }
  }
  const point = pointArgs(args)
  if (point) {
    await clickPoint(tabRef, point.x, point.y, viaOf(args.via), point.shot, button, count)
    return { tabId: tabRef.id }
  }
  const located = locatorFrom(args)
  if (!located) throw new Error('需要 xpath 或 selector、text，或画布坐标 x 和 y')
  if (located.pierce) {
    await clickDeep(tabRef, located, viaOf(args.via), button)
    return { tabId: tabRef.id }
  }
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await clickLocator(tabRef, located, viaOf(args.via), until, button, count)
  return { tabId: tabRef.id }
})

tool('page_wait', '等元素出现或消失。state 默认 appear（出现），gone 是消失。timeout 是秒，默认 10，最长 60。导航后、点按钮触发异步渲染后用它等，不要写死 sleep 循环。pierce 为 true 时穿透 Shadow DOM 和同源 iframe 查找。', z.object({
  ...pageArgs, ...locateFields,
  state: z.enum(['appear', 'gone']).default('appear'),
  timeout: z.number().optional()
}), async (args) => {
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  const tabRef = await pageTab(args)
  const timeout = Math.max(1, Math.min(60, Number(args.timeout ?? 10))) * 1000
  if (located.pierce) {
    const started = Date.now()
    for (;;) {
      const found = await deepQuery(tabRef, located).catch(() => ({ total: 0 }))
      const present = found.total > 0
      if ((args.state === 'gone' && !present) || (args.state !== 'gone' && present)) {
        return { tabId: tabRef.id, state: args.state }
      }
      if (Date.now() - started >= timeout) throw new Error(`超时还没${args.state === 'gone' ? '消失' : '出现'} ${locatorLabel(located)}（穿透）`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (args.state === 'gone') await waitForGone(tabRef, located, timeout)
  else await waitForLocator(tabRef, located, timeout)
  return { tabId: tabRef.id, state: args.state }
})

tool('page_type', '输入文字。via 默认 cdp：先聚焦再逐键输入，非拉丁字符用 Input.insertText。用 label 按关联标签/占位符找输入框（最省事）；也可以用 xpath 或 selector，pierce 为 true 穿透 Shadow DOM 和同源 iframe；跨域 iframe 里的输入框传 frame（src 包含的一段）+ xpath/selector；也可以用 x、y 坐标（先点击该点聚焦再输入；带 page_screenshot 的 shotId 时 x、y 用图片像素）。多行文本、整段文档用 page_paste，逐键输入会被部分页面改写。native 先真实点击再逐键输入。inject 直接写入。', z.object({
  ...pageArgs, text: z.string(), ...locateFields,
  label: z.string().optional(),
  frame: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  if (typeof args.label === 'string' && args.label.trim()) {
    await typeByLabel(tabRef, String(args.label), String(args.text))
    return { tabId: tabRef.id }
  }
  if (frame) {
    const located = locatorFrom(args)
    if (!located) throw new Error('frame 里输入需要 xpath 或 selector')
    await typeLocatorInFrame(tabRef, frame, located, String(args.text))
    return { tabId: tabRef.id }
  }
  const point = pointArgs(args)
  if (point) {
    await typeAtPoint(tabRef, point.x, point.y, String(args.text), viaOf(args.via))
    return { tabId: tabRef.id }
  }
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  if (located.pierce) {
    await typeDeep(tabRef, located, String(args.text), viaOf(args.via))
    return { tabId: tabRef.id }
  }
  await typeLocator(tabRef, located, String(args.text), viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_paste', '写入一段文字。via 默认 cdp：聚焦后 Input.insertText，不经过剪贴板。用 xpath 或 selector 指定目标。native 写入剪贴板再发送粘贴快捷键。inject 直接写入目标。', z.object({
  ...pageArgs, text: z.string(), ...locateFields, via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  await pasteLocator(tabRef, located, String(args.text), viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_select', '选中一项。via 默认 cdp：用 Input.dispatchMouseEvent 打开再点选项。用 xpath 或 selector 指定下拉框。native 用真实点击。inject 对 select 直接改值。', z.object({
  ...pageArgs, option: z.string(), ...locateFields, via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  await selectLocator(tabRef, located, String(args.option), viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_key', '把快捷键送进网页，不触发窗口自己的新建或关闭标签。via 默认 cdp，用 Input.dispatchKeyEvent。native 用 sendInputEvent。', z.object({
  ...pageArgs, shortcut: z.string(), via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  await pressShortcut(tabRef, String(args.shortcut), gestureVia(args.via))
  return { tabId: tabRef.id }
})

tool('page_scroll', '翻长列表用滚动，不用滑动。via 默认 cdp，用滚轮。native 用 sendInputEvent。不指定元素时从视口中心滚一下。untilXpath 或 untilSelector 表示滚到该元素能被点到：先把它滚进视口，再用页面命中确认没有被顶栏挡住，最多 16 次。失败时带上匹配个数、文字和当时能不能点到。', z.object({
  ...pageArgs,
  direction: z.enum(['up', 'down']).default('down'),
  ...locateFields,
  untilXpath: z.string().optional(),
  untilSelector: z.string().optional(),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await scrollPage(tabRef, args.direction as 'up' | 'down', gestureVia(args.via), locatorFrom(args), until)
  return { tabId: tabRef.id }
})

tool('page_swipe', '按住拖拽，用来拖滑块或横滑一块区域。翻长列表用 page_scroll，滑动滚不动整页。via 默认 cdp，用按下、移动、松开。native 用 sendInputEvent。不指定元素时从视口中心滑。指定元素时只在它此刻露出来的区域里滑。untilXpath 或 untilSelector 表示滑到该元素能被点到，最多 20 次。', z.object({
  ...pageArgs,
  direction: z.enum(['up', 'down', 'left', 'right']).default('up'),
  ...locateFields,
  untilXpath: z.string().optional(),
  untilSelector: z.string().optional(),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await swipePage(tabRef, args.direction as 'up' | 'down' | 'left' | 'right', locatorFrom(args), until, gestureVia(args.via))
  return { tabId: tabRef.id }
})

tool('page_drag', '按住一个点或元素，按 dx、dy 精确拖拽，轨迹自带拟人的加减速、横向抖动和微过冲回正。拖滑块验证码、拖排序这类要精确距离的目标用它，不要用 page_swipe。起点用 x、y（当前视口 CSS 像素；带 shotWidth、shotHeight 时按截图比例换算，再带 shotX、shotY、shotScale 时按 captcha_panel 这类裁剪图换算），或用 xpath、selector（取元素中心）。dx、dy 是位移，可正可负。via 默认 cdp：Input.dispatchMouseEvent。native 用 sendInputEvent。', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  dx: z.number(),
  dy: z.number().default(0),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  let start: { x: number; y: number } | undefined
  const point = pointArgs(args)
  if (point) {
    start = mapPoint(tabRef, point.x, point.y, point.shot)
  } else {
    const located = locatorFrom(args)
    if (!located) throw new Error('需要 xpath 或 selector，或起点坐标 x 和 y')
    start = await locatorGesturePoint(tabRef, located)
  }
  const moved = await dragPage(tabRef, gestureVia(args.via), start, Number(args.dx), Number(args.dy))
  return { tabId: tabRef.id, from: moved.from, to: moved.to }
})

tool('page_inspect', '识别一个元素是什么类型：video、image、canvas、audio、link、input、text。返回类型、地址（src/href/poster）、位置和文字。目标用 xpath、selector，或坐标 x、y（支持 shot 换算，同 page_click）。保存图片视频前先用它确认类型。', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const point = pointArgs(args)
  const located = locatorFrom(args)
  if (!point && !located) throw new Error('需要 xpath 或 selector，或坐标 x 和 y')
  const info = await inspectElement(tabRef, point ? { point: mapPoint(tabRef, point.x, point.y, point.shot) } : { locator: located })
  return { tabId: tabRef.id, ...info }
})

tool('page_save_media', '把元素上的图片、视频、音频或画布保存成本机文件，走这套环境的登录态（Cookie 都在）。直链直接下；B站(__playinfo__)、抖音(media-video/media-audio)、YouTube(ytInitialPlayerResponse)这类流媒体自动抓 DASH 音视频轨合并 mp4；m3u8/mpd 清单（央视、AcFun、优酷等）用 ffmpeg 拉流转 mp4；搜狐这类分段 mp4 按已加载的分段顺序合并（长视频只下到自己播到的部分，要完整就配合 page_record_video）；播放器在 Web Worker 里拉流（腾讯等）时用 CDP 网络嗅探兜底，必要时自动重载页面从头抓清单。目标用 xpath、selector，或坐标 x、y。savePath 传文件路径就存成那个文件，传已存在的目录就存进目录（文件名自动取），不给就存进下载目录（默认系统下载目录，可用 download_dir 改）。返回本机路径、类型和字节数。m3u8 清单和抓不到轨的流媒体会说明，那种用 page_record_video 录渲染画面。', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  savePath: z.string().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const point = pointArgs(args)
  const located = locatorFrom(args)
  if (!point && !located) throw new Error('需要 xpath 或 selector，或坐标 x 和 y')
  const savePath = typeof args.savePath === 'string' && args.savePath ? String(args.savePath) : undefined
  const saved = await saveMedia(tabRef, point ? { point: mapPoint(tabRef, point.x, point.y, point.shot) } : { locator: located }, downloadTargetDir(), savePath)
  return { tabId: tabRef.id, ...saved }
})

tool('download_list', '列出本次运行期间的本机下载记录（重启后清空，文件本身还在），每条给 name、path（存到哪）、state、bytes、url、env：网页里点下载按钮触发的下载、page_save_media 和 page_record_video 存的文件、右键另存的媒体都在里面。带 wait（秒，最长 120）就先等正在进行的下载结束再返回，用来确认「点了下载按钮之后到底存到哪」。失败的条目带 error。', z.object({
  env: env,
  wait: z.number().optional()
}), async (args) => {
  const envId = typeof args.env === 'string' && args.env ? args.env : undefined
  const pick = () => listDownloads().filter((item) => !envId || item.envId === envId)
  const waitMs = Math.max(0, Math.min(120, Number(args.wait ?? 0))) * 1000
  const deadline = Date.now() + waitMs
  while (waitMs > 0 && Date.now() < deadline) {
    if (!pick().some((item) => item.state === 'progressing' || item.state === 'paused')) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const items = pick()
  return {
    downloads: items.map((item) => ({
      id: item.id,
      name: item.name,
      env: item.envId,
      path: item.path,
      url: item.url,
      state: item.state,
      bytes: item.receivedBytes,
      totalBytes: item.totalBytes,
      error: item.error,
      startedAt: item.startedAt,
      doneAt: item.doneAt
    })),
    pending: items.filter((item) => item.state === 'progressing' || item.state === 'paused').length,
    dir: downloadTargetDir()
  }
})

tool('download_dir', '查看或修改浏览器下载目录。不带 dir 返回当前目录；带 dir（本机绝对路径）就改掉，之后网页里点下载按钮触发的下载都存到那里，目录不存在会自动建。传 dir 为空或 "default" 恢复系统默认下载目录（Windows 的「下载」、macOS / Linux 的 Downloads）。page_save_media、page_record_video 的 savePath 仍然逐个文件覆盖这里。', z.object({
  dir: z.string().optional()
}), async (args) => {
  const input = typeof args.dir === 'string' ? args.dir.trim() : ''
  if (input && input !== 'default') {
    if (!isAbsolute(input)) throw new Error(`需要绝对路径，比如 D:\\下载：${input}`)
    try {
      mkdirSync(input, { recursive: true })
    } catch {
      throw new Error(`建不了这个目录：${input}`)
    }
    storage.settings.downloadDir = input
    storage.saveSettings()
    bridge.broadcast()
  } else if (input === 'default') {
    storage.settings.downloadDir = ''
    storage.saveSettings()
    bridge.broadcast()
  }
  return { dir: downloadTargetDir(), custom: Boolean(storage.settings.downloadDir) }
})

tool('download_action', '管理下载记录：open 打开文件、show 在文件夹里显示、copy 复制下载链接、pause / resume 暂停继续、cancel 取消、retry 重新下载失败的任务（只支持 http/https）、remove 从列表移除（不删文件）、clear 清掉所有已结束的记录。除 clear 外都要 id，从 download_list 取。', z.object({
  id: z.string().optional(),
  action: z.enum(['open', 'show', 'copy', 'pause', 'resume', 'cancel', 'retry', 'remove', 'clear'])
}), async (args) => {
  const action = String(args.action)
  if (action === 'clear') {
    downloadsClear()
    return { action, remaining: listDownloads().length }
  }
  const id = typeof args.id === 'string' ? args.id : ''
  if (!id) throw new Error('需要下载编号 id，从 download_list 取')
  const item = listDownloads().find((entry) => entry.id === id)
  if (!item) throw new Error(`没有这条下载记录：${id}`)
  if (action === 'open') downloadOpen(id)
  else if (action === 'show') downloadShow(id)
  else if (action === 'copy') downloadCopyLink(id)
  else if (action === 'pause') downloadPause(id)
  else if (action === 'resume') downloadResume(id)
  else if (action === 'cancel') downloadCancel(id)
  else if (action === 'remove') {
    if (!downloadForget(id)) throw new Error('下载还没结束，先 cancel 再移除')
  } else if (action === 'retry') {
    if (item.state !== 'failed') throw new Error(`只有失败的下载能重试，这条是 ${item.state}`)
    if (!item.envId || !/^https?:/i.test(item.url)) throw new Error('这条记录没有可重试的地址')
    await session.fromPartition(`persist:${item.envId}`).downloadURL(item.url)
  }
  const after = listDownloads().find((entry) => entry.id === id)
  return { action, id, state: after?.state ?? 'removed', path: after?.path ?? item.path }
})

tool('page_record_video', '把页面里正在播放的视频录下来：用 captureStream + MediaRecorder 录渲染出来的画面，重编码成 webm。seconds 是录多少秒（默认 10，最长 3600），会自动开始播放。任何能播的站都能录（B站、腾讯等流媒体也行），代价是要实时播完。不给 savePath 就存进下载目录（默认系统下载目录）。m3u8 追台等直链/流媒体抓轨用 page_save_media，又快又无损。', z.object({
  ...pageArgs,
  seconds: z.number().optional(),
  savePath: z.string().optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const seconds = Math.max(1, Math.min(3600, Number(args.seconds ?? 10)))
  const savePath = typeof args.savePath === 'string' && args.savePath ? String(args.savePath) : undefined
  const result = await recordVideo(tabRef, seconds, downloadTargetDir(), savePath)
  return { tabId: tabRef.id, ...result }
})

tool('page_draw', '在画布上自由绘制。四种给法任选：points 路径点数组按路径画线；加 smooth: true 用样条插值把控制点连成平滑曲线；给 path（SVG 路径字符串，支持 M/L/H/V/C/S/Q/T/A/Z，含贝塞尔曲线）按 viewBox 缩放到 x、y、width、height 的区域画；或给 shape（circle/rect/triangle/heart/star）加 x、y、width、height 画标准图形。close: true 闭合路径。多段路径（多个 M）会逐段抬笔。用来在画板、签名板、Canva 这类画布上作画。via 默认 cdp。', z.object({
  ...pageArgs,
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  path: z.string().optional(),
  viewBox: z.array(z.number()).length(2).optional(),
  shape: z.enum(['circle', 'rect', 'triangle', 'heart', 'star']).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  smooth: z.boolean().optional(),
  close: z.boolean().optional(),
  fill: z.boolean().optional(),
  spacing: z.number().optional(),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  if (typeof args.path === 'string' && args.path) {
    if (args.x === undefined || args.y === undefined || !args.width || !args.height) throw new Error('path 要配 x、y、width、height 定目标区域')
    const box = { x: Number(args.x), y: Number(args.y), width: Number(args.width), height: Number(args.height) }
    const subpaths = svgPathToPoints(String(args.path), box, Array.isArray(args.viewBox) ? [Number((args.viewBox as number[])[0]), Number((args.viewBox as number[])[1])] : undefined)
    const drawn = await drawPaths(tabRef, gestureVia(args.via), subpaths)
    return { tabId: tabRef.id, ...drawn }
  }
  let points = args.points as Array<{ x: number; y: number }> | undefined
  if (!points) {
    if (!args.shape || args.x === undefined || args.y === undefined || !args.width || !args.height) {
      throw new Error('给 points 路径点、path SVG 路径，或 shape + x、y、width、height')
    }
    points = drawShapePoints(String(args.shape), Number(args.x), Number(args.y), Number(args.width), Number(args.height))
    args.close = true
  }
  const drawn = await drawPath(tabRef, gestureVia(args.via), points, Boolean(args.close), Boolean(args.smooth))
  if (args.fill) {
    const filled = await drawPath(tabRef, gestureVia(args.via), fillSerpentine(points, Math.max(3, Number(args.spacing ?? 5))))
    return { tabId: tabRef.id, ...drawn, fillPoints: filled.points }
  }
  return { tabId: tabRef.id, ...drawn }
})

tool('page_canvas', '画布绘画（海龟命令）（和 Python turtle 一样）：script 每行一条命令，fd/bk N 前进后退、lt/rt 角度、setheading 角度、goto X Y、penup/pendown 抬笔落笔、circle 半径 [角度]、beginfill/endfill 圈一块区域上色（蛇形连笔涂满，spacing 行距）。起点默认视口中心朝右（heading 0），可用 x、y、heading 改。任何画布都能画，换颜色用 page_click 点画板色板后再继续。', z.object({
  ...pageArgs,
  script: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  heading: z.number().optional(),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const result = await turtleRun(tabRef, gestureVia(args.via), String(args.script), {
    x: args.x === undefined ? undefined : Number(args.x),
    y: args.y === undefined ? undefined : Number(args.y),
    heading: args.heading === undefined ? undefined : Number(args.heading)
  })
  return { tabId: tabRef.id, ...result }
})

tool('page_upload', '把本机文件交给页面上的文件控件，不弹出系统选择框。用 xpath 或 selector 指定控件。不指定时用页面上的第一个文件控件。', z.object({
  ...pageArgs, paths: z.array(z.string()), ...locateFields
}), async (args) => {
  const tabRef = await pageTab(args)
  const located = locatorFrom(args)
  if (located) {
    const target = await resolveLocator(tabRef, located)
    await uploadFiles(tabRef, args.paths as string[], target.backendNodeId)
  } else await uploadFiles(tabRef, args.paths as string[])
  return { tabId: tabRef.id }
})

tool('page_lock', '锁定当前网页。遮罩上是「Agent 正在操作浏览器」和「接管」。', z.object(pageArgs), async (args) => {
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  showAgentMask(resolved.tab)
  resolved.tab.userTookOver = false
  return { tabId: resolved.tab.id }
})

tool('page_unlock', '去掉遮罩。用户可以操作，任务不暂停。', z.object(pageArgs), async (args) => {
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  shareControl(resolved.tab, false)
  return { tabId: resolved.tab.id }
})

tool('page_handoff', '放开页面让用户完成这一步。看页面不会重新盖上遮罩，下一步操作才会重新锁定。', z.object({
  ...pageArgs, message: z.string()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  beginHandoff(tabRef, String(args.message))
  return { tabId: tabRef.id, message: args.message }
})

tool('page_dialog', '页面弹窗（alert / confirm / prompt）会自动按策略处理，不会再把标签卡住：默认 alert 直接关掉，confirm 返回取消、prompt 返回 null。要让接下来的确认框返回「确定」，先调 action=accept（once: true 只作用于下一个弹窗），再点按钮；action=list 看最近的弹窗和当前策略。', z.object({
  tabId: z.string(),
  action: z.enum(['list', 'accept', 'dismiss']),
  once: z.boolean().optional(),
  promptText: z.string().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  if (args.action === 'list') {
    return {
      tabId: tabRef.id,
      policy: dialogPolicy(tabRef.id) ?? { accept: false },
      pending: pendingDialog(tabRef.id) ?? null,
      dialogs: recentDialogs(tabRef.id)
    }
  }
  const accept = args.action === 'accept'
  const promptText = typeof args.promptText === 'string' ? args.promptText : undefined
  const answered = await answerPendingDialog(tabRef.id, accept, promptText).catch(() => undefined)
  setDialogPolicy(tabRef.id, accept, Boolean(args.once), promptText)
  return {
    tabId: tabRef.id,
    action: args.action,
    once: Boolean(args.once),
    policy: dialogPolicy(tabRef.id),
    answered: answered?.type
  }
})

tool('page_hover', '把鼠标移到元素或坐标上，用来触发下拉菜单、悬浮提示这类悬停交互。优先用 text 按可见文字找目标（可选 textMatch: exact），或用 role + name；也可以用 xpath / selector，或坐标 x、y；within / index 的用法和 page_click 一样；带 page_screenshot 的 shotId 时 x、y 直接用图片像素。跨域 iframe 里的元素传 frame（src 包含的一段）配 selector/xpath 或 text。via 默认 cdp，native 用 sendInputEvent，inject 在元素上派发 mouseover/mouseenter。', z.object({
  ...pageArgs,
  ...locateFields,
  text: z.string().optional(),
  textMatch: z.enum(['exact', 'contains']).optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  nameMatch: z.enum(['exact', 'contains']).optional(),
  within: z.string().optional(),
  index: z.number().optional(),
  frame: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  const text = typeof args.text === 'string' && args.text.trim() ? String(args.text) : ''
  const textMatch = args.textMatch === 'exact' ? 'exact' as const : 'contains' as const
  const needsHit = Boolean(args.role || args.name || args.within || args.index !== undefined)
  if (needsHit) {
    const hit = await resolveHit(tabRef, {
      selector: typeof args.selector === 'string' ? String(args.selector) : undefined,
      xpath: typeof args.xpath === 'string' ? String(args.xpath) : undefined,
      text: text || undefined,
      textMatch,
      role: args.role ? String(args.role) : undefined,
      name: args.name ? String(args.name) : undefined,
      nameMatch: args.nameMatch === 'exact' ? 'exact' : 'contains',
      within: args.within ? String(args.within) : undefined,
      index: args.index === undefined ? undefined : Number(args.index)
    }, frame || undefined)
    if (!hit) throw new Error('没有匹配到目标元素')
    await hoverHit(tabRef, hit, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label }
  }
  if (frame) {
    if (text) {
      const hit = await hoverTextInFrame(tabRef, frame, text, textMatch, viaOf(args.via))
      return { tabId: tabRef.id, text: hit.label }
    }
    const located = locatorFrom(args)
    if (!located) throw new Error('frame 里悬停需要 xpath 或 selector，或 text')
    const hit = await hoverLocatorInFrame(tabRef, frame, located, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label }
  }
  if (text) {
    const hit = await hoverText(tabRef, text, textMatch, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label }
  }
  const point = pointArgs(args)
  if (point) {
    await hoverPoint(tabRef, point.x, point.y, point.shot, viaOf(args.via))
    return { tabId: tabRef.id }
  }
  const located = locatorFrom(args)
  if (!located) throw new Error('需要 xpath 或 selector、text，或坐标 x 和 y')
  await hoverLocator(tabRef, located, viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_screenshot', '截取网页视口。传 xpath / selector 时只截这个元素（会先滚进视口）；传 x、y、width、height 时截这块区域；都不传截整个视口。默认叠加 100px 坐标网格。坐标原点始终是「视口左上角」，不是图片左上角：整页刻度从 0 起；元素/区域截图的刻度仍是视口里的绝对坐标，左上角角标写着裁剪起点坐标（例如 (424, 261)），看到刻度直接当 page_click 的 x/y 用，不要自己再加偏移。网格颜色按每 32px 小块的背景自动计算：亮底用深线、暗底用浅线，色相跟随背景并压低彩度，按 APCA 对比度保证每段都看得清。grid 传 false 或 0 关闭，传数字改间距（10–500）；网格越密数字标注自动抽稀，不会盖住内容。内容密集的局部截图传 edgeOnly: true，只画四边刻度、不铺满整张图。网格是截图后合成的，不碰页面。返回图片、路径、像素宽高、origin（图片左上角对应的视口坐标）、coordinateSpace、shotId；点图上的位置时把 shotId 原样传给 page_click / page_hover / page_type 的 shotId，x、y 直接用图片像素，工具自动换算，不要自己除 DPR；宽高只用于坐标换算，不是窗口尺寸。不改变当前是谁在操作。', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  grid: z.union([z.boolean(), z.number()]).optional(),
  edgeOnly: z.boolean().optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const step = args.grid === false || args.grid === 0 ? 0 : args.grid === undefined || args.grid === true ? 100 : Math.max(10, Math.min(500, Math.round(Number(args.grid) || 0)))
  const edgeOnly = Boolean(args.edgeOnly)
  const located = locatorFrom(args)
  const rect = [args.x, args.y, args.width, args.height].every((value) => value !== undefined)
    ? {
        x: Number(args.x),
        y: Number(args.y),
        width: Number(args.width),
        height: Number(args.height)
      }
    : undefined
  if (located || rect) {
    const shot = await screenshotRegion(tabRef, { locator: located ?? undefined, rect }, storage.dir('screenshots'), step, edgeOnly)
    return {
      tabId: tabRef.id,
      path: shot.path,
      width: shot.width,
      height: shot.height,
      x: shot.x,
      y: shot.y,
      origin: shot.origin,
      coordinateSpace: shot.coordinateSpace,
      full: shot.full,
      shotId: rememberShot(shot.shot),
      bytes: statSync(shot.path).size,
      image: imageOf(shot.path)
    }
  }
  const shot = await screenshot(tabRef, storage.dir('screenshots'), step, edgeOnly)
  return {
    tabId: tabRef.id,
    path: shot.path,
    width: shot.width,
    height: shot.height,
    origin: shot.origin,
    coordinateSpace: shot.coordinateSpace,
    shotId: rememberShot(shot.shot),
    bytes: statSync(shot.path).size,
    image: imageOf(shot.path)
  }
})

tool('page_console', '读取这个标签的控制台输出和 JS 错误（最近 300 条，新的在前）。未捕获异常和 Promise 拒绝会带 stack，页面点不动、按钮报错、脚本没反应时先看这里。action=clear 清空。', z.object({
  tabId: z.string(),
  action: z.enum(['list', 'clear']).optional(),
  limit: z.number().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const wc = tabRef.view?.webContents
  if (!wc) throw new Error('这个标签没有网页')
  if (args.action === 'clear') {
    clearConsole(wc)
    return { tabId: tabRef.id, cleared: true }
  }
  const limit = Math.max(1, Math.min(300, Number(args.limit ?? 100)))
  return { tabId: tabRef.id, messages: consoleFor(wc).slice(0, limit) }
})

tool('page_find', '在页面里查找文字，相当于 Ctrl+F。第一次传 text 开始找，findNext 继续下一个，stop 清除高亮。返回匹配总数和当前是第几个。', z.object({
  tabId: z.string(),
  text: z.string().optional(),
  forward: z.boolean().optional(),
  findNext: z.boolean().optional(),
  stop: z.boolean().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  if (args.stop) {
    await findInPage(tabRef, '', { stop: true })
    return { tabId: tabRef.id, stopped: true }
  }
  const text = String(args.text ?? '')
  if (!text) throw new Error('需要 text')
  const result = await findInPage(tabRef, text, { forward: args.forward !== false, findNext: Boolean(args.findNext) })
  return { tabId: tabRef.id, ...result }
})

tool('page_wait_load', '等页面加载完成（did-stop-loading）。timeout 是秒，默认 15，最长 60。加载失败会直接报错。比写死 sleep 稳，导航后、点链接后用它。', z.object({
  tabId: z.string(),
  timeout: z.number().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const wc = tabRef.view?.webContents
  if (!wc) throw new Error('这个标签没有网页')
  const seconds = Math.max(1, Math.min(60, Number(args.timeout ?? 15)))
  const started = Date.now()
  await waitForLoad(wc, seconds * 1000)
  return { tabId: tabRef.id, url: wc.getURL(), elapsed: Date.now() - started }
})

tool('screen_start', '开始把这扇有头窗口录成视频。录屏需要画面，会把窗口带到前台并聚焦（这是少数会前置窗口的工具）。maxSeconds 到时自动停，默认 300，最长 3600；一扇窗口同时只录一段。', z.object({ env: env, maxSeconds: z.number().optional() }), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = openEnvironment(envId, false)
  if (runtime.headless) throw new Error('无头窗口没有画面，先有头打开再录')
  if (runtime.screenRecording) throw new Error('这扇窗口已经在录')
  // 录屏必须让页面持续绘制，窗口被遮挡时子视图可能不刷新；这是少数需要主动前置的场景
  if (runtime.win.isMinimized()) runtime.win.restore()
  runtime.win.setAlwaysOnTop(true, 'screen-saver')
  runtime.win.show()
  runtime.win.focus()
  const seconds = Math.max(1, Math.min(3600, Number(args.maxSeconds ?? 300)))
  runtime.screenRecording = true
  bridge.broadcast(envId)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        screenStartWaiters.delete(envId)
        reject(new Error('录屏没有开始'))
      }, 8_000)
      screenStartWaiters.set(envId, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      runtime.win.webContents.send('screen:start')
    })
  } catch (error) {
    runtime.screenRecording = false
    runtime.screenStartedAt = undefined
    bridge.broadcast(envId)
    throw error
  }
  runtime.screenStartedAt = Date.now()
  const auto = setTimeout(() => {
    screenTimers.delete(envId)
    void stopScreen(envId).catch(() => undefined)
  }, seconds * 1000)
  screenTimers.set(envId, auto)
  return { env: envId, maxSeconds: seconds }
})

tool('window_preview', '把主界面、网页、遮罩和弹层合成一张应用截图。默认是整窗；传 x、y、width、height 时只截这块局部（应用内容区 CSS 像素）。坐标原点始终是「应用内容区左上角」，不含系统标题栏：整窗刻度从 0 起；局部截图的刻度仍是内容区里的绝对坐标，左上角角标写着裁剪起点。默认叠加 100px 坐标网格（grid: false 或 0 关闭，数字改间距 10–500，数字标注会随密度自动抽稀），网格颜色按每 32px 小块的背景自动计算（亮底深线、暗底浅线，色相跟随背景，APCA 保证对比度）；内容密集时传 edgeOnly: true，只画四边刻度。给 GUI 自动化用；点网页仍然用 page_screenshot 的视口坐标。返回图片、路径、像素宽高、origin（图片左上角对应的内容区坐标）和 coordinateSpace。这是合成预览，不是系统级窗口截图。', z.object({
  env: env,
  grid: z.union([z.boolean(), z.number()]).optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  edgeOnly: z.boolean().optional()
}), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const step = args.grid === false || args.grid === 0 ? 0 : args.grid === undefined || args.grid === true ? 100 : Math.max(10, Math.min(500, Math.round(Number(args.grid) || 0)))
  const crop = [args.x, args.y, args.width, args.height].every((value) => value !== undefined)
    ? {
        x: Number(args.x),
        y: Number(args.y),
        width: Number(args.width),
        height: Number(args.height)
      }
    : undefined
  const shot = await windowPreview(envId, step, crop, Boolean(args.edgeOnly))
  return {
    env: envId,
    path: shot.path,
    width: shot.width,
    height: shot.height,
    origin: shot.origin,
    coordinateSpace: shot.coordinateSpace,
    bytes: shot.bytes,
    image: imageOf(shot.path)
  }
})

const screenTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function stopScreen(envId: string): Promise<{ env: string; path: string; seconds: number; bytes: number }> {
  const runtime = windows.get(envId)
  if (!runtime?.screenRecording) throw new Error('这扇窗口没有在录')
  const started = runtime.screenStartedAt ?? Date.now()
  const path = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      screenWaiters.delete(envId)
      reject(new Error('录屏没有完成'))
    }, 20_000)
    screenWaiters.set(envId, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    runtime.win.webContents.send('screen:stop')
  })
  runtime.screenRecording = false
  runtime.screenStartedAt = undefined
  runtime.win.setAlwaysOnTop(false)
  bridge.broadcast(envId)
  const auto = screenTimers.get(envId)
  if (auto) clearTimeout(auto)
  screenTimers.delete(envId)
  return {
    env: envId,
    path,
    seconds: Math.max(0, Math.round((Date.now() - started) / 1000)),
    bytes: statSync(path).size
  }
}

tool('screen_stop', '停止录屏并写成 mp4 存到下载目录（默认系统下载目录），返回路径、时长和字节数。', z.object({ env: env }), async (args) => {
  return stopScreen(String(args.env || DEFAULT_ENV))
})

tool('screen_status', '查看这扇窗口是否正在录屏，返回开始时间、已录秒数和是否在录。', z.object({ env: env }), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = windows.get(envId)
  const started = runtime?.screenStartedAt
  return {
    env: envId,
    recording: Boolean(runtime?.screenRecording),
    startedAt: started ?? null,
    seconds: started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0
  }
})

tool('page_source', '读取网页源码。dom 是当前文档，response 是这次导航的原始 HTML。', z.object({
  ...pageArgs, kind: z.enum(['dom', 'response']).optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const kind = (args.kind as 'dom' | 'response') || 'dom'
  const html = await pageSource(tabRef, kind)
  return { tabId: tabRef.id, kind, html }
})

tool('page_script', '在当前网页里执行一段 JavaScript，把返回值交回。用来读页面数据或做没有单独工具的操作。frame 填子框架 URL 的一段（比如 graph.qq.com），脚本就在那个 iframe 里跑，跨域也可以。', z.object({
  ...pageArgs, source: z.string(), frame: z.string().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? args.frame : undefined
  const value = frame ? await evalInFrame(tabRef, String(args.source), frame) : await evalSource(tabRef, String(args.source))
  return { tabId: tabRef.id, value }
})

tool('page_cdp', '对当前网页调用一条 CDP，用完即断开，除非抓包还开着。要连着发一组命令（比如 press/move/release 的输入序列）用 page_cdp_batch。sessionId 可选：填 Target.attachToTarget 返回的会话编号时，命令发到那个子框架会话。', z.object({
  ...pageArgs, method: z.string(), params: z.record(z.unknown()).optional(), sessionId: z.string().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const value = await sendCdp(tabRef, String(args.method), args.params as Record<string, unknown> | undefined, args.sessionId ? String(args.sessionId) : undefined)
  return { tabId: tabRef.id, value }
})

tool('page_cdp_batch', '在同一个调试会话里按顺序跑一组 CDP 命令，中间不断开。commands 是数组，每项有 method、params（可选）和 delay（这条跑完后等多少秒，默认 0，上限 5）。返回每条命令的结果数组。', z.object({
  ...pageArgs,
  commands: z.array(z.object({
    method: z.string(),
    params: z.record(z.unknown()).optional(),
    delay: z.number().optional()
  })).min(1)
}), async (args) => {
  const tabRef = await pageTab(args)
  const results = await sendCdpBatch(tabRef, args.commands as Array<{ method: string; params?: Record<string, unknown>; delay?: number }>)
  return { tabId: tabRef.id, results }
})

tool('captcha_panel', '把验证码区域截成一张图，返回图片路径 path、像素宽高、视口 CSS 坐标矩形 rect 和换算比例 scale。识别交给读图的 Agent：看图后自己算出点击位置或拖动距离，按 mapping 换算成 CSS 坐标后用 page_click 或 page_drag 操作。滑块、图标点选、语序点选、五子棋等任意类型都能用，是 captcha_solve 内置识别失败时的通用兜底。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  const panel = await captchaPanelShot(tabRef)
  return { tabId: tabRef.id, ...panel }
})

tool('captcha_detect', '识别页面上的验证码目标位置。目前支持 geetest-slide（极验 v4 滑块），type 传 auto 自动判断。返回 distance（滑块要拖的距离，视口 CSS 像素）、knob（滑块旋钮中心）、engine（实际用的识别引擎）和置信度 confidence。mark 为 true 时把识别出的缺口画在背景图上存盘，返回 markPath。engine 选识别引擎：cv（内置视觉算法，零依赖，极验滑块上最准）、ddddocr（调本机 Python 的开源 ddddocr 库，需 pip install ddddocr）、onnx（用户数据目录 models/geetest-slide.onnx + 该目录装好 onnxruntime-node）；auto 按 cv → ddddocr → onnx 顺序找可用的。其它类型用 captcha_panel 截图交给 Agent 自己识别。', z.object({
  ...pageArgs,
  type: z.string().default('auto'),
  engine: z.enum(['auto', 'ddddocr', 'onnx', 'cv']).default('auto'),
  mark: z.boolean().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const target = await detectCaptcha(tabRef, String(args.type || 'auto'), Boolean(args.mark), args.engine as 'auto' | 'ddddocr' | 'onnx' | 'cv')
  return { tabId: tabRef.id, ...target }
})

tool('captcha_read', '把验证码区域截图后用 ddddocr 做文字识别，返回 text 和图片路径。适合英数文字验证码。需要本机 Python 且 pip install ddddocr。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  const result = await captchaRead(tabRef)
  return { tabId: tabRef.id, ...result }
})

tool('captcha_solve', '识别并拖动滑块完成验证码，一次调用里做完识别、拟人拖拽和结果检查。retries 是识别失败后的重试次数（默认 2），每次重试会等验证码刷新后重新识别。engine 选识别引擎：cv、ddddocr、onnx 或 auto（默认，按 cv → ddddocr → onnx 找可用的）。返回 solved、attempts 和每次尝试的距离与结果。', z.object({
  ...pageArgs,
  type: z.string().default('auto'),
  engine: z.enum(['auto', 'ddddocr', 'onnx', 'cv']).default('auto'),
  retries: z.number().optional(),
  via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const result = await solveCaptcha(tabRef, String(args.type || 'auto'), gestureVia(args.via), Math.max(0, Math.min(5, Number(args.retries ?? 2))), args.engine as 'auto' | 'ddddocr' | 'onnx' | 'cv')
  return { tabId: tabRef.id, ...result }
})

const graphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    data: z.object({ type: z.string(), title: z.string().optional() }).passthrough(),
    position: z.object({ x: z.number(), y: z.number() }).optional()
  }).passthrough()).min(1),
  edges: z.array(z.object({
    id: z.string().optional(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional()
  }).passthrough())
})

const workflowBody = z.object({
  app: z.object({
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    mode: z.literal('workflow').optional()
  }),
  workflow: z.object({
    environment_variables: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    conversation_variables: z.array(z.unknown()).optional(),
    graph: graphSchema
  })
})

tool('workflow_write', '新建或整份覆盖一份工作流。图用 nodes 和 edges。script 在当前网页里跑，code 在主进程里独立跑。填写用 fill，entry 为 type 或 paste。循环用 loop。同名再次写入覆盖整张图，编号不变。只改其中几个节点用 workflow_update。', workflowBody, async (args) => {
  const body = args as {
    app: { name: string; description?: string; icon?: string }
    workflow: {
      environment_variables?: { name: string; value: string }[]
      graph: WorkflowApp['workflow']['graph']
    }
  }
  const saved = workflowWrite({
    app: {
      name: String(body.app.name),
      description: body.app.description ? String(body.app.description) : '',
      icon: body.app.icon ? String(body.app.icon) : ''
    },
    workflow: {
      environment_variables: body.workflow.environment_variables ?? [],
      conversation_variables: [],
      graph: body.workflow.graph
    }
  })
  return { workflow: saved.id, name: saved.app.name, params: workflowParams(saved), nodes: saved.workflow.graph.nodes.length }
})

const nodePatch = z.object({
  id: z.string(),
  parent: z.string().optional(),
  data: z.object({ type: z.string(), title: z.string().optional() }).passthrough(),
  position: z.object({ x: z.number(), y: z.number() }).optional()
}).passthrough()

const edgePatch = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional()
}).passthrough()

tool('workflow_update', '改已有工作流的一部分。nodes 按编号替换节点，新编号追加；写了 parent 就把新节点放进那个循环。removeNodes 删节点及其连线。edges 在两端所在的那一层替换或追加。没提到的节点和连线保持原样。', z.object({
  name: z.string().optional(),
  workflow: z.string().optional(),
  description: z.string().optional(),
  rename: z.string().optional(),
  nodes: z.array(nodePatch).optional(),
  removeNodes: z.array(z.string()).optional(),
  edges: z.array(edgePatch).optional(),
  removeEdges: z.array(z.string()).optional(),
  environment_variables: z.array(z.object({ name: z.string(), value: z.string() })).optional()
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error('需要工作流名称或编号')
  const saved = workflowUpdate(key, {
    description: typeof args.description === 'string' ? args.description : undefined,
    rename: typeof args.rename === 'string' ? args.rename : undefined,
    nodes: args.nodes as WorkflowApp['workflow']['graph']['nodes'],
    removeNodes: args.removeNodes as string[] | undefined,
    edges: args.edges as WorkflowApp['workflow']['graph']['edges'],
    removeEdges: args.removeEdges as string[] | undefined,
    environment_variables: args.environment_variables as { name: string; value: string }[] | undefined
  })
  bridge.broadcast()
  return { workflow: saved.id, name: saved.app.name, nodes: saved.workflow.graph.nodes.length }
})

tool('workflow_list', '列出已保存的工作流和参数名。', z.object({}), async () => ({
  workflows: storage.workflows.map((item) => ({
    id: item.id,
    name: item.app.name,
    remark: item.app.description,
    params: workflowParams(item),
    nodes: item.workflow.graph.nodes.length
  }))
}))

tool('workflow_run', '按工作流名称和输入，在一次调用里跑完整张图。', z.object({
  name: z.string().optional(),
  workflow: z.string().optional(),
  inputs: z.record(z.string()).optional(),
  tabId: tab,
  env: env
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error('需要工作流名称或编号')
  const app = findWorkflow(key)
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  return runWorkflow(resolved.tab, app, (args.inputs as Record<string, string>) ?? {})
})

tool('workflow_batch', '同一套环境里按多行输入跑工作流。默认一行一行来，并发最多 3。', z.object({
  workflow: z.string(),
  rows: z.array(z.record(z.string())),
  concurrency: z.number().optional(),
  env: env,
  tabId: tab
}), async (args) => {
  const app = findWorkflow(String(args.workflow))
  const cap = storage.settings.batchConcurrency
  const concurrency = Math.max(1, Math.min(cap, Number(args.concurrency ?? 1)))
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  const rows = args.rows as Record<string, string>[]
  const results: Record<string, unknown>[] = []
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < rows.length) {
      const index = cursor
      cursor += 1
      const rowTab = index === 0 ? resolved.tab : addTab(resolved.win, resolved.tab.url || 'about:blank')
      results[index] = await runWorkflow(rowTab, app, rows[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()))
  return { results }
})

tool('workflow_export', '把工作流导出成 JSON 文件，返回本机路径。', z.object({
  name: z.string().optional(),
  workflow: z.string().optional()
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error('需要工作流名称或编号')
  return { path: exportWorkflow(key) }
})

tool('workflow_delete', '从本机删掉一个工作流。目录里的还可以再安装。', z.object({
  name: z.string().optional(),
  workflow: z.string().optional()
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error('需要工作流名称或编号')
  const removed = deleteWorkflow(key)
  closeWorkflowPages(removed.id)
  bridge.broadcast()
  return removed
})

tool('workflow_import', '从本机 JSON 文件导入工作流。同名覆盖，编号不变。', z.object({
  path: z.string()
}), async (args) => {
  const saved = importWorkflow(String(args.path))
  bridge.broadcast()
  return { workflow: saved.id, name: saved.app.name, nodes: saved.workflow.graph.nodes.length }
})

tool('net_start', '开始记录这个标签的 HTTP。请求头可能含有 Cookie，只留在本机。', z.object({ tabId: z.string() }), async (args) => {
  await netStart(String(args.tabId))
  return { tabId: args.tabId }
})

tool('net_stop', '停止记录并断开调试器。', z.object({ tabId: z.string() }), async (args) => {
  netStop(String(args.tabId))
  return { tabId: args.tabId }
})

tool('net_list', '列出请求摘要，不含正文。', z.object({ tabId: z.string(), urlContains: z.string().optional() }), async (args) => ({
  requests: netList(String(args.tabId), args.urlContains ? String(args.urlContains) : undefined)
}))

tool('net_get', '返回一条请求，含正文（若还留着）。只在本机。', z.object({ reqId: z.string() }), async (args) => {
  const item = netGet(String(args.reqId))
  if (!item) throw new Error(`没有这条请求 ${String(args.reqId)}`)
  return { request: item }
})

tool('net_export', '把这个标签的记录写成 HAR，返回路径。', z.object({ tabId: z.string() }), async (args) => ({
  path: netExport(String(args.tabId), storage.dir('runs'))
}))

tool('net_mock', '拦截这个标签的请求并按规则返回假数据，用于接口测试和故障注入。rules 是数组，每项有 urlContains（URL 包含这段就拦截）和可选的 status（默认 200）、body（字符串，默认 {}）、headers。不匹配的请求正常放行。调 net_mock_off 解除。拦截和抓包可以同时开。', z.object({
  tabId: z.string(),
  rules: z.array(z.object({
    urlContains: z.string(),
    status: z.number().optional(),
    body: z.string().optional(),
    headers: z.record(z.string()).optional()
  })).min(1)
}), async (args) => {
  await netMock(String(args.tabId), args.rules as Array<{ urlContains: string; status?: number; body?: string; headers?: Record<string, string> }>)
  return { tabId: args.tabId, rules: (args.rules as unknown[]).length }
})

tool('net_mock_off', '解除这个标签的请求拦截。', z.object({ tabId: z.string() }), async (args) => {
  await netMockOff(String(args.tabId))
  return { tabId: args.tabId }
})

tool('page_hit', '返回视口坐标 (x, y) 命中的元素：标签、class、id、文字、rect。带 shotWidth、shotHeight 时按截图坐标换算，再带 shotX、shotY、shotScale 时按裁剪图换算（同 page_click）。用来确认"看图说话"算出来的点对不对。', z.object({
  ...pageArgs,
  x: z.union([z.number(), z.string()]),
  y: z.union([z.number(), z.string()]),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const point = pointArgs(args)
  if (!point) throw new Error('需要 x 和 y')
  const hit = await hitPoint(tabRef, point.x, point.y, point.shot)
  return { tabId: tabRef.id, ...hit }
})

tool('page_watch', '盯住一个元素，它的文字或位置变了就返回变化前后，超时返回变化前的快照。timeout 是秒，默认 30，最长 120；interval 是秒，默认 0.5。用来等价格变化、新消息、状态翻转。pierce 为 true 时穿透 Shadow DOM 和 iframe。', z.object({
  ...pageArgs, ...locateFields,
  timeout: z.number().optional(),
  interval: z.number().optional()
}), async (args) => {
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  const tabRef = await pageTab(args, false)
  const timeout = Math.max(1, Math.min(120, Number(args.timeout ?? 30))) * 1000
  const interval = Math.max(0.2, Math.min(5, Number(args.interval ?? 0.5))) * 1000
  const snap = async (): Promise<string> => {
    if (located.pierce) {
      const found = await deepQuery(tabRef, located).catch(() => ({ total: 0, matches: [] }))
      const cross = found.total ? { total: 0, matches: [] } : await crossQuery(tabRef, located).catch(() => ({ total: 0, matches: [] }))
      const first = found.matches[0] ?? cross.matches[0]
      return JSON.stringify(first ?? null)
    }
    const found = await queryLocator(tabRef, located).catch(() => ({ total: 0, matches: [] as Array<{ text: string; rect?: unknown }> }))
    return JSON.stringify(found.matches[0] ?? null)
  }
  const before = await snap()
  const started = Date.now()
  while (Date.now() - started < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const now = await snap()
    if (now !== before) return { tabId: tabRef.id, changed: true, before, after: now, elapsed: (Date.now() - started) / 1000 }
  }
  return { tabId: tabRef.id, changed: false, before, timeout: timeout / 1000 }
})

tool('connect_info', '返回 BrowserPilot 的接入提示词：MCP 地址和口令、skill 安装地址、命令行用法。可以交给别的 Agent，也可以自己按它装 skill、注册 MCP。copy 为 true 时同时写进系统剪贴板。口令只在本机用，不要转发。', z.object({
  copy: z.boolean().optional()
}), async (args) => {
  const data = args.copy ? await copyConnectInfo() : connectInfo()
  return {
    prompt: data.prompt,
    url: data.url,
    file: data.file,
    cliPath: data.cliPath,
    skillPath: data.skillPath,
    copied: Boolean(args.copy)
  }
})

tool('env_export', '把这套环境的登录（Cookie）导出成 JSON 文件，返回路径。不含 localStorage。文件里有完整 Cookie，只在本机用，不要发给别人。', z.object({ env: z.string() }), async (args) => {
  const id = String(args.env)
  const item = storage.envs.find((envItem) => envItem.id === id)
  if (!item) throw new Error(`没有这套环境 ${id}`)
  const ses = session.fromPartition(`persist:${id}`)
  const cookies = await ses.cookies.get({})
  const path = join(storage.dir('exports'), `env-${id}-${Date.now()}.json`)
  writeFileSync(path, JSON.stringify({ name: item.name, remark: item.remark, exportedAt: Date.now(), cookies }, null, 2))
  return { env: id, path, cookies: cookies.length }
})

tool('env_import', '从 env_export 导出的 JSON 恢复登录。env 不给就新建一套环境。返回环境编号。', z.object({
  path: z.string(),
  env: z.string().optional(),
  name: z.string().optional()
}), async (args) => {
  const raw = JSON.parse(readFileSync(String(args.path), 'utf8')) as { name?: string; cookies: Array<Record<string, unknown>> }
  let id = args.env ? String(args.env) : ''
  if (!id) {
    id = createId('env')
    storage.envs.push({ id, name: String(args.name || raw.name || '导入的环境'), remark: '', sites: [] })
    storage.saveEnvs()
  }
  const ses = session.fromPartition(`persist:${id}`)
  let ok = 0
  for (const cookie of raw.cookies ?? []) {
    try {
      const domain = String(cookie.domain || '')
      const secure = Boolean(cookie.secure)
      await ses.cookies.set({
        url: `${secure ? 'https' : 'http'}://${domain.replace(/^\./, '')}${String(cookie.path || '/')}`,
        name: String(cookie.name),
        value: String(cookie.value ?? ''),
        domain,
        path: String(cookie.path || '/'),
        secure,
        httpOnly: Boolean(cookie.httpOnly),
        expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : undefined
      })
      ok += 1
    } catch {
      /* 单个 cookie 失败跳过 */
    }
  }
  return { env: id, cookies: ok, total: (raw.cookies ?? []).length }
})

function dataEnv(args: { env?: string }): string {
  return typeof args.env === 'string' && args.env ? args.env : DEFAULT_ENV
}

tool('bookmark_list', '列出一套环境的书签，最近加的在前。query 按标题或网址过滤。', z.object({
  env: env,
  query: z.string().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const query = String(args.query ?? '').trim().toLowerCase()
  const items = storage.bookmarksFor(envId).filter((item) => !query || item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
  return {
    env: envId,
    bookmarks: items.map((item) => ({ id: item.id, url: item.url, title: item.title, createdAt: item.createdAt }))
  }
})

tool('bookmark_add', '给一套环境加书签。网址已经在书签里就更新标题，不会重复加。', z.object({
  env: env,
  url: z.string(),
  title: z.string().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const url = normalizeUrl(String(args.url))
  if (!/^https?:/i.test(url)) throw new Error(`书签只存 http/https：${url}`)
  const item = storage.addBookmark({ envId, url, title: typeof args.title === 'string' ? args.title : '' })
  bridge.broadcast(envId)
  return { env: envId, id: item.id, url: item.url, title: item.title }
})

tool('bookmark_remove', '删书签：给 id 或 url 删一条，all 为 true 清空这套环境的书签。返回删掉几条。', z.object({
  env: env,
  id: z.string().optional(),
  url: z.string().optional(),
  all: z.boolean().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  if (!args.id && !args.url && !args.all) throw new Error('需要 id、url 或 all: true')
  const removed = storage.removeBookmarkWhere(envId, {
    id: typeof args.id === 'string' ? args.id : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    all: Boolean(args.all)
  })
  if (removed) bridge.broadcast(envId)
  return { env: envId, removed }
})

tool('history_list', '列出一套环境的历史记录，最近的在前。query 按标题或网址过滤，limit 默认 50、最多 500。', z.object({
  env: env,
  query: z.string().optional(),
  limit: z.number().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const query = String(args.query ?? '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 50)))
  const items = storage.historyFor(envId)
    .filter((item) => !query || item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
    .slice(0, limit)
  return {
    env: envId,
    history: items.map((item) => ({ id: item.id, url: item.url, title: item.title, visitedAt: item.visitedAt }))
  }
})

tool('history_remove', '删历史记录：给 id 或 url 删一条，all 为 true 清空这套环境。导航产生的记录会自动写入，不用手动加。', z.object({
  env: env,
  id: z.string().optional(),
  url: z.string().optional(),
  all: z.boolean().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  if (!args.id && !args.url && !args.all) throw new Error('需要 id、url 或 all: true')
  const removed = storage.removeHistoryWhere(envId, {
    id: typeof args.id === 'string' ? args.id : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    all: Boolean(args.all)
  })
  if (removed) bridge.broadcast(envId)
  return { env: envId, removed }
})

tool('session_list', '列出保存的标签会话（关窗口时自动存，下次开窗口恢复）。不传 env 列出所有环境。', z.object({
  env: env
}), async (args) => {
  const envId = typeof args.env === 'string' && args.env ? args.env : ''
  const ids = envId ? [envId] : Object.keys(storage.sessions)
  const sessions = ids
    .map((id) => ({ id, saved: storage.sessionFor(id) }))
    .filter((item) => item.saved)
    .map((item) => ({
      env: item.id,
      savedAt: item.saved!.savedAt,
      activeUrl: item.saved!.activeUrl,
      tabs: item.saved!.tabs.map((tabItem) => ({ url: tabItem.url, title: tabItem.title, groupId: tabItem.groupId }))
    }))
  return { sessions }
})

tool('session_save', '把一套环境现在开着的标签存成会话快照。窗口没开就报错。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(`这套环境的窗口没开：${envId}`)
  saveSessionNow(runtime)
  const saved = storage.sessionFor(envId)
  return { env: envId, tabs: saved?.tabs.length ?? 0, savedAt: saved?.savedAt }
})

tool('session_restore', '把保存的会话重新打开成标签：窗口没开会先开，已经在的标签跳过，最多 20 个。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const saved = storage.sessionFor(envId)
  if (!saved?.tabs.length) throw new Error('这套环境没有保存的会话')
  const runtime = openEnvironment(envId, false)
  let opened = 0
  for (const item of saved.tabs.slice(0, 20)) {
    if (!item.url || item.url.startsWith('browserpilot://')) continue
    if (runtime.tabs.some((tabItem) => tabItem.kind === 'page' && tabItem.url === item.url)) continue
    addTab(runtime, item.url)
    opened += 1
  }
  return { env: envId, opened }
})

tool('session_clear', '清掉保存的会话，下次打开这套环境的窗口不再恢复这些标签。不影响已经开着的标签和历史记录。', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  storage.clearSession(envId)
  return { env: envId, cleared: true }
})

function cookieAddress(cookie: { domain?: string; path?: string; secure?: boolean }): string {
  const host = String(cookie.domain || '').replace(/^\./, '')
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
}

tool('cookie_list', '列出这套环境的 Cookie，可按域名过滤。值里可能有登录令牌，只在本机用，不要贴到对话或日志里。', z.object({
  env: env,
  domain: z.string().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const domain = String(args.domain ?? '').trim().replace(/^\./, '').toLowerCase()
  const cookies = await session.fromPartition(`persist:${envId}`).cookies.get({})
  const list = cookies.filter((cookie) => {
    const host = String(cookie.domain || '').replace(/^\./, '').toLowerCase()
    return !domain || host === domain || host.endsWith(`.${domain}`)
  })
  return {
    env: envId,
    cookies: list.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      session: cookie.session,
      expirationDate: cookie.expirationDate
    }))
  }
})

tool('cookie_set', '给这套环境写一条 Cookie。url 不给就按 domain 拼一个地址。同名同域的会被覆盖。', z.object({
  env: env,
  name: z.string(),
  value: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  expirationDate: z.number().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const name = String(args.name)
  const value = String(args.value ?? '')
  const path = typeof args.path === 'string' && args.path ? args.path : '/'
  const secure = Boolean(args.secure)
  const url = typeof args.url === 'string' && args.url
    ? args.url
    : args.domain
      ? `${secure ? 'https' : 'http'}://${String(args.domain).replace(/^\./, '')}${path}`
      : ''
  if (!url) throw new Error('需要 url 或 domain')
  const details: Electron.CookiesSetDetails = { url, name, value, path, secure, httpOnly: Boolean(args.httpOnly) }
  if (typeof args.domain === 'string' && args.domain) details.domain = args.domain
  if (typeof args.expirationDate === 'number') details.expirationDate = args.expirationDate
  await session.fromPartition(`persist:${envId}`).cookies.set(details)
  bridge.broadcast(envId)
  return { env: envId, ok: true }
})

tool('cookie_remove', '删 Cookie：给 url + name 删一条；给 domain 删这个域名下全部；all 为 true 清空这套环境。返回删掉几条。', z.object({
  env: env,
  name: z.string().optional(),
  url: z.string().optional(),
  domain: z.string().optional(),
  all: z.boolean().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const ses = session.fromPartition(`persist:${envId}`)
  if (args.all) {
    const all = await ses.cookies.get({})
    for (const cookie of all) await ses.cookies.remove(cookieAddress(cookie), cookie.name)
    bridge.broadcast(envId)
    return { env: envId, removed: all.length }
  }
  if (typeof args.domain === 'string' && args.domain) {
    const domain = args.domain.replace(/^\./, '').toLowerCase()
    const all = await ses.cookies.get({})
    const matched = all.filter((cookie) => {
      const host = String(cookie.domain || '').replace(/^\./, '').toLowerCase()
      return host === domain || host.endsWith(`.${domain}`)
    })
    for (const cookie of matched) await ses.cookies.remove(cookieAddress(cookie), cookie.name)
    bridge.broadcast(envId)
    return { env: envId, removed: matched.length }
  }
  if (typeof args.url === 'string' && args.url && typeof args.name === 'string' && args.name) {
    await ses.cookies.remove(args.url, args.name)
    bridge.broadcast(envId)
    return { env: envId, removed: 1 }
  }
  throw new Error('需要 url + name，或 domain，或 all: true')
})

export const screenWaiters = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>()
export const screenStartWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

const CORE_TOOLS = new Set([
  'search_tools',
  'env_list',
  'env_open',
  'tab_list',
  'tab_open',
  'page_navigate',
  'page_snapshot',
  'page_click',
  'page_type',
  'page_wait',
  'page_script',
  'page_screenshot',
  'page_unlock'
])

export function advertisedToolMeta(mode: string): { name: string; description: string; inputSchema: unknown }[] {
  const all = listToolMeta()
  return mode === 'search' ? all.filter((item) => CORE_TOOLS.has(item.name)) : all
}

export function listToolMeta(): { name: string; description: string; inputSchema: unknown }[] {
  return tools.map((item) => ({
    name: item.name,
    description: item.description,
    inputSchema: zodToJsonSchema(item.schema)
  }))
}

const longToolTimeouts: Array<[string, number]> = [
  ['page_record_video', 3700000],
  ['screen_stop', 3700000],
  ['page_save_media', 900000],
  ['page_watch', 150000],
  ['page_wait', 90000],
  ['download_list', 180000],
  ['captcha_solve', 240000],
  ['workflow_run', 1800000],
  ['workflow_batch', 1800000]
]
for (const [name, ms] of longToolTimeouts) toolTimeouts.set(name, ms)

export async function callTool(name: string, raw: unknown): Promise<ToolResult> {
  const item = tools.find((toolItem) => toolItem.name === name)
  if (!item) return { ok: false, control: 'shared', error: `没有这个工具 ${name}` }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && item.schema instanceof z.ZodObject) {
    const def = (item.schema as z.ZodObject<z.ZodRawShape>)._def
    if (def.unknownKeys !== 'passthrough') {
      const known = Object.keys((item.schema as z.ZodObject<z.ZodRawShape>).shape)
      const extra = Object.keys(raw as Record<string, unknown>).filter((key) => !known.includes(key))
      if (extra.length) {
        const hint = extra.includes('tab') && known.includes('tabId') ? '。标签参数叫 tabId，不是 tab' : ''
        return { ok: false, control: 'shared', error: `不认识参数 ${extra.join('、')}${hint}。这个工具的参数是：${known.join('、') || '（无）'}` }
      }
    }
  }
  let args: Record<string, unknown>
  try {
    args = item.schema.parse(raw ?? {}) as Record<string, unknown>
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`).join('；')
      return { ok: false, control: 'shared', error: `参数不对：${issues}` }
    }
    throw error
  }
  const pendingTab = typeof args.tabId === 'string' ? args.tabId : ''
  if (pendingTab && name.startsWith('page_') && name !== 'page_dialog' && name !== 'page_navigate') {
    const dialog = pendingDialog(pendingTab)
    if (dialog) {
      return {
        ok: false,
        control: controlOf(pendingTab),
        error: `页面有未处理的弹窗（${dialog.type}）：「${dialog.message.slice(0, 120)}」。先调 page_dialog 选 accept 或 dismiss，或者 page_navigate 离开`
      }
    }
  }
  try {
    const timeoutMs = toolTimeouts.get(name) ?? DEFAULT_TOOL_TIMEOUT
    const data = await withTimeout(item.run(args), timeoutMs, `工具 ${name} 超时（${Math.round(timeoutMs / 1000)} 秒没返回）。页面可能被弹窗挡住或脚本卡住，先看 page_dialog，必要时 page_navigate`)
    const tabId = typeof data.tabId === 'string' ? data.tabId : typeof args.tabId === 'string' ? args.tabId : undefined
    const envId = typeof args.env === 'string' ? args.env : undefined
    return finish({ tabId, env: envId }, data)
  } catch (error) {
    const tabId = typeof (raw as { tabId?: string })?.tabId === 'string' ? (raw as { tabId: string }).tabId : undefined
    let errorShot: string | undefined
    if (tabId) {
      try {
        const found = resolveTab({ tabId }, true)
        const shot = await withTimeout(screenshot(found.tab, storage.dir('screenshots')), 8_000, '现场截图超时')
        errorShot = shot.path
      } catch {
        /* 现场截图失败就算了 */
      }
    }
    return {
      ok: false,
      control: controlOf(tabId, typeof (raw as { env?: string })?.env === 'string' ? (raw as { env: string }).env : undefined),
      error: error instanceof Error ? error.message : String(error),
      ...(errorShot ? { errorShot } : {})
    }
  }
}

