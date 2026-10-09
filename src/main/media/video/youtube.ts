import type { MediaProvider } from '../types'
import { evalSource } from '../../page'

// 页面脚本注意：字符串会 eval 到页面里，正则反斜杠必须写成 \\ 穿透模板字符串
const YOUTUBE_STREAMS = `(() => {
  const p = window.ytInitialPlayerResponse
  const sd = p && p.streamingData
  if (!sd) return null
  const prog = (sd.formats || []).filter((f) => f.url && (f.mimeType || '').indexOf('mp4') >= 0).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  if (prog[0]) return { video: prog[0].url, audio: '' }
  const ad = (sd.adaptiveFormats || []).filter((f) => f.url && (f.mimeType || '').indexOf('mp4') >= 0)
  const vids = ad.filter((f) => (f.mimeType || '').indexOf('video') === 0).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  const auds = ad.filter((f) => (f.mimeType || '').indexOf('audio') === 0).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  if (!vids[0]) return null
  return { video: vids[0].url, audio: auds[0] ? auds[0].url : '' }
})()`

export const youtubeProvider: MediaProvider = {
  name: 'youtube',
  match: (url) => url.includes('youtube.com') || url.includes('youtu.be'),
  resolve: async (tab) => {
    const found = (await evalSource(tab, YOUTUBE_STREAMS).catch(() => null)) as { video?: string; audio?: string } | null
    return found?.video ? { kind: 'dash', video: found.video, audio: found.audio || '' } : null
  }
}
