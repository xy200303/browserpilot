import { NotFoundError } from './errors.js'
import { Locator, LocatorSpec, describe } from './locator.js'
import type { Page, PageTarget } from './page.js'

/**
 * iframe 里的定位、读取和等待。
 *
 * App 的定位工具只能按「frame URL 的一段」进 iframe（`page_click` / `page_type` /
 * `page_hover` / `page_script` 有 `frame` 参数），所以 Frame 记住自己的 URL 片段：
 * 点击、输入、悬停把 `frame` 传给工具，由 App 自己算坐标；计数、文本、可见性、
 * 等待用 `page_script` 在这个 frame 里执行，不碰主文档。
 */
export class Frame {
  readonly page: Page
  readonly url: string
  readonly name: string
  readonly selector: string

  constructor(page: Page, url: string, name = '', selector = '') {
    this.page = page
    this.url = url
    this.name = name
    this.selector = selector
  }

  toString(): string {
    return `Frame(${this.url || this.name || this.selector || 'about:blank'})`
  }

  /** iframe 没有 src（srcdoc）时，Electron 给的 frame URL 是 about:srcdoc。 */
  get match(): string {
    return this.url || 'about:srcdoc'
  }

  // ---------- 定位 ----------

  locator(selector: string): Locator {
    return new Locator(this.page, { selector, frame: this.match })
  }

  xpath(xpath: string): Locator {
    return new Locator(this.page, { xpath, frame: this.match })
  }

  getByText(text: string, options: { exact?: boolean } = {}): Locator {
    return new Locator(this.page, {
      text,
      textMatch: options.exact === undefined ? undefined : options.exact ? 'exact' : 'contains',
      frame: this.match
    })
  }

  getByRole(role: string, options: { name?: string; exact?: boolean } = {}): Locator {
    return new Locator(this.page, {
      role,
      name: options.name,
      nameMatch: options.exact === undefined ? undefined : options.exact ? 'exact' : 'contains',
      frame: this.match
    })
  }

  // ---------- 执行 ----------

  async evaluate<T = unknown>(source: string | (() => T)): Promise<T> {
    return this.page.evaluate(source, { frame: this.match })
  }

  // ---------- 读取 ----------

  async count(target: PageTargetLike): Promise<number> {
    const spec = this.page.specOf(target)
    return Number((await this.evaluate<number>(`(${countSource(spec)})`)) ?? 0)
  }

  async textContent(target: PageTargetLike): Promise<string> {
    const spec = this.page.specOf(target)
    return String((await this.evaluate<string>(`(${textSource(spec)})`)) ?? '')
  }

  async isVisible(target: PageTargetLike): Promise<boolean> {
    const spec = this.page.specOf(target)
    return Boolean(await this.evaluate<boolean>(`(${visibleSource(spec)})`))
  }

  // ---------- 等待 ----------

  async waitFor(target: PageTargetLike, options: { state?: 'appear' | 'gone'; timeout?: number; poll?: number } = {}): Promise<void> {
    const spec = this.page.specOf(target)
    const state = options.state ?? 'appear'
    const timeout = options.timeout ?? 10
    const poll = options.poll ?? 0.2
    const countJs = countSource(spec)
    const deadline = Date.now() + timeout * 1000
    for (;;) {
      const present = Number((await this.evaluate<number>(`(${countJs})`)) ?? 0) > 0
      if (present === (state === 'appear')) return
      if (Date.now() > deadline) {
        throw new NotFoundError(
          `等了 ${timeout}s，iframe「${this.match}」里${state === 'gone' ? '还' : '没'}出现 ${describe(spec)}`
        )
      }
      await sleep(poll)
    }
  }

  async waitForFunction<T = unknown>(
    expression: string,
    options: { timeout?: number; poll?: number } = {}
  ): Promise<T> {
    return this.page.waitForFunction<T>(expression, { ...options, frame: this.match })
  }
}

type PageTargetLike = PageTarget

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds * 1000)))
}

function json(value: string): string {
  return JSON.stringify(value)
}

export function firstFrameExpr(spec: LocatorSpec): string {
  if (spec.selector) return `document.querySelector(${json(spec.selector)})`
  if (spec.xpath) {
    return (
      `document.evaluate(${json(spec.xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)` +
      '.singleNodeValue'
    )
  }
  throw new NotFoundError(`frame 内只支持 selector / xpath，收到 ${describe(spec)}`)
}

function countSource(spec: LocatorSpec): string {
  if (spec.selector) return `document.querySelectorAll(${json(spec.selector)}).length`
  if (spec.xpath) {
    return (
      `document.evaluate(${json(spec.xpath)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)` +
      '.snapshotLength'
    )
  }
  throw new NotFoundError(`frame 内只支持 selector / xpath，收到 ${describe(spec)}`)
}

function textSource(spec: LocatorSpec): string {
  const expr = firstFrameExpr(spec)
  return `(() => { const el = ${expr}; return el ? (el.innerText || el.textContent || '') : ''; })()`
}

function visibleSource(spec: LocatorSpec): string {
  const expr = firstFrameExpr(spec)
  return `(() => {
    const el = ${expr};
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return Boolean(rect.width && rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
  })()`
}
