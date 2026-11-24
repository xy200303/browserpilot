/**
 * SDK 的错误都从这里出去。三个语言保持同样的语义：
 * - ToolError：工具跑了但失败（载荷里 ok:false），带 tool 名和原始载荷
 * - TransportError：连不上、超时、鉴权失败、JSON-RPC 出错
 * - InstallError：找不到也装不上 BrowserPilot
 */
export class BrowserPilotError extends Error {
  readonly code: string

  constructor(message: string, code = 'browserpilot_error', options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined)
    this.name = new.target.name
    this.code = code
  }
}

/** 工具返回的载荷。除 ok/control 外，字段由具体工具决定。 */
export type ToolPayload = {
  ok?: boolean
  control?: 'agent' | 'shared' | 'handoff'
  takenOver?: boolean
  error?: string
  errorShot?: string
  tabId?: string
  env?: string
  [key: string]: unknown
}

export class ToolError extends BrowserPilotError {
  readonly tool: string
  readonly payload: ToolPayload
  /** 失败时 App 顺手拍的那张现场截图，路径在本机。 */
  readonly screenshot?: string

  constructor(tool: string, payload: ToolPayload) {
    super(payload.error ?? `${tool} 失败`, 'tool_error')
    this.tool = tool
    this.payload = payload
    this.screenshot = typeof payload.errorShot === 'string' ? payload.errorShot : undefined
  }
}

export class TransportError extends BrowserPilotError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'transport_error', options)
  }
}

export class InstallError extends BrowserPilotError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'install_error', options)
  }
}

/** 定位器没命中、或命中多个而工具要求唯一。 */
export class NotFoundError extends BrowserPilotError {
  constructor(message: string) {
    super(message, 'not_found')
  }
}
