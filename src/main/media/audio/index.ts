import { downloadDirect } from '../common'
import type { MediaHandler } from '../types'

// 音频：直链 / blob / data 统一直接下载（流媒体清单会在 downloadDirect 里被说明）
export const audioHandler: MediaHandler = {
  kind: 'audio',
  async save(tab, info, dir, savePath, onProgress) {
    const src = info.src || ''
    if (!src) throw new Error('这个音频没有地址')
    return downloadDirect(tab, src, 'audio', dir, savePath, onProgress)
  }
}
