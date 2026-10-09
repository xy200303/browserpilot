import { writeFileSync } from 'fs'
import { join } from 'path'
import type { TabRuntime } from '../../runtime'
import { withDebugger } from '../../services/debugger'
import { downloadDirect, wcOf } from '../common'
import type { MediaHandler } from '../types'

async function captureElementPng(tab: TabRuntime, rect: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const wc = wcOf(tab)
  return withDebugger(wc, async (dbg) => {
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 2 }
    })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  })
}

// 图像：直链下载；URL 失效或防盗链时直接截这个元素渲染出来的画面兜底
export const imageHandler: MediaHandler = {
  kind: 'image',
  async save(tab, info, dir, savePath, onProgress) {
    try {
      return await downloadDirect(tab, info.src || '', 'image', dir, savePath, onProgress)
    } catch (first) {
      try {
        const buf = await captureElementPng(tab, info.rect)
        const path = savePath || join(dir, `image-${Date.now()}.png`)
        writeFileSync(path, buf)
        return { path, kind: 'image', bytes: buf.length }
      } catch {
        throw first
      }
    }
  }
}
