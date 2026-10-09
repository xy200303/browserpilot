import type { TabRuntime } from '../../runtime'
import { evalSource, navigate, sleep } from '../../page'
import { downloadDirect } from '../common'
import type { MediaHandler, MediaPlan } from '../types'
import { executeMediaPlan } from './download'
import { attachedVideoUrl, NUDGE_PLAY, performanceStreams, planFromSniff } from './generic'
import { sniffNetworkStreams } from './network'
import { siteProviders } from './providers'

/**
 * 给 blob/空 src 的流媒体视频解析出下载计划。
 * 顺序：平台 provider → 性能条目多轮嗅探 → 催播放 + CDP 网络嗅探 → 重载页面从头抓清单。
 */
export async function resolveMediaPlan(tab: TabRuntime): Promise<MediaPlan | null> {
  for (const provider of siteProviders) {
    if (!provider.match(tab.url)) continue
    const plan = await provider.resolve(tab).catch(() => null)
    if (plan) return plan
  }
  for (let round = 0; round < 10; round += 1) {
    // 流地址往往要播起来才出现在性能条目里，多探几轮
    const plan = planFromSniff(await performanceStreams(tab))
    if (plan) return plan
    const attached = await attachedVideoUrl(tab)
    if (attached) return { kind: 'direct', url: attached }
    if (round >= 2) {
      // 性能条目探不到（可能在 Web Worker 里拉流），先催播放再用 CDP 网络嗅探
      await evalSource(tab, NUDGE_PLAY).catch(() => undefined)
      const plan2 = planFromSniff(await sniffNetworkStreams(tab, 5000).catch(() => null))
      if (plan2) return plan2
    }
    if (round === 8) {
      // HLS 清单只在起播时拉一次，页面开久了性能条目和网络监听都抓不到，重载从头抓
      const sniffing = sniffNetworkStreams(tab, 15000)
      await navigate(tab, tab.url).catch(() => undefined)
      const plan3 = planFromSniff(await sniffing.catch(() => null))
      if (plan3) return plan3
    }
    if (round < 9) await sleep(1500)
  }
  return null
}

export const videoHandler: MediaHandler = {
  kind: 'video',
  async save(tab, info, dir, savePath, onProgress) {
    let src = info.src || ''
    if (!src || src.startsWith('blob:')) {
      const plan = await resolveMediaPlan(tab)
      if (!plan) throw new Error('流媒体视频没有直链也没探到音视频轨或清单（m3u8/mpd）。用 page_record_video 录下正在播放的画面')
      if (plan.kind === 'direct') src = plan.url
      else return executeMediaPlan(tab, plan, dir, savePath, onProgress)
    }
    return downloadDirect(tab, src, 'video', dir, savePath, onProgress)
  }
}
