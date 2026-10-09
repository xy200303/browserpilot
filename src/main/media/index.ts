import { mkdirSync } from 'fs'
import type { TabRuntime } from '../runtime'
import { inspectElement } from '../page'
import { downloadBegin, downloadDone, downloadFail, downloadProgress } from '../services/DownloadService'
import { audioHandler } from './audio'
import { canvasHandler } from './canvas'
import { imageHandler } from './image'
import { videoHandler } from './video'
import type { ElementInfo } from '../page'
import type { Locator } from '@shared/types'
import type { MediaHandler, MediaProgress, MediaSaved } from './types'

export * from './types'
export { executeMediaPlan } from './video/download'
export { planFromSniff } from './video/generic'
export { resolveMediaPlan } from './video'
export { siteProviders } from './video/providers'
export { sniffNetworkStreams } from './video/network'

// 媒体类型注册表：新增类型时写一个实现 MediaHandler 的文件，加到这里
const handlers: Partial<Record<ElementInfo['kind'], MediaHandler>> = {
  canvas: canvasHandler,
  image: imageHandler,
  video: videoHandler,
  audio: audioHandler
}

export async function saveMediaInfo(tab: TabRuntime, info: ElementInfo, dir: string, savePath: string | undefined, onProgress: MediaProgress): Promise<MediaSaved> {
  mkdirSync(dir, { recursive: true })
  const handler = handlers[info.kind]
  if (!handler) {
    throw new Error(info.kind === 'link' ? `这是链接不是媒体：${info.href}` : `这个元素是 ${info.kind}，没有可保存的媒体`)
  }
  return handler.save(tab, info, dir, savePath, onProgress)
}

export async function saveMedia(tab: TabRuntime, target: { locator?: Locator; point?: { x: number; y: number } }, dir: string, savePath?: string): Promise<MediaSaved> {
  const info = await inspectElement(tab, target)
  const name = (() => {
    if ((info.kind === 'video' || info.kind === 'audio') && tab.title) return `${tab.title.replace(/[\/:*?"<>|]/g, '_').slice(0, 60)}`
    try {
      if (info.src) {
        const base = decodeURIComponent(new URL(info.src).pathname.split('/').pop() || '')
        if (base && !/^[0-9a-f-]{20,}$/i.test(base.replace(/\.[a-z0-9]+$/i, ''))) return base
      }
    } catch { /* blob/data 地址 */ }
    if (tab.title) return `${tab.title.replace(/[\/:*?"<>|]/g, '_').slice(0, 60)}-${info.kind}`
    return `${info.kind}-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  })()
  const dlId = downloadBegin(name, info.src || '')
  try {
    const result = await saveMediaInfo(tab, info, dir, savePath, (received, total) => downloadProgress(dlId, received, total))
    downloadDone(dlId, result.path)
    return result
  } catch (error) {
    downloadFail(dlId, error instanceof Error ? error.message : String(error))
    throw error
  }
}
