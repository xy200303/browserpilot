import { writeFileSync } from 'fs'
import { join } from 'path'
import { evalSource } from '../../page'
import type { MediaHandler } from '../types'

// 画布：toDataURL 导出 PNG（跨域污染的画布导不出来，会说明）
export const canvasHandler: MediaHandler = {
  kind: 'canvas',
  async save(tab, info, dir, savePath) {
    const source = info.rect
      ? `(() => { const el = document.elementFromPoint(${info.rect.x + info.rect.w / 2}, ${info.rect.y + info.rect.h / 2}); const c = el && el.closest ? el.closest('canvas') : null; return c ? c.toDataURL('image/png') : '' })()`
      : ''
    const dataUrl = (await evalSource(tab, source)) as string
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('画布导不出来（可能跨域污染）')
    const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    const path = savePath || join(dir, `canvas-${Date.now()}.png`)
    writeFileSync(path, buf)
    return { path, kind: 'canvas', bytes: buf.length }
  }
}
