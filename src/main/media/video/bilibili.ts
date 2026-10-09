import type { MediaProvider } from '../types'
import { evalSource } from '../../page'

// 页面脚本注意：字符串会 eval 到页面里，正则反斜杠必须写成 \\ 穿透模板字符串
const BILIBILI_PLAYINFO = `(() => {
  const p = window.__playinfo__
  if (!p) return null
  const d = p.data || p
  const dash = d.dash
  if (!dash || !dash.video) return null
  const all = dash.video.slice()
  const avc = all.filter((v) => String(v.codecs || '').startsWith('avc'))
  const vids = (avc.length ? avc : all).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
  const auds = (dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
  const v = vids[0]
  const a = auds[0]
  if (!v || !v.baseUrl) return null
  return { video: v.baseUrl, audio: a ? a.baseUrl : '' }
})()`

export const bilibiliProvider: MediaProvider = {
  name: 'bilibili',
  match: (url) => url.includes('bilibili.com'),
  resolve: async (tab) => {
    const found = (await evalSource(tab, BILIBILI_PLAYINFO).catch(() => null)) as { video?: string; audio?: string } | null
    return found?.video ? { kind: 'dash', video: found.video, audio: found.audio || '' } : null
  }
}
