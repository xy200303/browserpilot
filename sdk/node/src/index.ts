/**
 * BrowserPilot Node SDK。
 *
 *   import { launch } from 'browserpilot'
 *   const bp = await launch()
 *   const page = await bp.newPage()
 *   await page.goto('https://example.com')
 */
export { launch, connect, findInstalled, BrowserPilot, Environment, DEFAULT_ENV } from './client.js'
export type { LaunchOptions, ConnectOptions } from './client.js'

export { Page } from './page.js'
export type { PageTarget, ClickOptions, ScreenshotOptions, WaitOptions } from './page.js'

export { Locator } from './locator.js'
export type { LocatorSpec } from './locator.js'

export { Transport, readEndpoint } from './transport.js'
export type { Endpoint, CallResult, ImagePart, EventRecord, EventWaitOptions, EventWaitResult } from './transport.js'

export { BrowserPilotError, ToolError, TransportError, InstallError, NotFoundError } from './errors.js'
export type { ToolPayload } from './errors.js'

export { ensureApp, locateApp, assetFor } from './install.js'
export type { AppLocation, AppSource, Asset, DownloadProgress, EnsureOptions } from './install.js'

export { mcpFile, dataHome, appDataRoot, installCandidates } from './paths.js'

export { APP_VERSION, SDK_VERSION } from './version.js'
