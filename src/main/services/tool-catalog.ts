import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { clipboard, session } from 'electron'
import { mkdirSync } from 'fs'
import { rm } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { DEFAULT_ENV, type ActVia, type Control, type Locator, type WorkflowApp, type WorkflowNode } from '@shared/types'
import { searchEngines } from '@shared/types'
import { createId } from '../ids'
import { applyMainLanguage } from '../i18n'
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
  clickRef,
  clickText,
  clickTextInFrame,
  clickLocatorInFrame,
  crossQuery,
  deepQuery,
  dragPage,
  elementBox,
  dismissOverlays,
  listOverlays,
  canvasSums,
  checkStroke,
  drawPath,
  drawPaths,
  drawShapePoints,
  thinPoints,
  fillScanlines,
  fillSerpentine,
  svgPathToPoints,
  turtleRun,
  evalInFrame,
  evalSource,
  findInPage,
  hoverLocator,
  hoverLocatorInFrame,
  hoverHit,
  hoverPoint,
  hoverRef,
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
  sendCdpBatch,
  swipePage,
  typeAtPoint,
  typeByLabel,
  typeDeep,
  typeRef,
  typeLocator,
  typeLocatorInFrame,
  uploadFiles,
  waitForGone,
  waitForLoad,
  waitForLocator,
  waitForStable
} from '../page'
import { captchaPanelShot, captchaRead, detectCaptcha, solveCaptcha } from '../captcha'
import { deleteWorkflow, exportWorkflow, findWorkflow, importWorkflow, runWorkflow, workflowParams, workflowUpdate, workflowWrite } from './RecordService'
import { netExport, netGet, netList, netMock, netMockOff, netStart, netStop } from './NetService'
import { mt } from '../i18n'
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

type RecordedCall = { tool: string; args: Record<string, unknown> }

let recording: { startedAt: number; calls: RecordedCall[] } | null = null

const RECORDABLE = new Set([
  'page_navigate', 'page_click', 'page_type', 'page_key', 'page_scroll', 'page_select', 'page_upload', 'page_draw', 'page_wait'
])

const NODE_TYPE: Record<string, string> = {
  page_navigate: 'goto',
  page_click: 'click',
  page_type: 'fill',
  page_key: 'press',
  page_scroll: 'scroll',
  page_select: 'select',
  page_upload: 'upload',
  page_draw: 'stroke',
  page_wait: 'wait'
}

/**
 * 把一个工具调用翻成工作流节点。定位只认 xpath / selector：按文字、角色、标签点的调用没法写成节点，
 * 返回 skip 说明原因，让录制结果诚实，而不是悄悄少一步。
 */
function recordedNode(call: RecordedCall, index: number): { node?: WorkflowNode; skip?: string } {
  const args = call.args
  const selector = typeof args.selector === 'string' && args.selector ? args.selector : ''
  const xpath = typeof args.xpath === 'string' && args.xpath ? args.xpath : ''
  const locator = selector || xpath ? { ...(selector ? { selector } : {}), ...(xpath ? { xpath } : {}) } : undefined
  const id = `step-${index + 1}`
  const base = (title: string, extra: Record<string, unknown>): { node: WorkflowNode } => ({ node: { id, data: { type: NODE_TYPE[call.tool] || 'wait', title, ...extra } } })

  if (call.tool === 'page_navigate') {
    const url = typeof args.url === 'string' ? args.url : ''
    if (!url) return { skip: mt('main.tc.skipUrl') }
    return { node: { id, data: { type: 'goto', title: mt('workflow.node.goto'), url } } }
  }
  if (call.tool === 'page_click') {
    if (!locator) {
      const text = typeof args.text === 'string' ? args.text : ''
      const role = typeof args.role === 'string' ? args.role : ''
      const name = typeof args.name === 'string' ? args.name : ''
      if (text || role) {
        return base(mt('workflow.node.click'), {
          locator: {
            ...(text ? { text } : {}),
            ...(role ? { role } : {}),
            ...(name ? { name } : {}),
            ...(args.textMatch === 'exact' ? { textMatch: 'exact' } : {}),
            ...(args.nameMatch === 'exact' ? { nameMatch: 'exact' } : {})
          }
        })
      }
      if (args.x === undefined || args.y === undefined) return { skip: mt('main.tc.skipClick') }
      return { node: { id, data: { type: 'click', title: mt('workflow.node.click'), x: Number(args.x), y: Number(args.y) } } }
    }
    return base(mt('workflow.node.click'), { locator })
  }
  if (call.tool === 'page_type') {
    if (!locator) return { skip: mt('main.tc.skipType') }
    return base(mt('workflow.node.fill'), { locator, text: String(args.text ?? ''), entry: args.entry === 'paste' ? 'paste' : 'type' })
  }
  if (call.tool === 'page_key') return base(mt('workflow.node.press'), { shortcut: String(args.shortcut ?? '') })
  if (call.tool === 'page_scroll') return base(mt('workflow.node.scroll'), { direction: args.direction === 'up' ? 'up' : 'down' })
  if (call.tool === 'page_select') {
    if (!locator) return { skip: mt('main.tc.skipSelect') }
    return base(mt('workflow.node.select'), { locator, option: String(args.option ?? '') })
  }
  if (call.tool === 'page_upload') {
    if (!locator) return { skip: mt('main.tc.skipUpload') }
    return base(mt('workflow.node.upload'), { locator, paths: Array.isArray(args.paths) ? args.paths : [] })
  }
  if (call.tool === 'page_draw') {
    if (!selector) return { skip: mt('main.tc.skipStrokeSelector') }
    if (typeof args.path !== 'string' || !args.path) return { skip: mt('main.tc.skipStrokePath') }
    return base(mt('workflow.node.stroke'), { locator: { selector }, path: args.path, viewBox: Array.isArray(args.viewBox) ? args.viewBox : undefined })
  }
  if (call.tool === 'page_wait') {
    if (typeof args.stable === 'number') return base(mt('workflow.field.settle'), { stable: args.stable })
    if (!locator) return { skip: mt('main.tc.skipWait') }
    return base(mt('workflow.node.wait'), { locator, state: args.state === 'gone' ? 'gone' : 'appear', timeout: args.timeout ?? 10 })
  }
  return { skip: mt('main.tc.skipTool', { tool: call.tool }) }
}

const tools: Tool[] = []
const shapes = new Map<string, z.ZodRawShape>()

function viaOf(value: unknown): ActVia {
  if (value === 'inject' || value === 'native' || value === 'cdp' || value === 'pointer') return value
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
  if (x === undefined || y === undefined) throw new Error(mt('main.tc.needXY'))
  const shotId = typeof args.shotId === 'string' && args.shotId ? args.shotId : ''
  if (shotId) {
    const stored = shotRefs.get(shotId)
    if (!stored) throw new Error(mt('main.tc.shotStale', { id: shotId }))
    return { x, y, shot: stored.shot }
  }
  const hasW = args.shotWidth != null && args.shotWidth !== ''
  const hasH = args.shotHeight != null && args.shotHeight !== ''
  if (hasW !== hasH) throw new Error(mt('main.tc.shotWH'))
  if (!hasW) return { x, y }
  const width = numArg(args.shotWidth)
  const height = numArg(args.shotHeight)
  if (width === undefined || height === undefined) throw new Error(mt('main.tc.shotWHNum'))
  const hasOX = args.shotX != null && args.shotX !== ''
  const hasOY = args.shotY != null && args.shotY !== ''
  const hasScale = args.shotScale != null && args.shotScale !== ''
  if (hasOX || hasOY || hasScale) {
    if (!(hasOX && hasOY && hasScale)) throw new Error(mt('main.tc.shotOXY'))
    const originX = numArg(args.shotX)
    const originY = numArg(args.shotY)
    const scale = numArg(args.shotScale)
    if (originX === undefined || originY === undefined || scale === undefined) throw new Error(mt('main.tc.shotOXYNum'))
    return { x, y, shot: { width, height, originX, originY, scale } }
  }
  return { x, y, shot: { width, height } }
}

function gestureVia(value: unknown): 'cdp' | 'native' | 'pointer' {
  if (value === 'native') return 'native'
  if (value === 'pointer') return 'pointer'
  return 'cdp'
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

const NEED_LOCATOR = mt('main.tc.needLocator')

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
  ['env_', 'Environments'],
  ['tab_', 'Tabs'],
  ['group_', 'Groups'],
  ['page_', 'Page'],
  ['screen', 'Recording'],
  ['screen_', 'Recording'],
  ['workflow_', 'Workflows'],
  ['net_', 'Network'],
  ['captcha_', 'Captcha'],
  ['bookmark_', 'Bookmarks'],
  ['history_', 'History'],
  ['session_', 'Sessions'],
  ['cookie_', 'Cookie'],
  ['download', 'Downloads'],
  ['download_', 'Downloads'],
  ['clipboard_', 'Clipboard'],
  ['settings_', 'Settings'],
  ['permission_', 'Permissions'],
  ['password_', 'Passwords'],
  ['search_', 'Tool search']
]

// i18n-ignore-start 中文检索关键词，故意保留，供中文用户搜工具
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
  page_snapshot: '快照 无障碍树 snapshot a11y ref 编号',
  page_dialog: '弹窗 对话框 确认框 alert confirm prompt',
  page_console: '控制台 console 报错 js错误 日志',
  page_overlay: '广告 遮罩 浮层 弹窗 挡住 overlay iframe 关闭广告',
  page_find: '页内查找 查找文字 ctrl+f find',
  page_hover: '悬停 悬浮 移上去 hover 按文字 text role name within index frame iframe',
  page_click: '点击 双击 右键 click dblclick 按文字 文本 text role name 角色 名称 within index 第几个 ref 快照编号 offset 偏移 frame iframe',
  page_type: '输入 填写 打字 type label 标签 placeholder frame iframe',
  page_wait: '等待 等元素 wait',
  page_wait_load: '等加载 加载完成 页面加载完',
  page_save_media: '保存图片 保存视频 下载媒体 抓图 存媒体',
  page_record_video: '录像 录制视频 录屏视频',
  page_upload: '上传文件 文件选择',
  page_script: '执行脚本 js eval',
  page_source: '源码 html 源码文本',
  page_watch: '盯元素 等变化 监听元素',
  download: '下载记录 下载列表 文件在哪 落盘路径 下载目录 保存位置 暂停下载 继续下载 取消下载 重试下载 打开文件',
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
  screen: '录屏 录制窗口 停止录屏 录屏状态',
  window_preview: '整窗预览 整窗截图',
  search_tools: '找工具 搜工具 工具列表'
}
// i18n-ignore-end

function groupOf(name: string): string {
  return TOOL_GROUPS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 'Other'
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

tool('search_tools', 'Search tools by keyword across names, descriptions and groups (space separated, all words must match). Paginates with total/page/page_size and returns each schema. Pass name to get one tool in full; with no query it lists the catalog. Search first instead of guessing parameters.', z.object({
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
    if (!exact) throw new Error(mt('main.tc.noTool', { name: args.name }))
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

tool('env_list', 'List environments with id, name, note, window open or not, headed or headless. Never returns cookies.', z.object({}), async () => ({
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

tool('env_create', 'Create an empty environment and open a headed window. remark is required: state what this environment is for (customer A dashboard, second account).', z.object({
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

tool('env_open', 'Open the window of an existing environment. Headed when a human is involved; pass headless true for batch work. Does not raise the window; use env_front for that.', z.object({
  env: z.string(),
  headless: z.boolean().optional()
}), async (args) => {
  const id = String(args.env)
  if (!storage.envs.some((item) => item.id === id)) throw new Error(mt('main.tc.noEnv', { id }))
  const runtime = openEnvironment(id, Boolean(args.headless))
  return { env: id, headless: runtime.headless }
})

tool('env_front', 'Raise and focus an environment window, optionally activating a tab first. No other tool steals focus; call this only when the user must see the window (handoff, demo, recording).', z.object({
  env: env,
  tabId: z.string().optional()
}), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = openEnvironment(envId, false)
  if (runtime.headless) throw new Error(mt('main.tc.headlessNoFront'))
  let tabId = runtime.activeTabId
  if (args.tabId) {
    const tab = runtime.tabs.find((item) => item.id === String(args.tabId))
    if (!tab) throw new Error(mt('main.err.noTab', { id: args.tabId }))
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

tool('env_update', 'Rename an environment or change its note. The id stays the same.', z.object({
  env: z.string(),
  name: z.string().optional(),
  remark: z.string().optional()
}), async (args) => {
  const item = storage.envs.find((envItem) => envItem.id === args.env)
  if (!item) throw new Error(mt('main.tc.noEnv', { id: String(args.env) }))
  if (typeof args.name === 'string') item.name = args.name
  if (typeof args.remark === 'string') item.remark = args.remark
  storage.saveEnvs()
  const runtime = windows.get(item.id)
  if (runtime) runtime.win.setTitle(`${item.name} · BrowserPilot`)
  return { env: item.id, name: item.name, remark: item.remark }
})

tool('env_delete', 'Close the window and clear its logins. The default environment cannot be deleted.', z.object({ env: z.string() }), async (args) => {
  const id = String(args.env)
  if (id === DEFAULT_ENV) throw new Error(mt('main.tc.defaultEnv'))
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

tool('tab_list', 'List tabs across all windows. Tab ids are globally unique.', z.object({}), async () => ({
  tabs: [...windows.values()].flatMap((win) => win.tabs.map((item) => ({
    id: item.id,
    envId: item.envId,
    groupId: item.groupId,
    title: item.title,
    url: item.url,
    kind: item.kind
  })))
}))

tool('tab_open', 'Open a new tab in an environment window. Defaults to the default environment.', z.object({
  url: z.string(),
  env: env
}), async (args) => {
  const runtime = openEnvironment(String(args.env || DEFAULT_ENV), windows.get(String(args.env || DEFAULT_ENV))?.headless ?? false)
  const tabRef = addTab(runtime, String(args.url), null, null, false)
  return { tabId: tabRef.id, env: runtime.envId }
})

tool('tab_close', 'Close a tab by its global id.', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  closeTab(win, tabRef.id)
  return { tabId: tabRef.id }
})

tool('tab_activate', 'Make a tab active by id. Does not raise the window; use env_front to show it.', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  if (win.headless) applyHeadless(win, false)
  activateTab(win, tabRef.id, false)
  return { tabId: tabRef.id }
})

tool('group_create', 'Create a tab group in an environment window.', z.object({
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

tool('group_update', 'Rename or recolor a group. The id stays the same.', z.object({
  groupId: z.string(),
  name: z.string().optional(),
  color: z.string().optional()
}), async (args) => {
  const group = storage.groups.find((item) => item.id === args.groupId)
  if (!group) throw new Error(mt('main.tc.noGroup', { id: String(args.groupId) }))
  if (typeof args.name === 'string') group.name = args.name
  if (typeof args.color === 'string') group.color = args.color
  storage.saveGroups()
  return { groupId: group.id, name: group.name, color: group.color }
})

tool('group_list', 'List groups and the tabs inside them.', z.object({ env: env }), async (args) => ({
  groups: storage.groups
    .filter((item) => !args.env || item.envId === args.env)
    .map((item) => ({
      ...item,
      tabIds: (windows.get(item.envId)?.tabs ?? []).filter((tabItem) => tabItem.groupId === item.id).map((tabItem) => tabItem.id)
    }))
}))

tool('tab_group', 'Put a tab into a group. An empty groupId removes it from the group.', z.object({
  tabId: z.string(),
  groupId: z.string().nullable().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const groupId = args.groupId ? String(args.groupId) : null
  if (groupId) {
    const group = storage.groups.find((item) => item.id === groupId)
    if (!group || group.envId !== tabRef.envId) throw new Error(mt('main.tc.groupNotInWindow'))
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

tool('env_close', 'Close the environment window but keep logins, cookies and the tab session. env_delete clears logins instead.', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) return { env: envId, closed: false }
  runtime.win.close()
  return { env: envId, closed: true }
})

tool('env_headless', 'Switch an open environment between headed and headless. Headless hides the window; screenshots and scripts still work.', z.object({
  env: env,
  headless: z.boolean()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(mt('main.tc.windowClosed', { id: envId }))
  const headless = Boolean(args.headless)
  applyHeadless(runtime, headless)
  bridge.broadcast(envId)
  return { env: envId, headless }
})

tool('tab_restore', 'Reopen the most recently closed tab. Returns restored false when there is nothing to restore.', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(mt('main.tc.windowClosed', { id: envId }))
  const restored = restoreTab(runtime)
  return { env: envId, restored: Boolean(restored), tabId: restored?.id, url: restored?.url }
})

tool('tab_duplicate', 'Duplicate a tab: open the same address again right after the original.', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const copy = duplicateTab(win, tabRef.id)
  if (!copy) throw new Error(mt('main.tc.cannotDuplicate', { id: tabRef.id }))
  return { tabId: copy.id, from: tabRef.id, url: copy.url }
})

tool('tab_close_others', 'Close every other tab in the same window.', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  closeOtherTabs(win, tabRef.id)
  return { tabId: tabRef.id, remaining: win.tabs.length }
})

tool('tab_mute', 'Toggle tab audio mute.', z.object({
  tabId: z.string()
}), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  muteTab(win, tabRef.id)
  return { tabId: tabRef.id, muted: Boolean(tabRef.muted) }
})

tool('group_delete', 'Delete a group. Its tabs are kept, just ungrouped.', z.object({
  groupId: z.string()
}), async (args) => {
  const id = String(args.groupId)
  const group = storage.groups.find((item) => item.id === id)
  if (!group) throw new Error(mt('main.tc.noGroup', { id }))
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

tool('permission_list', 'List site permissions remembered for this environment (camera, microphone, notifications, location and so on).', z.object({
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

tool('password_list', 'List saved logins for this environment: site and account only, never passwords. Use it to judge whether a site can be filled automatically.', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  return { env: envId, passwords: listPasswords(envId), storage: passwordStorageStatus() }
})

const SETTING_KEYS = ['language', 'tabLayout', 'searchEngine', 'passwordSave', 'passwordAutofill', 'batchConcurrency', 'headlessLimit', 'toolMode'] as const

function pickSettings(): Record<string, unknown> {
  return {
    language: storage.settings.language ?? 'auto',
    tabLayout: storage.settings.tabLayout,
    searchEngine: storage.settings.searchEngine,
    passwordSave: storage.settings.passwordSave,
    passwordAutofill: storage.settings.passwordAutofill,
    batchConcurrency: storage.settings.batchConcurrency,
    headlessLimit: storage.settings.headlessLimit,
    toolMode: storage.settings.toolMode
  }
}

tool('settings_get', 'Read browser settings: UI language, tab layout, search engine, password switches, batch concurrency, headless limit. Port and MCP switches are local service config, not included.', z.object({}), async () => ({ settings: pickSettings() }))

tool('settings_set', 'Change browser settings: language (auto, zh-CN or en-US, UI only), tabLayout (top or left), searchEngine, passwordSave, passwordAutofill, batchConcurrency, headlessLimit, toolMode (full or search). Applies immediately.', z.object({
  language: z.enum(['auto', 'zh-CN', 'en-US']).optional(),
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
  if (!Object.keys(patch).length) throw new Error(mt('main.tc.noSettingFields', { list: SETTING_KEYS.join(', ') }))
  if (typeof patch.searchEngine === 'string' && !searchEngines.some((item) => item.id === patch.searchEngine)) {
    throw new Error(mt('main.tc.unknownSearchEngine', { engine: patch.searchEngine, list: searchEngines.map((item) => item.id).join(', ') }))
  }
  if (patch.batchConcurrency !== undefined) patch.batchConcurrency = Math.max(1, Math.min(3, Number(patch.batchConcurrency) || 1))
  if (patch.headlessLimit !== undefined) patch.headlessLimit = Math.max(1, Number(patch.headlessLimit) || 1)
  storage.settings = { ...storage.settings, ...patch }
  if (patch.language !== undefined) applyMainLanguage(storage.settings.language)
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

tool('clipboard_read', 'Read text from the system clipboard. May contain secrets; keep it local.', z.object({}), async () => ({ text: await readClipboard() }))

tool('clipboard_write', 'Write text to the system clipboard.', z.object({
  text: z.string()
}), async (args) => {
  const text = String(args.text)
  await writeClipboard(text)
  return { ok: true, length: text.length }
})

tool('page_navigate', 'Open an address.', z.object({ ...pageArgs, url: z.string() }), async (args) => {
  const tabRef = await pageTab(args)
  await navigate(tabRef, String(args.url))
  return { tabId: tabRef.id, url: tabRef.url }
})

tool('page_back', 'Go back.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.navigationHistory.goBack()
  return { tabId: tabRef.id }
})

tool('page_forward', 'Go forward.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.navigationHistory.goForward()
  return { tabId: tabRef.id }
})

tool('page_reload', 'Reload the page.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  tabRef.view?.webContents.reload()
  await waitForLoad(tabRef.view!.webContents).catch(() => undefined)
  return { tabId: tabRef.id }
})

tool('page_snapshot', 'Read the accessibility tree. Refs are valid for this call only. Does not change who controls the browser.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args, false)
  const tree = await readTree(tabRef)
  return { tabId: tabRef.id, snapshot: tree.text }
})

tool('page_query', 'Return every match for one locator with index, text, hittable flag and rect. Click and type never use this list; they require exactly one match. pierce also searches shadow DOM and same-origin iframes.', z.object({
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

tool('page_click', 'Click an element. Prefer text (visible label, textMatch exact optional), then role plus name, then xpath or selector. within narrows to a CSS container (supports :has-text), index picks the Nth match, offsetX and offsetY shift from the center. Use frame for cross-origin iframes and button right for context menus. For canvas targets use x and y: viewport CSS pixels, or image pixels when shotId comes from page_screenshot. via defaults to cdp; native uses sendInputEvent; inject dispatches pointer events in the page. untilXpath or untilSelector retries up to 3 times until the element appears. count 2 double-clicks.', z.object({
  ...pageArgs,
  ...locateFields,
  text: z.string().optional(),
  textMatch: z.enum(['exact', 'contains']).optional(),
  testId: z.string().optional(),
  alt: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  nameMatch: z.enum(['exact', 'contains']).optional(),
  within: z.string().optional(),
  index: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  canvasX: z.number().optional(),
  canvasY: z.number().optional(),
  ref: z.string().optional(),
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
  via: z.enum(['inject', 'native', 'cdp', 'pointer']).optional(),
  count: z.number().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const button = args.button === 'right' ? 'right' as const : 'left' as const
  const count = Math.max(1, Math.min(3, Number(args.count ?? 1))) 
  if (args.canvasX !== undefined || args.canvasY !== undefined) {
    if (args.canvasX === undefined || args.canvasY === undefined) throw new Error(mt('main.tc.canvasXY'))
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.canvasNeedsSelector'))
    const box = await elementBox(tabRef, located)
    const x = box.x + Number(args.canvasX)
    const y = box.y + Number(args.canvasY)
    await clickPoint(tabRef, x, y, viaOf(args.via), undefined, button, count)
    return { tabId: tabRef.id, x: Math.round(x), y: Math.round(y) }
  }
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  const text = typeof args.text === 'string' && args.text.trim() ? String(args.text) : ''
  const textMatch = args.textMatch === 'exact' ? 'exact' as const : 'contains' as const
  if (typeof args.ref === 'string' && args.ref) {
    const target = await clickRef(tabRef, String(args.ref), viaOf(args.via))
    return { tabId: tabRef.id, ref: String(args.ref), role: target.role, name: target.name }
  }
  if (typeof args.ref === 'string' && args.ref) {
    const target = await hoverRef(tabRef, String(args.ref), viaOf(args.via))
    return { tabId: tabRef.id, ref: String(args.ref), role: target.role, name: target.name }
  }
  const offsetX = args.offsetX === undefined ? 0 : Number(args.offsetX)
  const offsetY = args.offsetY === undefined ? 0 : Number(args.offsetY)
  const needsHit = Boolean(args.role || args.name || args.within || args.index !== undefined || offsetX !== 0 || offsetY !== 0)
  if (needsHit) {
    if (!args.selector && !args.xpath && !text && !args.role && !args.name && !args.testId && !args.alt) throw new Error(mt('main.tc.offsetNeedsTarget'))
    const hit = await resolveHit(tabRef, {
      selector: typeof args.selector === 'string' ? String(args.selector) : undefined,
      xpath: typeof args.xpath === 'string' ? String(args.xpath) : undefined,
      text: text || undefined,
      textMatch,
      testId: args.testId ? String(args.testId) : undefined,
      alt: args.alt ? String(args.alt) : undefined,
      role: args.role ? String(args.role) : undefined,
      name: args.name ? String(args.name) : undefined,
      nameMatch: args.nameMatch === 'exact' ? 'exact' : 'contains',
      within: args.within ? String(args.within) : undefined,
      index: args.index === undefined ? undefined : Number(args.index)
    }, frame || undefined)
    if (!hit) throw new Error(mt('main.tc.noTarget'))
    await clickHit(tabRef, hit, viaOf(args.via), offsetX, offsetY)
    return { tabId: tabRef.id, text: hit.label, x: Math.round(hit.x + hit.w / 2 + offsetX), y: Math.round(hit.y + hit.h / 2 + offsetY), index: typeof args.index === 'number' ? args.index : undefined }
  }
  if (frame) {
    if (text) {
      const hit = await clickTextInFrame(tabRef, frame, text, textMatch, viaOf(args.via))
      return { tabId: tabRef.id, text: hit.label, x: Math.round(hit.x), y: Math.round(hit.y) }
    }
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.frameClick'))
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
  if (!located) throw new Error(mt('main.tc.needTargetText'))
  if (located.pierce) {
    await clickDeep(tabRef, located, viaOf(args.via), button)
    return { tabId: tabRef.id }
  }
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await clickLocator(tabRef, located, viaOf(args.via), until, button, count)
  return { tabId: tabRef.id }
})

tool('page_wait', 'Wait for an element (state appear or gone with xpath or selector) or for the layout to settle (stable: seconds without change; use it after ads expand or images and fonts load). Both waits for the element first. timeout seconds default 10, max 60. Prefer this over fixed sleeps. pierce searches shadow DOM and same-origin iframes.', z.object({
  ...pageArgs, ...locateFields,
  state: z.enum(['appear', 'gone']).default('appear'),
  stable: z.number().optional(),
  timeout: z.number().optional()
}), async (args) => {
  const located = locatorFrom(args)
  const tabRef = await pageTab(args)
  const stableSeconds = typeof args.stable === 'number' ? Math.max(0.1, Math.min(10, args.stable)) : 0
  if (!located) {
    if (!stableSeconds) throw new Error(mt('main.tc.needWait'))
    const settle = await waitForStable(tabRef, stableSeconds * 1000, Math.max(1, Math.min(60, Number(args.timeout ?? 10))) * 1000)
    return { tabId: tabRef.id, stable: stableSeconds, waited: settle.waited }
  }
  const timeout = Math.max(1, Math.min(60, Number(args.timeout ?? 10))) * 1000
  if (located.pierce) {
    const started = Date.now()
    for (;;) {
      const found = await deepQuery(tabRef, located).catch(() => ({ total: 0 }))
      const present = found.total > 0
      if ((args.state === 'gone' && !present) || (args.state !== 'gone' && present)) {
        return { tabId: tabRef.id, state: args.state }
      }
      if (Date.now() - started >= timeout) throw new Error(args.state === 'gone' ? mt('main.tc.pierceGoneTimeout', { label: locatorLabel(located) }) : mt('main.tc.pierceAppearTimeout', { label: locatorLabel(located) }))
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (args.state === 'gone') await waitForGone(tabRef, located, timeout)
  else await waitForLocator(tabRef, located, timeout)
  if (stableSeconds) await waitForStable(tabRef, stableSeconds * 1000, timeout)
  return { tabId: tabRef.id, state: args.state, ...(stableSeconds ? { stable: stableSeconds } : {}) }
})

tool('page_type', 'Type text. Focus first, then type; non-Latin input uses Input.insertText. Locate with label (associated label or placeholder, simplest), a page_snapshot ref, xpath or selector, or x and y. entry paste inserts the whole string at once and avoids per-keystroke rewriting. via defaults to cdp; native clicks first; inject writes directly.', z.object({
  ...pageArgs, text: z.string(), ...locateFields,
  label: z.string().optional(),
  placeholder: z.string().optional(),
  ref: z.string().optional(),
  frame: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  entry: z.enum(['type', 'paste']).optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  if (typeof args.ref === 'string' && args.ref) {
    const target = await typeRef(tabRef, String(args.ref), String(args.text))
    return { tabId: tabRef.id, ref: String(args.ref), role: target.role, name: target.name }
  }
  const labelText = typeof args.label === 'string' && args.label.trim() ? String(args.label) : (typeof args.placeholder === 'string' && args.placeholder.trim() ? String(args.placeholder) : '')
  if (labelText) {
    await typeByLabel(tabRef, labelText, String(args.text))
    return { tabId: tabRef.id }
  }
  if (frame) {
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.frameType'))
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
  if (args.entry === 'paste') {
    await pasteLocator(tabRef, located, String(args.text), viaOf(args.via))
    return { tabId: tabRef.id }
  }
  if (located.pierce) {
    await typeDeep(tabRef, located, String(args.text), viaOf(args.via))
    return { tabId: tabRef.id }
  }
  await typeLocator(tabRef, located, String(args.text), viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_select', 'Choose an option in a select. via defaults to cdp (click, then click the option); native uses real clicks; inject sets the value directly.', z.object({
  ...pageArgs, option: z.string(), ...locateFields, via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  await selectLocator(tabRef, located, String(args.option), viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_key', 'Send a shortcut to the page without triggering window-level new or close tab. via defaults to cdp; native uses sendInputEvent.', z.object({
  ...pageArgs, shortcut: z.string(), via: z.enum(['cdp', 'native']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  await pressShortcut(tabRef, String(args.shortcut), gestureVia(args.via))
  return { tabId: tabRef.id }
})

tool('page_scroll', 'Scroll a long list. This is not the same as swipe. via defaults to cdp (wheel); native uses sendInputEvent. Without a target it scrolls from the viewport center. untilXpath or untilSelector scrolls until the element is hittable, at most 16 tries, and reports what blocked it.', z.object({
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

tool('page_swipe', 'Press, drag and release: sliders or horizontal panning. Use page_scroll for long lists; swiping does not scroll the page. via defaults to cdp; native uses sendInputEvent. Without a target it swipes from the viewport center. untilXpath or untilSelector repeats at most 20 times.', z.object({
  ...pageArgs,
  direction: z.enum(['up', 'down', 'left', 'right']).default('up'),
  ...locateFields,
  untilXpath: z.string().optional(),
  untilSelector: z.string().optional(),
  via: z.enum(['cdp', 'native', 'pointer']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await swipePage(tabRef, args.direction as 'up' | 'down' | 'left' | 'right', locatorFrom(args), until, gestureVia(args.via))
  return { tabId: tabRef.id }
})

tool('page_drag', 'Drag from a point or element by dx and dy with a human-like track (acceleration, jitter, slight overshoot). Use it for slider captchas and precise distances instead of page_swipe. Start from x and y (viewport CSS pixels, or image pixels with shotWidth, shotHeight and shotId) or from xpath or selector. toSelector or toText drags onto another element. via defaults to cdp.', z.object({
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
  canvasX: z.number().optional(),
  canvasY: z.number().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  toSelector: z.string().optional(),
  toText: z.string().optional(),
  via: z.enum(['cdp', 'native', 'pointer']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  let start: { x: number; y: number } | undefined
  if (args.canvasX !== undefined || args.canvasY !== undefined) {
    if (args.canvasX === undefined || args.canvasY === undefined) throw new Error(mt('main.tc.canvasXY'))
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.canvasNeedsSelector'))
    const box = await elementBox(tabRef, located)
    start = { x: box.x + Number(args.canvasX), y: box.y + Number(args.canvasY) }
  }
  const point = start ? undefined : pointArgs(args)
  if (start) {
    // 起点已经由画布坐标确定
  } else if (point) {
    start = mapPoint(tabRef, point.x, point.y, point.shot)
  } else {
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.dragStart'))
    start = await locatorGesturePoint(tabRef, located)
  }
  let dx = Number(args.dx ?? 0)
  let dy = Number(args.dy ?? 0)
  if (args.toSelector || args.toText) {
    const hit = await resolveHit(tabRef, {
      selector: args.toSelector ? String(args.toSelector) : undefined,
      text: args.toText ? String(args.toText) : undefined
    })
    if (!hit) throw new Error(mt('main.tc.dragEnd'))
    dx = hit.x + hit.w / 2 - start.x
    dy = hit.y + hit.h / 2 - start.y
  } else if (args.dx === undefined) {
    throw new Error(mt('main.tc.dragNeedDelta'))
  }
  const moved = await dragPage(tabRef, gestureVia(args.via), start, dx, dy)
  return { tabId: tabRef.id, from: moved.from, to: moved.to }
})

tool('page_inspect', 'Identify what an element is: video, image, canvas, audio, link, input or text. Returns kind, address (src, href or poster), tag, id, class, rect and text. Target by xpath or selector, or by x and y. After deriving coordinates from a screenshot, use this to confirm what you are about to click.', z.object({
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
  if (!point && !located) throw new Error(mt('main.tc.needTargetPoint'))
  const info = await inspectElement(tabRef, point ? { point: mapPoint(tabRef, point.x, point.y, point.shot) } : { locator: located })
  return { tabId: tabRef.id, ...info }
})

tool('page_save_media', 'Save an image, video, audio or canvas element to a local file using this environment session. Direct links download as is; DASH tracks (Bilibili, Douyin, YouTube) are merged into mp4; m3u8 or mpd go through ffmpeg; player-side streams fall back to page_record_video. Target by xpath or selector, or by x and y.', z.object({
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
  savePath: z.string().optional().describe('A file path saves exactly there; an existing directory saves into it (name derived); omit to use the download folder (system default, changeable with download action=dir)')
}), async (args) => {
  const tabRef = await pageTab(args)
  const point = pointArgs(args)
  const located = locatorFrom(args)
  if (!point && !located) throw new Error(mt('main.tc.needTargetPoint'))
  const savePath = typeof args.savePath === 'string' && args.savePath ? String(args.savePath) : undefined
  const saved = await saveMedia(tabRef, point ? { point: mapPoint(tabRef, point.x, point.y, point.shot) } : { locator: located }, downloadTargetDir(), savePath)
  return { tabId: tabRef.id, ...saved }
})

tool('download', 'Local download records and the download directory. action list lists downloads since this run (files persist), each with name, path, state, bytes, url and env; wait waits for active downloads, max 120s. action dir returns the directory, or changes it when path is given (absolute, created if missing; default restores the system folder). open, show, copy, pause, resume, cancel, retry, remove and clear act on one id from list; retry only applies to failed http or https items.', z.object({
  action: z.enum(['list', 'dir', 'open', 'show', 'copy', 'pause', 'resume', 'cancel', 'retry', 'remove', 'clear']),
  env: env,
  wait: z.number().optional(),
  path: z.string().optional(),
  id: z.string().optional()
}), async (args) => {
  if (String(args.action) === 'list') {

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
  }
  if (String(args.action) === 'dir') {

  const input = typeof args.path === 'string' ? args.path.trim() : ''
  if (input && input !== 'default') {
    if (!isAbsolute(input)) throw new Error(mt('main.tc.absPath', { path: input }))
    try {
      mkdirSync(input, { recursive: true })
    } catch {
      throw new Error(mt('main.tc.mkdirFail', { path: input }))
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
  }

  const action = String(args.action)
  if (action === 'clear') {
    downloadsClear()
    return { action, remaining: listDownloads().length }
  }
  const id = typeof args.id === 'string' ? args.id : ''
  if (!id) throw new Error(mt('main.tc.downloadId'))
  const item = listDownloads().find((entry) => entry.id === id)
  if (!item) throw new Error(mt('main.tc.noDownload', { id }))
  if (action === 'open') downloadOpen(id)
  else if (action === 'show') downloadShow(id)
  else if (action === 'copy') downloadCopyLink(id)
  else if (action === 'pause') downloadPause(id)
  else if (action === 'resume') downloadResume(id)
  else if (action === 'cancel') downloadCancel(id)
  else if (action === 'remove') {
    if (!downloadForget(id)) throw new Error(mt('main.tc.downloadBusy'))
  } else if (action === 'retry') {
    if (item.state !== 'failed') throw new Error(mt('main.tc.retryState', { state: item.state }))
    if (!item.envId || !/^https?:/i.test(item.url)) throw new Error(mt('main.tc.retryUrl'))
    await session.fromPartition(`persist:${item.envId}`).downloadURL(item.url)
  }
  const after = listDownloads().find((entry) => entry.id === id)
  return { action, id, state: after?.state ?? 'removed', path: after?.path ?? item.path }
})

tool('page_record_video', 'Record a playing video via captureStream and MediaRecorder into webm. seconds defaults to 10, max 3600; playback starts automatically. Works on any site but runs in real time. Uses the download directory when savePath is omitted. For direct streams use page_save_media instead.', z.object({
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

async function canvasBox(tabRef: TabRuntime, args: { selector?: string; x?: number; y?: number; width?: number; height?: number }): Promise<{ x: number; y: number; width: number; height: number }> {
  if (typeof args.selector === 'string' && args.selector) {
    const found = await queryLocator(tabRef, { selector: String(args.selector) })
    if (found.total !== 1) throw new Error(mt('main.tc.canvasAmbiguous', { count: found.total }))
    const rect = found.matches[0]?.rect
    if (!rect) throw new Error(mt('main.tc.canvasInvisible'))
    return { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
  }
  if (args.x === undefined || args.y === undefined || !args.width || !args.height) {
    throw new Error(mt('main.tc.canvasTarget'))
  }
  return { x: Number(args.x), y: Number(args.y), width: Number(args.width), height: Number(args.height) }
}

tool('page_draw', 'Draw on a canvas. Give points, or path (SVG d, supports M/L/H/V/C/S/Q/T/A/Z) with viewBox, or shape (circle, rect, triangle, heart, star). smooth fits a spline through the points, close closes the path, multiple M segments lift the pen. Pass selector to let the tool measure the element: path scales into it and points are element-local, so no stale x, y, width or height. Points may carry pressure (0-1) plus tiltX, tiltY and twist. By default the tool reads canvas pixels afterwards and returns check with painted, kept, wiped and empty; unsupported when there is no 2D context. verify false saves about 600ms. via defaults to cdp.', z.object({
  ...pageArgs,
  points: z.array(z.object({ x: z.number(), y: z.number(), pressure: z.number().optional(), tiltX: z.number().optional(), tiltY: z.number().optional(), twist: z.number().optional() })).optional(),
  path: z.string().optional(),
  selector: z.string().optional(),
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
  script: z.string().optional(),
  heading: z.number().optional(),
  verify: z.boolean().optional(),
  via: z.enum(['cdp', 'native', 'pointer']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const verify = args.verify !== false
  if (typeof args.script === 'string' && args.script.trim()) {
    const turtle = await turtleRun(tabRef, gestureVia(args.via), String(args.script), {
      x: args.x === undefined ? undefined : Number(args.x),
      y: args.y === undefined ? undefined : Number(args.y),
      heading: args.heading === undefined ? undefined : Number(args.heading)
    })
    return { tabId: tabRef.id, ...turtle }
  }
  if (typeof args.path === 'string' && args.path) {
    const box = await canvasBox(tabRef, args)
    const subpaths = svgPathToPoints(String(args.path), box, Array.isArray(args.viewBox) ? [Number((args.viewBox as number[])[0]), Number((args.viewBox as number[])[1])] : undefined)
    const sample = verify ? thinPoints(subpaths.flat(), 32) : []
    const before = sample.length ? await canvasSums(tabRef, sample) : undefined
    const drawn = await drawPaths(tabRef, gestureVia(args.via), subpaths)
    const check = before ? await checkStroke(tabRef, sample, before) : undefined
    return { tabId: tabRef.id, ...drawn, ...(check ? { check } : {}) }
  }
  let points = args.points as Array<{ x: number; y: number }> | undefined
  if (!points) {
    if (!args.shape) throw new Error(mt('main.tc.drawArgs'))
    const box = await canvasBox(tabRef, args)
    points = drawShapePoints(String(args.shape), box.x, box.y, box.width, box.height)
    args.close = true
  } else if (args.selector) {
    // 传了 selector 时，points 按元素内部坐标理解（左上角是 0,0）
    const box = await canvasBox(tabRef, args)
    points = points.map((point) => ({ ...point, x: box.x + point.x, y: box.y + point.y }))
  }
  const sample = verify ? thinPoints(points, 32) : []
  const before = sample.length ? await canvasSums(tabRef, sample) : undefined
  const drawn = await drawPath(tabRef, gestureVia(args.via), points, Boolean(args.close), Boolean(args.smooth))
  const fills = args.fill ? fillSerpentine(points, Math.max(3, Number(args.spacing ?? 5))) : []
  const filled = fills.length ? await drawPath(tabRef, gestureVia(args.via), fills) : undefined
  const check = before ? await checkStroke(tabRef, sample, before) : undefined
  return { tabId: tabRef.id, ...drawn, ...(filled ? { fillPoints: filled.points } : {}), ...(check ? { check } : {}) }
})

tool('page_upload', 'Hand local files to a file input without opening the system dialog. Target by xpath or selector; otherwise the first file input on the page.', z.object({
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

tool('page_lock', 'Lock the page behind an overlay that says the agent is operating the browser, with a take-over button.', z.object(pageArgs), async (args) => {
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  showAgentMask(resolved.tab)
  resolved.tab.userTookOver = false
  return { tabId: resolved.tab.id }
})

tool('page_unlock', 'Remove the overlay. The user can interact; the task is not paused.', z.object(pageArgs), async (args) => {
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  shareControl(resolved.tab, false)
  return { tabId: resolved.tab.id }
})

tool('page_handoff', 'Pause and let the user finish this step. Viewing the page does not re-lock it; the next action does.', z.object({
  ...pageArgs, message: z.string()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  beginHandoff(tabRef, String(args.message))
  return { tabId: tabRef.id, message: args.message }
})

tool('page_dialog', 'Page dialogs (alert, confirm, prompt) are answered automatically so tabs never block: alerts are dismissed, confirm returns cancel, prompt returns null. Call action accept first (once true for the next dialog only) when a confirmation must return OK. action list shows recent dialogs and the current policy.', z.object({
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

tool('page_hover', 'Move the pointer over an element or point to trigger hover menus and tooltips. Prefer text, a snapshot ref, or role plus name; xpath, selector and x and y also work. within and index behave like page_click. via defaults to cdp; inject fires mouseover and mouseenter.', z.object({
  ...pageArgs,
  ...locateFields,
  text: z.string().optional(),
  textMatch: z.enum(['exact', 'contains']).optional(),
  testId: z.string().optional(),
  alt: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  nameMatch: z.enum(['exact', 'contains']).optional(),
  within: z.string().optional(),
  index: z.number().optional(),
  ref: z.string().optional(),
  frame: z.string().optional(),
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  shotId: z.string().optional(),
  via: z.enum(['inject', 'native', 'cdp', 'pointer']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? String(args.frame) : ''
  const text = typeof args.text === 'string' && args.text.trim() ? String(args.text) : ''
  const textMatch = args.textMatch === 'exact' ? 'exact' as const : 'contains' as const
  const needsHit = Boolean(args.role || args.name || args.within || args.testId || args.alt || args.index !== undefined)
  if (needsHit) {
    const hit = await resolveHit(tabRef, {
      selector: typeof args.selector === 'string' ? String(args.selector) : undefined,
      xpath: typeof args.xpath === 'string' ? String(args.xpath) : undefined,
      text: text || undefined,
      textMatch,
      testId: args.testId ? String(args.testId) : undefined,
      alt: args.alt ? String(args.alt) : undefined,
      role: args.role ? String(args.role) : undefined,
      name: args.name ? String(args.name) : undefined,
      nameMatch: args.nameMatch === 'exact' ? 'exact' : 'contains',
      within: args.within ? String(args.within) : undefined,
      index: args.index === undefined ? undefined : Number(args.index)
    }, frame || undefined)
    if (!hit) throw new Error(mt('main.tc.noTarget'))
    await hoverHit(tabRef, hit, viaOf(args.via))
    return { tabId: tabRef.id, text: hit.label }
  }
  if (frame) {
    if (text) {
      const hit = await hoverTextInFrame(tabRef, frame, text, textMatch, viaOf(args.via))
      return { tabId: tabRef.id, text: hit.label }
    }
    const located = locatorFrom(args)
    if (!located) throw new Error(mt('main.tc.frameClick'))
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
  if (!located) throw new Error(mt('main.tc.needTargetText'))
  await hoverLocator(tabRef, located, viaOf(args.via))
  return { tabId: tabRef.id }
})

tool('page_screenshot', 'Look at the page: viewport, one element, or a region, with a coordinate grid by default so you can click by the printed ticks. Does not change who controls the browser.', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional().describe('Left edge of the region in viewport CSS pixels'),
  y: z.union([z.number(), z.string()]).optional().describe('Top edge of the region in viewport CSS pixels'),
  width: z.union([z.number(), z.string()]).optional().describe('Region width in viewport CSS pixels'),
  height: z.union([z.number(), z.string()]).optional().describe('Region height in viewport CSS pixels'),
  grid: z.union([z.boolean(), z.number()]).optional().describe('Grid spacing, default 100; false or 0 turns it off. Ticks are absolute viewport coordinates; a cropped element screenshot prints its origin in the corner (for example (424, 261)), so use the ticks directly as page_click x and y without adding offsets. Line color follows the background of each 32px block'),
  edgeOnly: z.boolean().optional().describe('Draw ticks on the edges only; useful when content is dense')
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

tool('page_overlay', 'List overlays covering the page (ad iframes, full-screen masks, popups) with their rects. action dismiss hides common ad iframes and clicks common close buttons. It never removes page content; list first when unsure.', z.object({
  ...pageArgs,
  action: z.enum(['list', 'dismiss']).optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  if (args.action === 'dismiss') return { tabId: tabRef.id, ...(await dismissOverlays(tabRef)) }
  return { tabId: tabRef.id, overlays: await listOverlays(tabRef) }
})

tool('page_console', 'Read console output and JS errors for this tab (last 300, newest first). Uncaught errors and promise rejections include stacks. Check this first when clicks do nothing or a script seems ignored. action clear empties it.', z.object({
  tabId: z.string(),
  action: z.enum(['list', 'clear']).optional(),
  limit: z.number().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const wc = tabRef.view?.webContents
  if (!wc) throw new Error(mt('main.page.noPage'))
  if (args.action === 'clear') {
    clearConsole(wc)
    return { tabId: tabRef.id, cleared: true }
  }
  const limit = Math.max(1, Math.min(300, Number(args.limit ?? 100)))
  return { tabId: tabRef.id, messages: consoleFor(wc).slice(0, limit) }
})

tool('page_find', 'Find text in the page like Ctrl+F. Pass text to start, findNext for the next match, stop to clear the highlight. Returns total matches and the current index.', z.object({
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
  if (!text) throw new Error(mt('main.tc.needText'))
  const result = await findInPage(tabRef, text, { forward: args.forward !== false, findNext: Boolean(args.findNext) })
  return { tabId: tabRef.id, ...result }
})

tool('page_wait_load', 'Wait until the page finishes loading (did-stop-loading). timeout seconds default 15, max 60. Throws when loading fails. More reliable than sleeping after navigation or a link click.', z.object({
  tabId: z.string(),
  timeout: z.number().optional()
}), async (args) => {
  const { tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  const wc = tabRef.view?.webContents
  if (!wc) throw new Error(mt('main.page.noPage'))
  const seconds = Math.max(1, Math.min(60, Number(args.timeout ?? 15)))
  const started = Date.now()
  await waitForLoad(wc, seconds * 1000)
  return { tabId: tabRef.id, url: wc.getURL(), elapsed: Date.now() - started }
})

tool('screen', 'Window recording. action start records this headed window (it comes to the front; the only tool that does), maxSeconds default 300 up to 3600, one recording per window. action stop writes an mp4 into the download directory and returns path, seconds and bytes. action status reports recording state, start time and elapsed seconds.', z.object({
  env: env,
  action: z.enum(['start', 'stop', 'status']),
  maxSeconds: z.number().optional()
}), async (args) => {
  const action = String(args.action)
  const envId = String(args.env || DEFAULT_ENV)
  if (action === 'stop') return stopScreen(envId)
  if (action === 'status') {
    const runtime = windows.get(envId)
    const started = runtime?.screenStartedAt
    return {
      env: envId,
      recording: Boolean(runtime?.screenRecording),
      startedAt: started ?? null,
      seconds: started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0
    }
  }

  const runtime = openEnvironment(envId, false)
  if (runtime.headless) throw new Error(mt('main.tc.recordHeadless'))
  if (runtime.screenRecording) throw new Error(mt('main.tc.recordBusy'))
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
        reject(new Error(mt('main.screen.notStarted')))
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

tool('window_preview', 'Composite screenshot of the app shell, page, overlays and popups for GUI automation. Full window by default; x, y, width and height crop the app content area. For clicking inside web pages keep using page_screenshot viewport coordinates.', z.object({
  env: env,
  grid: z.union([z.boolean(), z.number()]).optional().describe('Grid spacing, default 100; false or 0 turns it off. The origin is the app content area top-left, excluding the system title bar; cropped previews still use absolute content-area coordinates'),
  x: z.union([z.number(), z.string()]).optional().describe('Crop origin x in app content CSS pixels'),
  y: z.union([z.number(), z.string()]).optional().describe('Crop origin y in app content CSS pixels'),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  edgeOnly: z.boolean().optional().describe('Draw ticks on the edges only; useful when content is dense')
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
  if (!runtime?.screenRecording) throw new Error(mt('main.tc.recordIdle'))
  const started = runtime.screenStartedAt ?? Date.now()
  const path = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      screenWaiters.delete(envId)
      reject(new Error(mt('main.tc.recordNotDone')))
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

tool('page_source', 'Read page source. dom is the live document, response is the original HTML of this navigation.', z.object({
  ...pageArgs, kind: z.enum(['dom', 'response']).optional()
}), async (args) => {
  const tabRef = await pageTab(args, false)
  const kind = (args.kind as 'dom' | 'response') || 'dom'
  const html = await pageSource(tabRef, kind)
  return { tabId: tabRef.id, kind, html }
})

tool('page_script', 'Run JavaScript in the page and return its value. Use it to read data or do something no dedicated tool covers. frame takes a fragment of the frame URL (for example graph.qq.com) and runs inside that iframe, cross-origin included.', z.object({
  ...pageArgs, source: z.string(), frame: z.string().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const frame = typeof args.frame === 'string' && args.frame ? args.frame : undefined
  try {
    const value = frame ? await evalInFrame(tabRef, String(args.source), frame) : await evalSource(tabRef, String(args.source))
    return { tabId: tabRef.id, value }
  } catch (error) {
    // 脚本挂掉时顺手把页面最近的报错带上，省一次 page_console
    const message = error instanceof Error ? error.message : String(error)
    const wc = tabRef.view?.webContents
    const recent = wc ? consoleFor(wc).filter((item) => item.level === 'error').slice(0, 2) : []
    const extra = recent.length
      ? mt('main.tc.recentErrors', { list: recent.map((item) => String(item.message).split('\n')[0].slice(0, 160)).join(' | ') })
      : ''
    throw new Error(message + extra)
  }
})

tool('page_cdp_batch', 'Run CDP commands in order on one debugger session without reconnecting. commands is an array of method, params and delay; delay is seconds to wait after each command, max 5. Pass a one-element array for a single command.', z.object({
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

tool('captcha_panel', 'Screenshot just the captcha area and return path, pixel size, viewport CSS rect and scale. The agent reads the image, works out click points or drag distance, converts through mapping and acts with page_click or page_drag. Works for any captcha type and is the fallback when captcha_solve cannot recognise it.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  const panel = await captchaPanelShot(tabRef)
  return { tabId: tabRef.id, ...panel }
})

tool('captcha_detect', 'Detect the captcha target. Currently geetest-slide (Geetest v4 slider); type auto detects it. Returns distance (drag distance in viewport CSS pixels), knob center, engine and confidence. mark true saves the gap drawn on the background image. engine picks cv (built-in, no dependencies, best on Geetest), ddddocr (local Python), onnx (models/geetest-slide.onnx) or auto.', z.object({
  ...pageArgs,
  type: z.string().default('auto'),
  engine: z.enum(['auto', 'ddddocr', 'onnx', 'cv']).default('auto'),
  mark: z.boolean().optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const target = await detectCaptcha(tabRef, String(args.type || 'auto'), Boolean(args.mark), args.engine as 'auto' | 'ddddocr' | 'onnx' | 'cv')
  return { tabId: tabRef.id, ...target }
})

tool('captcha_read', 'OCR a captcha area with ddddocr and return text plus the image path. Works for alphanumeric captchas. Requires local Python with ddddocr installed.', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args)
  const result = await captchaRead(tabRef)
  return { tabId: tabRef.id, ...result }
})

tool('captcha_solve', 'Recognise and drag a slider captcha in one call: detect, human-like drag, verify. retries (default 2) re-detects after the captcha refreshes. engine is cv, ddddocr, onnx or auto. Returns solved, attempts and the distance of each try.', z.object({
  ...pageArgs,
  type: z.string().default('auto'),
  engine: z.enum(['auto', 'ddddocr', 'onnx', 'cv']).default('auto'),
  retries: z.number().optional(),
  via: z.enum(['cdp', 'native', 'pointer']).optional()
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

const recordingCall = z.object({
  action: z.enum(['start', 'stop']),
  name: z.string().optional(),
  description: z.string().optional()
})

tool('workflow_record', 'Record the next tool calls into a workflow. action start begins, action stop ends; with name it is saved (overwriting a same-name workflow), otherwise the graph is returned. Recordable: navigate, click (text, role plus name, xpath or selector, or x and y), type (xpath or selector), key, scroll, select, upload, draw (selector plus SVG path), wait. Calls located by ref or by label cannot be recorded and appear in skipped with the reason.', recordingCall, async (args) => {
  if (String(args.action) === 'start') {
    recording = { startedAt: Date.now(), calls: [] }
    return { recording: true, startedAt: recording.startedAt }
  }
  if (!recording) throw new Error(mt('main.tc.notRecording'))
  const calls = recording.calls
  recording = null
  const nodes: WorkflowNode[] = [{ id: 'start', data: { type: 'start', title: mt('workflow.node.start'), variables: [] } }]
  const skipped: Array<{ tool: string; reason: string }> = []
  for (const call of calls) {
    const mapped = recordedNode(call, nodes.length - 1)
    if (mapped.node) nodes.push(mapped.node)
    else skipped.push({ tool: call.tool, reason: mapped.skip || mt('main.tc.untranslatable') })
  }
  nodes.push({ id: 'end', data: { type: 'end', title: mt('workflow.node.end'), outputs: [] } })
  const edges = nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index + 1}`, source: node.id, target: nodes[index + 1].id }))
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  let saved: { workflow: string; name: string } | undefined
  if (name) {
    const app = workflowWrite({
      app: { name, description: args.description ? String(args.description) : mt('main.tc.recordDesc', { count: nodes.length - 2 }), icon: '' },
      workflow: { environment_variables: [], conversation_variables: [], graph: { nodes, edges } }
    })
    saved = { workflow: app.id, name: app.app.name }
  }
  return { calls: calls.length, steps: nodes.length - 2, skipped, ...(saved ? { workflow: saved.workflow, name: saved.name } : { graph: { nodes, edges } }) }
})

tool('workflow_write', 'Create or fully replace a workflow from nodes and edges. script runs in the page, code runs in the main process. Use fill with entry type or paste, and loop for loops. Writing the same name replaces the graph and keeps its id; use workflow_update for partial edits.', workflowBody, async (args) => {
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

tool('workflow_update', 'Patch part of an existing workflow. nodes replace by id and append when new; parent puts a new node inside that loop. removeNodes deletes nodes and their edges. edges replace or append within their level. Untouched nodes and edges stay as they are.', z.object({
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
  if (!key) throw new Error(mt('main.tc.workflowKey'))
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

tool('workflow_list', 'List saved workflows and their parameter names.', z.object({}), async () => ({
  workflows: storage.workflows.map((item) => ({
    id: item.id,
    name: item.app.name,
    remark: item.app.description,
    params: workflowParams(item),
    nodes: item.workflow.graph.nodes.length
  }))
}))

tool('workflow_run', 'Run the whole workflow by name with inputs in one call.', z.object({
  name: z.string().optional(),
  workflow: z.string().optional(),
  inputs: z.record(z.string()).optional(),
  tabId: tab,
  env: env
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error(mt('main.tc.workflowKey'))
  const app = findWorkflow(key)
  const resolved = resolveTab({ tabId: args.tabId ? String(args.tabId) : undefined, env: args.env ? String(args.env) : undefined }, true)
  return runWorkflow(resolved.tab, app, (args.inputs as Record<string, string>) ?? {})
})

tool('workflow_batch', 'Run a workflow once per input row in one environment, one row at a time, up to 3 concurrent.', z.object({
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

tool('workflow_export', 'Export a workflow to a JSON file and return its local path.', z.object({
  name: z.string().optional(),
  workflow: z.string().optional()
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error(mt('main.tc.workflowKey'))
  return { path: exportWorkflow(key) }
})

tool('workflow_delete', 'Delete a saved workflow from this machine. Copies in the market can be installed again.', z.object({
  name: z.string().optional(),
  workflow: z.string().optional()
}), async (args) => {
  const key = String(args.name || args.workflow || '')
  if (!key) throw new Error(mt('main.tc.workflowKey'))
  const removed = deleteWorkflow(key)
  closeWorkflowPages(removed.id)
  bridge.broadcast()
  return removed
})

tool('workflow_import', 'Import a workflow from a local JSON file. Same name overwrites, the id stays.', z.object({
  path: z.string()
}), async (args) => {
  const saved = importWorkflow(String(args.path))
  bridge.broadcast()
  return { workflow: saved.id, name: saved.app.name, nodes: saved.workflow.graph.nodes.length }
})

tool('net_start', 'Start recording HTTP for this tab. Request headers may contain cookies; everything stays local.', z.object({ tabId: z.string() }), async (args) => {
  await netStart(String(args.tabId))
  return { tabId: args.tabId }
})

tool('net_stop', 'Stop recording and detach the debugger.', z.object({ tabId: z.string() }), async (args) => {
  netStop(String(args.tabId))
  return { tabId: args.tabId }
})

tool('net_list', 'List request summaries without bodies.', z.object({ tabId: z.string(), urlContains: z.string().optional() }), async (args) => ({
  requests: netList(String(args.tabId), args.urlContains ? String(args.urlContains) : undefined)
}))

tool('net_get', 'Return one request including its body when still kept. Local only.', z.object({ reqId: z.string() }), async (args) => {
  const item = netGet(String(args.reqId))
  if (!item) throw new Error(mt('main.tc.noRequest', { id: String(args.reqId) }))
  return { request: item }
})

tool('net_export', 'Write this tab records as HAR and return the path.', z.object({ tabId: z.string() }), async (args) => ({
  path: netExport(String(args.tabId), storage.dir('runs'))
}))

tool('net_mock', 'Intercept requests in this tab and answer with fake data for API testing and fault injection. rules holds urlContains plus optional status (200), body (string, {} by default) and headers. Non-matching requests pass through. Turn it off with net_mock_off. Mocking and recording can run together.', z.object({
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

tool('net_mock_off', 'Stop intercepting requests in this tab.', z.object({ tabId: z.string() }), async (args) => {
  await netMockOff(String(args.tabId))
  return { tabId: args.tabId }
})

tool('page_watch', 'Watch an element and return before and after when its text or position changes; on timeout it returns the snapshot taken before. timeout seconds default 30 (max 120), interval seconds default 0.5. Useful for prices, new messages and state flips. pierce searches shadow DOM and iframes.', z.object({
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

tool('connect_info', 'Return the BrowserPilot onboarding prompt: MCP address and token, skill install URL, CLI usage. Handy for wiring another agent. copy true also writes it to the clipboard. The token is local; do not forward it.', z.object({
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

tool('env_export', 'Export cookies for this environment to a JSON file and return the path. localStorage is not included. The file holds live cookies; keep it local.', z.object({ env: z.string() }), async (args) => {
  const id = String(args.env)
  const item = storage.envs.find((envItem) => envItem.id === id)
  if (!item) throw new Error(mt('main.tc.noEnv', { id }))
  const ses = session.fromPartition(`persist:${id}`)
  const cookies = await ses.cookies.get({})
  const path = join(storage.dir('exports'), `env-${id}-${Date.now()}.json`)
  writeFileSync(path, JSON.stringify({ name: item.name, remark: item.remark, exportedAt: Date.now(), cookies }, null, 2))
  return { env: id, path, cookies: cookies.length }
})

tool('env_import', 'Restore logins from a file written by env_export. Without env a new environment is created. Returns the environment id.', z.object({
  path: z.string(),
  env: z.string().optional(),
  name: z.string().optional()
}), async (args) => {
  const raw = JSON.parse(readFileSync(String(args.path), 'utf8')) as { name?: string; cookies: Array<Record<string, unknown>> }
  let id = args.env ? String(args.env) : ''
  if (!id) {
    id = createId('env')
    storage.envs.push({ id, name: String(args.name || raw.name || mt('main.tc.importedEnv')), remark: '', sites: [] })
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

tool('bookmark_list', 'List bookmarks for an environment, newest first. query filters by title or address.', z.object({
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

tool('bookmark_add', 'Add a bookmark to an environment. An existing address gets its title updated instead of a duplicate.', z.object({
  env: env,
  url: z.string(),
  title: z.string().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const url = normalizeUrl(String(args.url))
  if (!/^https?:/i.test(url)) throw new Error(mt('main.tc.bookmarkScheme', { url }))
  const item = storage.addBookmark({ envId, url, title: typeof args.title === 'string' ? args.title : '' })
  bridge.broadcast(envId)
  return { env: envId, id: item.id, url: item.url, title: item.title }
})

tool('bookmark_remove', 'Delete bookmarks: by id or url, or everything when all is true. Returns how many were removed.', z.object({
  env: env,
  id: z.string().optional(),
  url: z.string().optional(),
  all: z.boolean().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  if (!args.id && !args.url && !args.all) throw new Error(mt('main.tc.needIdUrlAll'))
  const removed = storage.removeBookmarkWhere(envId, {
    id: typeof args.id === 'string' ? args.id : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    all: Boolean(args.all)
  })
  if (removed) bridge.broadcast(envId)
  return { env: envId, removed }
})

tool('history_list', 'List history for an environment, newest first. query filters by title or address; limit defaults to 50, max 500.', z.object({
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

tool('history_remove', 'Delete history: by id or url, or everything when all is true. Navigation is recorded automatically.', z.object({
  env: env,
  id: z.string().optional(),
  url: z.string().optional(),
  all: z.boolean().optional()
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  if (!args.id && !args.url && !args.all) throw new Error(mt('main.tc.needIdUrlAll'))
  const removed = storage.removeHistoryWhere(envId, {
    id: typeof args.id === 'string' ? args.id : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    all: Boolean(args.all)
  })
  if (removed) bridge.broadcast(envId)
  return { env: envId, removed }
})

tool('session_list', 'List saved tab sessions (saved when a window closes, restored on reopen). Omit env to list all environments.', z.object({
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

tool('session_save', 'Snapshot the tabs currently open in an environment. Errors when its window is not open.', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(mt('main.tc.windowClosed', { id: envId }))
  saveSessionNow(runtime)
  const saved = storage.sessionFor(envId)
  return { env: envId, tabs: saved?.tabs.length ?? 0, savedAt: saved?.savedAt }
})

tool('session_restore', 'Reopen a saved session as tabs: opens the window if needed, skips tabs already open, at most 20.', z.object({
  env: env
}), async (args) => {
  const envId = dataEnv(args as { env?: string })
  const saved = storage.sessionFor(envId)
  if (!saved?.tabs.length) throw new Error(mt('main.tc.noSession'))
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

tool('session_clear', 'Delete a saved session so the next window for this environment starts empty. Open tabs and history are untouched.', z.object({
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

tool('cookie_list', 'List cookies for this environment, optionally filtered by domain. Values may contain session tokens; keep them local.', z.object({
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

tool('cookie_set', 'Write one cookie into this environment. Without url an address is built from domain. Same name and domain is overwritten.', z.object({
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
  if (!url) throw new Error(mt('main.tc.needUrlDomain'))
  const details: Electron.CookiesSetDetails = { url, name, value, path, secure, httpOnly: Boolean(args.httpOnly) }
  if (typeof args.domain === 'string' && args.domain) details.domain = args.domain
  if (typeof args.expirationDate === 'number') details.expirationDate = args.expirationDate
  await session.fromPartition(`persist:${envId}`).cookies.set(details)
  bridge.broadcast(envId)
  return { env: envId, ok: true }
})

tool('cookie_remove', 'Delete cookies: url plus name for one, domain for all of that domain, or all for the environment. Returns how many were removed.', z.object({
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
  throw new Error(mt('main.tc.needUrlNameAll'))
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
  ['screen', 3700000],
  ['page_save_media', 900000],
  ['page_watch', 150000],
  ['page_wait', 90000],
  ['download', 180000],
  ['captcha_solve', 240000],
  ['workflow_run', 1800000],
  ['workflow_batch', 1800000]
]
for (const [name, ms] of longToolTimeouts) toolTimeouts.set(name, ms)

export async function callTool(name: string, raw: unknown): Promise<ToolResult> {
  const item = tools.find((toolItem) => toolItem.name === name)
  if (!item) return { ok: false, control: 'shared', error: mt('main.tc.noToolName', { name }) }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && item.schema instanceof z.ZodObject) {
    const def = (item.schema as z.ZodObject<z.ZodRawShape>)._def
    if (def.unknownKeys !== 'passthrough') {
      const known = Object.keys((item.schema as z.ZodObject<z.ZodRawShape>).shape)
      const extra = Object.keys(raw as Record<string, unknown>).filter((key) => !known.includes(key))
      if (extra.length) {
        const hint = extra.includes('tab') && known.includes('tabId') ? mt('main.tc.tabParamHint') : ''
        return { ok: false, control: 'shared', error: mt('main.tc.unknownParams', { extra: extra.join(', '), hint, known: known.join(', ') || mt('main.tc.none') }) }
      }
    }
  }
  let args: Record<string, unknown>
  try {
    args = item.schema.parse(raw ?? {}) as Record<string, unknown>
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.') || mt('main.tc.rootPath')}: ${issue.message}`).join('；')
      return { ok: false, control: 'shared', error: mt('main.tc.schemaIssues', { issues }) }
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
        error: mt('main.tc.dialogPending', { type: dialog.type, message: dialog.message.slice(0, 120) })
      }
    }
  }
  try {
    const timeoutMs = toolTimeouts.get(name) ?? DEFAULT_TOOL_TIMEOUT
    const data = await withTimeout(item.run(args), timeoutMs, mt('main.tc.toolTimeout', { name, seconds: Math.round(timeoutMs / 1000) }))
    if (recording && name !== 'workflow_record' && RECORDABLE.has(name)) recording.calls.push({ tool: name, args })
    const tabId = typeof data.tabId === 'string' ? data.tabId : typeof args.tabId === 'string' ? args.tabId : undefined
    const envId = typeof args.env === 'string' ? args.env : undefined
    return finish({ tabId, env: envId }, data)
  } catch (error) {
    const tabId = typeof (raw as { tabId?: string })?.tabId === 'string' ? (raw as { tabId: string }).tabId : undefined
    let errorShot: string | undefined
    if (tabId) {
      try {
        const found = resolveTab({ tabId }, true)
        const shot = await withTimeout(screenshot(found.tab, storage.dir('screenshots')), 8_000, mt('main.tc.shotTimeout'))
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

