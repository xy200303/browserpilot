import type { TabRuntime } from '../../runtime'
import { evalSource } from '../../page'
import type { MediaPlan, StreamSniff } from '../types'

// 通用性能条目嗅探：认 DASH 双轨（media-video/media-audio）、m3u8/mpd 清单、渐进 mp4。
// 分段 mp4（搜狐式）按主域名过滤、去重、按加载顺序成列表返回 mp4s。
// 页面脚本注意：字符串会 eval 到页面里，正则反斜杠必须写成 \\ 穿透模板字符串。
const GENERIC_STREAMS = `(() => {
  const entries = performance.getEntriesByType('resource')
  const names = entries.map((e) => e.name)
  const pick = (list) => list[list.length - 1] || ''
  const biggest = (list) => list.slice().sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).map((e) => e.name)[0] || ''
  const m3u8 = names.filter((u) => /\\.m3u8(\\?|$)/i.test(u))
  const mpd = names.filter((u) => /\\.mpd(\\?|$)/i.test(u))
  const audioOnly = names.filter((u) => /media-audio|audio-only/i.test(u))
  const videoOnly = entries.filter((e) => /media-video|video-only/i.test(e.name))
  const progressive = entries.filter((e) => (/\\.mp4(\\?|$)/i.test(e.name) || /mime_type=video_mp4/i.test(e.name)) && !/media-audio|media-video|audio-only|video-only/i.test(e.name))
  const hostCount = {}
  for (const e of progressive) { try { const h = new URL(e.name).host; hostCount[h] = (hostCount[h] || 0) + 1 } catch (err) {} }
  let mainHost = ''
  let bestCount = -1
  for (const h in hostCount) { if (hostCount[h] > bestCount) { bestCount = hostCount[h]; mainHost = h } }
  const ofMainHost = progressive.filter((e) => { try { return new URL(e.name).host === mainHost } catch (err) { return false } })
  const seen = new Set()
  const mp4s = []
  for (const e of ofMainHost) { if (!seen.has(e.name)) { seen.add(e.name); mp4s.push(e.name) } }
  return { m3u8: pick(m3u8), mpd: pick(mpd), video: biggest(videoOnly), audio: pick(audioOnly), mp4: biggest(ofMainHost), mp4s: mp4s.slice(0, 100) }
})()`

// 有些站起播后才把直链挂到 video 元素上
const ATTACHED_VIDEO = `(() => { const vs = [...document.querySelectorAll('video')].filter((v) => v.currentSrc && !v.currentSrc.startsWith('blob:')).sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight)); return vs[0] ? vs[0].currentSrc : '' })()`

export const NUDGE_PLAY = `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => undefined) } })()`

export async function performanceStreams(tab: TabRuntime): Promise<StreamSniff | null> {
  return (await evalSource(tab, GENERIC_STREAMS).catch(() => null)) as StreamSniff | null
}

export async function attachedVideoUrl(tab: TabRuntime): Promise<string> {
  return ((await evalSource(tab, ATTACHED_VIDEO).catch(() => '')) as string) || ''
}

export function planFromSniff(g: StreamSniff | null | undefined): MediaPlan | null {
  if (!g) return null
  if (g.video) return { kind: 'dash', video: g.video, audio: g.audio || '' }
  if (g.mp4s && g.mp4s.length > 1) return { kind: 'segments', urls: g.mp4s }
  const manifest = g.m3u8 || g.mpd || ''
  if (manifest) return { kind: 'manifest', url: manifest }
  if (g.mp4) return { kind: 'direct', url: g.mp4 }
  return null
}
