import type { TabRuntime } from '../../runtime'
import { sleep } from '../../page'
import { withDebugger } from '../../services/debugger'
import { wcOf } from '../common'
import type { StreamSniff } from '../types'

/** 腾讯这类播放器在 Web Worker 里拉流，性能条目看不到，用 CDP 网络事件兜底 */
export async function sniffNetworkStreams(tab: TabRuntime, waitMs = 5000): Promise<StreamSniff> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const found: Record<string, string> = { m3u8: '', mpd: '', video: '', audio: '', mp4: '' }
    const onMessage = (_event: unknown, method: string, params: { request?: { url?: string } }): void => {
      if (method !== 'Network.requestWillBeSent') return
      const url = params.request?.url || ''
      const low = url.toLowerCase()
      const base = low.split('?')[0].split('#')[0]
      if (base.endsWith('.m3u8')) found.m3u8 = url
      else if (base.endsWith('.mpd')) found.mpd = url
      else if (low.includes('media-audio') || low.includes('audio-only')) found.audio = url
      else if (low.includes('media-video') || low.includes('video-only')) found.video = url
      else if (!found.mp4 && (base.endsWith('.mp4') || low.includes('mime_type=video_mp4'))) found.mp4 = url
    }
    wc.debugger.on('message', onMessage)
    try {
      await dbg.sendCommand('Network.enable')
      await sleep(waitMs)
    } finally {
      wc.debugger.removeListener('message', onMessage)
    }
    return found
  })
}
