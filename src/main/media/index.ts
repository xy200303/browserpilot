import type { WebContents } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { TabRuntime } from '../runtime'
import { downloadMedia, evalSource, navigate, sleep } from '../page'
import { withDebugger } from '../services/debugger'
import { runFfmpeg } from '../services/ffmpeg'
import { ATTACHED_VIDEO, BILIBILI_PLAYINFO, GENERIC_STREAMS, NUDGE_PLAY, YOUTUBE_STREAMS } from './probe'

// 统一的流信息结构：各 provider / 嗅探手段都归一到这个形状
export type StreamSniff = { m3u8?: string; mpd?: string; video?: string; audio?: string; mp4?: string; mp4s?: string[] }

// 归一化后的下载计划，由 executeMediaPlan 统一执行
export type MediaPlan =
  | { kind: 'dash'; video: string; audio: string } // 音视频分轨，下载后 ffmpeg 合并
  | { kind: 'segments'; urls: string[] } // 分段 mp4，按顺序下载后 ffmpeg concat
  | { kind: 'manifest'; url: string } // m3u8 / mpd 清单，ffmpeg 拉流转 mp4
  | { kind: 'direct'; url: string } // 渐进直链，调用方走普通下载

export type MediaSaved = { path: string; kind: string; bytes: number }

// 平台 provider：识别特定站点的流地址。新增平台时实现一个 provider 注册进 siteProviders 即可，
// 下载、合并、进度上报全部由本模块统一处理
export interface MediaProvider {
  name: string
  match: (url: string) => boolean
  resolve: (tab: TabRuntime) => Promise<MediaPlan | null>
}

function wcOf(tab: TabRuntime): WebContents {
  if (!tab.view) throw new Error('这个标签没有网页')
  return tab.view.webContents
}

// ─── 平台 provider（扩展点）────────────────────────────────────────────

export const siteProviders: MediaProvider[] = [
  {
    name: 'bilibili',
    match: (url) => url.includes('bilibili.com'),
    resolve: async (tab) => {
      const found = (await evalSource(tab, BILIBILI_PLAYINFO).catch(() => null)) as { video?: string; audio?: string } | null
      return found?.video ? { kind: 'dash', video: found.video, audio: found.audio || '' } : null
    }
  },
  {
    name: 'youtube',
    match: (url) => url.includes('youtube.com') || url.includes('youtu.be'),
    resolve: async (tab) => {
      const found = (await evalSource(tab, YOUTUBE_STREAMS).catch(() => null)) as { video?: string; audio?: string } | null
      return found?.video ? { kind: 'dash', video: found.video, audio: found.audio || '' } : null
    }
  }
]

// ─── 通用嗅探手段 ──────────────────────────────────────────────────────

export function planFromSniff(g: StreamSniff | null | undefined): MediaPlan | null {
  if (!g) return null
  if (g.video) return { kind: 'dash', video: g.video, audio: g.audio || '' }
  if (g.mp4s && g.mp4s.length > 1) return { kind: 'segments', urls: g.mp4s }
  const manifest = g.m3u8 || g.mpd || ''
  if (manifest) return { kind: 'manifest', url: manifest }
  if (g.mp4) return { kind: 'direct', url: g.mp4 }
  return null
}

export async function performanceStreams(tab: TabRuntime): Promise<StreamSniff | null> {
  return (await evalSource(tab, GENERIC_STREAMS).catch(() => null)) as StreamSniff | null
}

export async function sniffNetworkStreams(tab: TabRuntime, waitMs = 5000): Promise<StreamSniff> {
  // 腾讯这类播放器在 Web Worker 里拉流，性能条目看不到，用 CDP 网络事件兜底
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

async function attachedVideoUrl(tab: TabRuntime): Promise<string> {
  return ((await evalSource(tab, ATTACHED_VIDEO).catch(() => '')) as string) || ''
}

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

// ─── 计划执行（下载/合并）──────────────────────────────────────────────

function mergeTracks(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  const args = ['-y', '-i', videoPath]
  if (audioPath) args.push('-i', audioPath)
  args.push('-c', 'copy', outPath)
  return runFfmpeg(args)
}

async function downloadDashPair(tab: TabRuntime, video: string, audio: string, dir: string, savePath: string | undefined, onProgress: (received: number, total?: number) => void): Promise<MediaSaved> {
  const stamp = Date.now()
  const referer = tab.url || undefined
  const videoPath = join(dir, `video-${stamp}-v.m4s`)
  await downloadMedia(tab, video, videoPath, referer, onProgress)
  let audioPath = ''
  if (audio) {
    audioPath = join(dir, `video-${stamp}-a.m4s`)
    await downloadMedia(tab, audio, audioPath, referer, onProgress)
  }
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  try {
    await mergeTracks(videoPath, audioPath, outPath)
    const { unlinkSync, statSync } = await import('fs')
    unlinkSync(videoPath)
    if (audioPath) unlinkSync(audioPath)
    return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
  } catch {
    throw new Error(`没有 ffmpeg 合并音视频轨，两条轨已分别保存：${videoPath}${audioPath ? `、${audioPath}` : ''}`)
  }
}

async function concatMp4Segments(tab: TabRuntime, urls: string[], dir: string, savePath: string | undefined, onProgress: (received: number, total?: number) => void): Promise<MediaSaved> {
  // 搜狐这类站把整片切成多段 mp4，逐段带登录态下载后按播放顺序合并
  const stamp = Date.now()
  const referer = tab.url || undefined
  const segs: string[] = []
  let received = 0
  for (let i = 0; i < urls.length; i += 1) {
    const segPath = join(dir, `segs-${stamp}-${i}.mp4`)
    await downloadMedia(tab, urls[i], segPath, referer, (n) => onProgress(received + n))
    const { statSync } = await import('fs')
    received += statSync(segPath).size
    segs.push(segPath)
  }
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  const listPath = join(dir, `segs-${stamp}.txt`)
  writeFileSync(listPath, segs.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], 10 * 60_000)
    const { statSync, unlinkSync } = await import('fs')
    for (const s of segs) unlinkSync(s)
    unlinkSync(listPath)
    return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
  } catch {
    throw new Error(`分段视频合并失败，${segs.length} 个分段已保存在 ${dir}（segs-${stamp}-*.mp4）`)
  }
}

async function saveManifest(tab: TabRuntime, manifest: string, dir: string, savePath: string | undefined): Promise<MediaSaved> {
  const stamp = Date.now()
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  const referer = tab.url || ''
  const args = ['-y']
  const ua = wcOf(tab).getUserAgent()
  if (ua) args.push('-user_agent', ua)
  if (referer) args.push('-headers', `Referer: ${referer}\r\n`)
  args.push('-i', manifest, '-c', 'copy', outPath)
  await runFfmpeg(args, 10 * 60_000)
  const { statSync } = await import('fs')
  return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
}

/** 执行下载计划。direct 不由这里处理，调用方拿到 url 走普通下载流程。 */
export async function executeMediaPlan(
  tab: TabRuntime,
  plan: Exclude<MediaPlan, { kind: 'direct' }>,
  dir: string,
  savePath: string | undefined,
  onProgress: (received: number, total?: number) => void
): Promise<MediaSaved> {
  if (plan.kind === 'dash') return downloadDashPair(tab, plan.video, plan.audio, dir, savePath, onProgress)
  if (plan.kind === 'segments') return concatMp4Segments(tab, plan.urls, dir, savePath, onProgress)
  return saveManifest(tab, plan.url, dir, savePath)
}
