import type { WebContents } from 'electron'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TabRuntime } from '../runtime'
import { downloadUrl, evalSource, fetchToFile } from '../page'
import type { MediaProgress, MediaSaved } from './types'

export function wcOf(tab: TabRuntime): WebContents {
  if (!tab.view) throw new Error('这个标签没有网页')
  return tab.view.webContents
}

export function sniffExt(buf: Buffer): string {
  if (buf.length < 12) return ''
  const head = buf.subarray(0, 12).toString('latin1')
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (head.startsWith('GIF8')) return 'gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp'
  if (head.slice(4, 8) === 'ftyp') return 'mp4'
  if (head.startsWith('OggS')) return 'ogg'
  return ''
}

export function extOf(url: string, contentType: string): string {
  const byType: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3'
  }
  for (const [type, ext] of Object.entries(byType)) {
    if (contentType.includes(type)) return ext
  }
  try {
    const ext = new URL(url).pathname.split('.').pop() || ''
    if (/^[a-z0-9]{2,5}$/i.test(ext)) return ext.toLowerCase()
  } catch {
    /* 不是合法 URL */
  }
  return 'bin'
}

/**
 * 直链下载：blob 走页面内 fetch，data 直接解码，http 先走会话（带 Cookie/Referer/UA），
 * 跨域被拒再退回页面内 fetch 流式落盘。流媒体清单不是单文件，直接说明。
 */
export async function downloadDirect(tab: TabRuntime, src: string, kind: string, dir: string, savePath: string | undefined, onProgress: MediaProgress): Promise<MediaSaved> {
  let buf: Buffer
  let contentType = ''
  if (src.startsWith('blob:')) {
    const base64 = (await evalSource(
      tab,
      `fetch(${JSON.stringify(src)}).then((r) => r.arrayBuffer()).then((b) => { const u = new Uint8Array(b); const parts = []; for (let i = 0; i < u.length; i += 32768) parts.push(String.fromCharCode.apply(null, u.subarray(i, i + 32768))); return btoa(parts.join('')) })`
    )) as string
    buf = Buffer.from(base64, 'base64')
  } else if (src.startsWith('data:')) {
    const comma = src.indexOf(',')
    contentType = src.slice(5, src.indexOf(';'))
    buf = Buffer.from(src.slice(comma + 1), 'base64')
  } else if (/^https?:/.test(src)) {
    if (/\.(m3u8|mpd)(\?|$)/i.test(src)) throw new Error('这是流媒体清单（m3u8/mpd），不是单个文件，下不了')
    try {
      const got = await downloadUrl(wcOf(tab), src, undefined, onProgress)
      buf = got.buf
      contentType = got.contentType
    } catch {
      const tmpPath = join(dir, `dl-${Date.now()}.part`)
      await fetchToFile(tab, src, tmpPath, onProgress)
      buf = readFileSync(tmpPath)
      unlinkSync(tmpPath)
    }
  } else {
    throw new Error(`不认识这种地址：${src.slice(0, 60)}`)
  }
  const ext = sniffExt(buf) || extOf(src, contentType)
  const path = savePath || join(dir, `${kind}-${Date.now()}.${ext}`)
  writeFileSync(path, buf)
  return { path, kind, bytes: buf.length }
}
