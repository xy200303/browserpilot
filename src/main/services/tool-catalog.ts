import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { session } from 'electron'
import { rm } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_ENV, type ActVia, type Control, type Locator, type WorkflowApp } from '@shared/types'
import { createId } from '../ids'
import { bridge, publicControl, windows, type TabRuntime } from '../runtime'
import { storage } from './store'
import {
  activateTab,
  addTab,
  applyHeadless,
  beginAgentAction,
  beginHandoff,
  closeTab,
  closeWorkflowPages,
  openEnvironment,
  openSettingsPage,
  resolveTab,
  shareControl,
  showAgentMask
} from '../windows'
import {
  clickDeep,
  clickLocator,
  clickPoint,
  deepQuery,
  dragPage,
  evalInFrame,
  evalSource,
  locatorCenter,
  locatorLabel,
  mapPoint,
  navigate,
  pageSource,
  pasteLocator,
  pressShortcut,
  readTree,
  queryLocator,
  resolveLocator,
  screenshot,
  scrollPage,
  selectLocator,
  sendCdp,
  sendCdpBatch,
  swipePage,
  typeAtPoint,
  typeDeep,
  typeLocator,
  uploadFiles,
  waitForGone,
  waitForLoad,
  waitForLocator
} from '../page'
import { captchaPanelShot, detectCaptcha, solveCaptcha } from '../captcha'
import { deleteWorkflow, exportWorkflow, findWorkflow, importWorkflow, runWorkflow, workflowParams, workflowUpdate, workflowWrite } from './RecordService'
import { netExport, netGet, netList, netStart, netStop } from './NetService'

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

function pointArgs(args: { x?: unknown; y?: unknown; shotWidth?: unknown; shotHeight?: unknown; shotX?: unknown; shotY?: unknown; shotScale?: unknown }): { x: number; y: number; shot?: { width: number; height: number; originX?: number; originY?: number; scale?: number } } | undefined {
  const hasX = args.x != null && args.x !== ''
  const hasY = args.y != null && args.y !== ''
  if (!hasX && !hasY) return undefined
  const x = numArg(args.x)
  const y = numArg(args.y)
  if (x === undefined || y === undefined) throw new Error('画布坐标要同时写 x 和 y')
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

function tool(name: string, description: string, schema: z.ZodTypeAny, run: Tool['run']): void {
  tools.push({ name, description, schema, run })
  if (schema instanceof z.ZodObject) shapes.set(name, schema.shape)
}

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

tool('env_create', '新建一套空环境，并打开一扇有头窗口。', z.object({
  name: z.string(),
  remark: z.string().optional()
}), async (args) => {
  const id = createId('env')
  storage.envs.push({ id, name: String(args.name), remark: String(args.remark ?? ''), sites: [] })
  storage.saveEnvs()
  openEnvironment(id, false)
  return { env: id }
})

tool('env_open', '打开已有环境的窗口。人打开时用有头。批量可传 headless true。', z.object({
  env: z.string(),
  headless: z.boolean().optional()
}), async (args) => {
  const id = String(args.env)
  if (!storage.envs.some((item) => item.id === id)) throw new Error(`没有这套环境 ${id}`)
  const runtime = openEnvironment(id, Boolean(args.headless))
  return { env: id, headless: runtime.headless }
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
  const tabRef = addTab(runtime, String(args.url))
  return { tabId: tabRef.id, env: runtime.envId }
})

tool('tab_close', '按全局编号关掉标签。', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  closeTab(win, tabRef.id)
  return { tabId: tabRef.id }
})

tool('tab_activate', '按全局编号把标签切到前台。', z.object({ tabId: z.string() }), async (args) => {
  const { win, tab: tabRef } = resolveTab({ tabId: String(args.tabId) })
  if (win.headless) applyHeadless(win, false)
  activateTab(win, tabRef.id)
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
    const found = await deepQuery(tabRef, locator)
    return { tabId: tabRef.id, total: found.total, matches: found.matches.map((m, i) => ({ index: i, text: m.text, hittable: m.w > 0 && m.h > 0, rect: { x: m.x, y: m.y, w: m.w, h: m.h } })) }
  }
  const found = await queryLocator(tabRef, locator)
  return { tabId: tabRef.id, total: found.total, matches: found.matches }
})

tool('page_click', '按 XPath 或 CSS 选择器点击，必须恰好匹配一个。XPath 原样交给 DOM.performSearch，选择器原样交给 DOM.querySelectorAll。匹配到多个会失败，不取其中一条。画布这种没有稳定节点的目标改用 x 和 y：不带 shotWidth、shotHeight 时是当前视口的 CSS 像素；带上截图返回的宽高时，x 和 y 是这张图上的像素，会先换算到视口再点。via 默认 cdp：Input.dispatchMouseEvent。native 用 sendInputEvent。inject 在该点的元素上派发指针事件。untilXpath 或 untilSelector 只在按元素点击时使用，表示点完后要出现的元素；没出现会在同一个定位上再点，最多 3 次。失败时带上匹配个数、文字和当时能不能点到。', z.object({
  ...pageArgs,
  ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  untilXpath: z.string().optional(),
  untilSelector: z.string().optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const point = pointArgs(args)
  if (point) {
    await clickPoint(tabRef, point.x, point.y, viaOf(args.via), point.shot)
    return { tabId: tabRef.id }
  }
  const located = locatorFrom(args)
  if (!located) throw new Error('需要 xpath 或 selector，或画布坐标 x 和 y')
  if (located.pierce) {
    await clickDeep(tabRef, located, viaOf(args.via))
    return { tabId: tabRef.id }
  }
  const until = locatorFrom({ xpath: args.untilXpath, selector: args.untilSelector })
  await clickLocator(tabRef, located, viaOf(args.via), until)
  return { tabId: tabRef.id }
})

tool('page_wait', '等元素出现或消失。state 默认 appear（出现），gone 是消失。timeoutMs 默认 10000，最长 60000。导航后、点按钮触发异步渲染后用它等，不要写死 sleep 循环。pierce 为 true 时穿透 Shadow DOM 和同源 iframe 查找。', z.object({
  ...pageArgs, ...locateFields,
  state: z.enum(['appear', 'gone']).default('appear'),
  timeoutMs: z.number().optional()
}), async (args) => {
  const located = locatorFrom(args)
  if (!located) throw new Error(NEED_LOCATOR)
  const tabRef = await pageTab(args)
  const timeout = Math.max(500, Math.min(60_000, Number(args.timeoutMs ?? 10_000)))
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

tool('page_type', '输入文字。via 默认 cdp：先聚焦再逐键输入，非拉丁字符用 Input.insertText。用 xpath 或 selector 指定目标，pierce 为 true 穿透 Shadow DOM 和同源 iframe；也可以用 x、y 坐标（先点击该点聚焦再输入，跨域 iframe 里的输入框用这种方式）。native 先真实点击再逐键输入。inject 直接写入。', z.object({
  ...pageArgs, text: z.string(), ...locateFields,
  x: z.union([z.number(), z.string()]).optional(),
  y: z.union([z.number(), z.string()]).optional(),
  shotWidth: z.union([z.number(), z.string()]).optional(),
  shotHeight: z.union([z.number(), z.string()]).optional(),
  shotX: z.union([z.number(), z.string()]).optional(),
  shotY: z.union([z.number(), z.string()]).optional(),
  shotScale: z.union([z.number(), z.string()]).optional(),
  via: z.enum(['inject', 'native', 'cdp']).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
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
    start = await locatorCenter(tabRef, located)
  }
  const moved = await dragPage(tabRef, gestureVia(args.via), start, Number(args.dx), Number(args.dy))
  return { tabId: tabRef.id, from: moved.from, to: moved.to }
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

tool('page_screenshot', '截取网页视口。返回图片路径和像素宽高，点击坐标按这张图来。不改变当前是谁在操作。', z.object(pageArgs), async (args) => {
  const tabRef = await pageTab(args, false)
  const image = await screenshot(tabRef, storage.dir('screenshots'))
  return { tabId: tabRef.id, path: image.path, width: image.width, height: image.height }
})

tool('screen_start', '开始把这扇有头窗口录成视频。', z.object({ env: env }), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = openEnvironment(envId, false)
  if (runtime.headless) throw new Error('无头窗口没有画面，先有头打开再录')
  if (runtime.screenRecording) throw new Error('这扇窗口已经在录')
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
    bridge.broadcast(envId)
    throw error
  }
  return { env: envId }
})

tool('screen_stop', '停止录屏并写成 mp4，返回本机路径。', z.object({ env: env }), async (args) => {
  const envId = String(args.env || DEFAULT_ENV)
  const runtime = windows.get(envId)
  if (!runtime?.screenRecording) throw new Error('这扇窗口没有在录')
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
  bridge.broadcast(envId)
  return { env: envId, path }
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

tool('page_cdp', '对当前网页调用一条 CDP，用完即断开，除非抓包还开着。要连着发一组命令（比如 press/move/release 的输入序列）用 page_cdp_batch。', z.object({
  ...pageArgs, method: z.string(), params: z.record(z.unknown()).optional()
}), async (args) => {
  const tabRef = await pageTab(args)
  const value = await sendCdp(tabRef, String(args.method), args.params as Record<string, unknown> | undefined)
  return { tabId: tabRef.id, value }
})

tool('page_cdp_batch', '在同一个调试会话里按顺序跑一组 CDP 命令，中间不断开。commands 是数组，每项有 method、params（可选）和 delayMs（这条跑完后等多少毫秒，默认 0，上限 5000）。返回每条命令的结果数组。', z.object({
  ...pageArgs,
  commands: z.array(z.object({
    method: z.string(),
    params: z.record(z.unknown()).optional(),
    delayMs: z.number().optional()
  })).min(1)
}), async (args) => {
  const tabRef = await pageTab(args)
  const results = await sendCdpBatch(tabRef, args.commands as Array<{ method: string; params?: Record<string, unknown>; delayMs?: number }>)
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

export const screenWaiters = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>()
export const screenStartWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

export function listToolMeta(): { name: string; description: string; inputSchema: unknown }[] {
  return tools.map((item) => ({
    name: item.name,
    description: item.description,
    inputSchema: zodToJsonSchema(item.schema)
  }))
}

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
  try {
    const data = await item.run(args)
    const tabId = typeof data.tabId === 'string' ? data.tabId : typeof args.tabId === 'string' ? args.tabId : undefined
    const envId = typeof args.env === 'string' ? args.env : undefined
    return finish({ tabId, env: envId }, data)
  } catch (error) {
    const tabId = typeof (raw as { tabId?: string })?.tabId === 'string' ? (raw as { tabId: string }).tabId : undefined
    return {
      ok: false,
      control: controlOf(tabId, typeof (raw as { env?: string })?.env === 'string' ? (raw as { env: string }).env : undefined),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function openSettings(envId: string): void {
  const runtime = windows.get(envId)
  if (runtime) openSettingsPage(runtime, '环境')
}
