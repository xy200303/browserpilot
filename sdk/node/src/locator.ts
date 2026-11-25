import type { Page } from './page.js'

/**
 * 一个定位器最终会变成工具参数。BrowserPilot 的工具不是每个都支持全部定位方式：
 * 点击支持 text / role+name / xpath / selector，输入只支持 label / placeholder / xpath / selector。
 * 所以这里保留「用户想怎么找」，由各个动作自己决定能不能表达。
 */
export type LocatorSpec = {
  role?: string
  name?: string
  nameMatch?: 'exact' | 'contains'
  text?: string
  textMatch?: 'exact' | 'contains'
  /** 关联的 label 或 placeholder。 */
  label?: string
  placeholder?: string
  testId?: string
  alt?: string
  selector?: string
  xpath?: string
  /** 缩小范围的 CSS 容器，支持 :has-text()。 */
  within?: string
  /** 多个匹配时取第几个，从 0 开始。 */
  index?: number
  /** 搜索 shadow DOM 和同源 iframe。 */
  pierce?: boolean
  /** 进 iframe 找：填 frame URL 的一段（和 App 的 frame 参数同义）。 */
  frame?: string
}

export function isLocatorSpec(value: unknown): value is LocatorSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys: Array<keyof LocatorSpec> = [
    'role', 'name', 'text', 'label', 'placeholder', 'testId', 'alt', 'selector', 'xpath', 'within', 'pierce', 'index', 'frame'
  ]
  return keys.some((key) => key in (value as Record<string, unknown>))
}

/** 给人看的描述，用在报错里。 */
export function describe(spec: LocatorSpec): string {
  const label = describeBody(spec)
  return spec.frame ? `${label}（frame=${spec.frame}）` : label
}

function describeBody(spec: LocatorSpec): string {
  if (spec.role) return `role=${spec.role}${spec.name ? ` name=${spec.name}` : ''}`
  if (spec.text) return `text=${spec.text}`
  if (spec.label) return `label=${spec.label}`
  if (spec.placeholder) return `placeholder=${spec.placeholder}`
  if (spec.testId) return `testId=${spec.testId}`
  if (spec.alt) return `alt=${spec.alt}`
  if (spec.xpath) return `xpath=${spec.xpath}`
  if (spec.selector) return `selector=${spec.selector}`
  return '空定位器'
}

/** page_click / page_hover 的定位字段。顺序按工具建议：text 优先，然后 role+name。 */
export function actionArgs(spec: LocatorSpec): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (spec.text) {
    args.text = spec.text
    if (spec.textMatch) args.textMatch = spec.textMatch
  } else if (spec.role) {
    args.role = spec.role
    if (spec.name) args.name = spec.name
    if (spec.nameMatch) args.nameMatch = spec.nameMatch
  } else if (spec.selector) {
    args.selector = spec.selector
    if (spec.pierce) args.pierce = true
  } else if (spec.xpath) {
    args.xpath = spec.xpath
    if (spec.pierce) args.pierce = true
  } else if (spec.testId) {
    args.testId = spec.testId
  } else if (spec.alt) {
    args.alt = spec.alt
  }
  if (spec.within) args.within = spec.within
  if (spec.index !== undefined) args.index = spec.index
  if (spec.frame) args.frame = spec.frame
  return args
}

export type TypePlan =
  /** 一次调用搞定：page_type 的 inject 直接写值，就是 Playwright fill 的语义。 */
  | { mode: 'inject'; args: Record<string, unknown> }
  /** 只能聚焦再插入：先清空再写，需要三步。 */
  | { mode: 'focus'; args: Record<string, unknown> }

/**
 * page_type 只认 label / placeholder / xpath / selector。
 * role+name 的输入框通常是文本框，它的可访问名一般就是 label 或 placeholder，退一步用它当 label。
 */
export function typePlan(spec: LocatorSpec, text: string): TypePlan {
  if (spec.selector) {
    return { mode: 'inject', args: { selector: spec.selector, pierce: spec.pierce || undefined, frame: spec.frame || undefined } }
  }
  if (spec.xpath) {
    return { mode: 'inject', args: { xpath: spec.xpath, pierce: spec.pierce || undefined, frame: spec.frame || undefined } }
  }
  if (spec.label) return { mode: 'focus', args: { label: spec.label } }
  if (spec.placeholder) return { mode: 'focus', args: { placeholder: spec.placeholder } }
  if (spec.role === 'textbox' || spec.role === 'searchbox' || spec.role === 'combobox') {
    if (spec.name) return { mode: 'focus', args: { label: spec.name } }
  }
  throw new Error(
    `无法输入 ${describe(spec)}：page_type 只支持 selector、xpath、label、placeholder，` +
      `以及 role=textbox/searchbox/combobox 且带 name 的定位器。`
  )
}

/** page_wait 只认 xpath / selector，而且不支持 frame。返回 null 表示这个定位器得靠轮询。 */
export function waitArgs(spec: LocatorSpec, state: 'appear' | 'gone', timeout?: number): Record<string, unknown> | null {
  if (spec.frame) return null
  const args: Record<string, unknown> = { state }
  if (timeout !== undefined) args.timeout = timeout
  if (spec.selector) return { ...args, selector: spec.selector, pierce: spec.pierce || undefined }
  if (spec.xpath) return { ...args, xpath: spec.xpath, pierce: spec.pierce || undefined }
  return null
}

/** 链式定位器。每个动作都落在当前页面上，页面上唯一匹配才算成功（工具本身就这么要求）。 */
export class Locator {
  readonly page: Page
  readonly spec: LocatorSpec

  constructor(page: Page, spec: LocatorSpec) {
    this.page = page
    this.spec = spec
  }

  /** 多个匹配时取第 index 个，从 0 开始。 */
  nth(index: number): Locator {
    return new Locator(this.page, { ...this.spec, index })
  }

  first(): Locator {
    return this.nth(0)
  }

  /** 在某个容器里找。 */
  within(selector: string): Locator {
    return new Locator(this.page, { ...this.spec, within: selector })
  }

  /** 进 shadow DOM 和同源 iframe 里找。 */
  pierce(): Locator {
    return new Locator(this.page, { ...this.spec, pierce: true })
  }

  click(options: { button?: 'left' | 'right'; count?: number; timeout?: number } = {}): Promise<void> {
    return this.page.click(this.spec, options)
  }

  dblclick(): Promise<void> {
    return this.page.click(this.spec, { count: 2 })
  }

  /** Playwright 语义：覆盖已有内容。selector/xpath 一次调用，其余要三步。 */
  fill(value: string): Promise<void> {
    return this.page.fill(this.spec, value)
  }

  /** 在光标处追加，不清空。 */
  type(value: string): Promise<void> {
    return this.page.type(this.spec, value)
  }

  hover(): Promise<void> {
    return this.page.hover(this.spec)
  }

  selectOption(option: string): Promise<void> {
    return this.page.select(this.spec, option)
  }

  scrollIntoView(): Promise<void> {
    return this.page.scrollTo(this.spec)
  }

  waitFor(options: { state?: 'appear' | 'gone'; timeout?: number } = {}): Promise<void> {
    return this.page.waitFor(this.spec, options)
  }

  count(): Promise<number> {
    return this.page.count(this.spec)
  }

  isVisible(): Promise<boolean> {
    return this.page.isVisible(this.spec)
  }

  textContent(): Promise<string> {
    return this.page.textContent(this.spec)
  }

  screenshot(options: { path?: string; grid?: boolean | number } = {}): Promise<Buffer> {
    return this.page.screenshot({ ...options, target: this.spec })
  }

  toString(): string {
    return `Locator(${describe(this.spec)})`
  }
}
