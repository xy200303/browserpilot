// 页面侧探测脚本：这些字符串会作为 JS 在目标网页里 eval。
// 注意：正则在模板字符串里，反斜杠必须写成 \\ 才能穿透到页面（否则 \. 会被吃掉、\? 会变成非法正则）。

export const BILIBILI_PLAYINFO = `(() => {
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

export const YOUTUBE_STREAMS = `(() => {
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

// 通用嗅探：从性能条目里认 DASH 双轨（media-video/media-audio）、m3u8/mpd 清单、渐进 mp4。
// 分段 mp4（搜狐式）会按主域名过滤、去重、按加载顺序成列表返回 mp4s。
export const GENERIC_STREAMS = `(() => {
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
export const ATTACHED_VIDEO = `(() => { const vs = [...document.querySelectorAll('video')].filter((v) => v.currentSrc && !v.currentSrc.startsWith('blob:')).sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight)); return vs[0] ? vs[0].currentSrc : '' })()`

export const NUDGE_PLAY = `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => undefined) } })()`
