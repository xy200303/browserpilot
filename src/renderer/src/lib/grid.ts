import type { GridRenderOptions } from '../../../shared/grid'

const CHIP_BG = 'rgba(0,0,0,0.64)'
const CHIP_FG = 'rgba(255,255,255,0.97)'

/**
 * 在主窗口里合成网格。图片通过 IPC 以二进制传入，避免 data URL 的 base64 往返。
 * 逻辑和原来 executeJavaScript 里的合成脚本保持一致。
 */
export async function drawGrid(png: Uint8Array, options: GridRenderOptions): Promise<Uint8Array> {
  const bytes = new Uint8Array(png)
  const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return png
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const {
    step: STEP,
    labelStep: LABEL_STEP,
    originX: ORIGIN_X,
    originY: ORIGIN_Y,
    spanWidth: SPAN_W,
    spanHeight: SPAN_H,
    showOrigin: SHOW_ORIGIN,
    edgeOnly: EDGE_ONLY,
    alpha: LINE_ALPHA,
    block: BLOCK,
    toneWidth: TONE_W,
    toneHeight: TONE_H,
    tone: TONE,
    colors: COLORS
  } = options

  const sx = canvas.width / SPAN_W
  const sy = canvas.height / SPAN_H
  const font = Math.max(9, Math.min(16, Math.round(10 * Math.min(sx, sy))))
  const chipSize = font + 4
  const tick = Math.max(3, Math.round(6 * Math.min(sx, sy)))
  const longTick = tick * 2

  const colorAt = (x: number, y: number): string => {
    const bx = Math.min(TONE_W - 1, Math.max(0, Math.floor(x / BLOCK)))
    const by = Math.min(TONE_H - 1, Math.max(0, Math.floor(y / BLOCK)))
    return COLORS[TONE[by * TONE_W + bx]] || COLORS[0]
  }

  const label = (text: string, x: number, y: number): void => {
    const color = colorAt(x, y)
    const [r, g, b] = color.split(',').map(Number)
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 150
    ctx.save()
    ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'top'
    ctx.lineWidth = 3
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.62)'
    ctx.strokeText(text, x, y)
    ctx.lineWidth = 1
    ctx.fillStyle = 'rgba(' + color + ',0.96)'
    ctx.fillText(text, x, y)
    ctx.restore()
  }

  const strokeRun = (vertical: boolean, fixed: number, from: number, to: number): void => {
    const bx = Math.min(TONE_W - 1, Math.max(0, Math.floor((vertical ? fixed : from) / BLOCK)))
    const by = Math.min(TONE_H - 1, Math.max(0, Math.floor((vertical ? from : fixed) / BLOCK)))
    ctx.strokeStyle = 'rgba(' + (COLORS[TONE[by * TONE_W + bx]] || COLORS[0]) + ',' + LINE_ALPHA + ')'
    ctx.beginPath()
    if (vertical) {
      ctx.moveTo(Math.round(fixed) + 0.5, from)
      ctx.lineTo(Math.round(fixed) + 0.5, to)
    } else {
      ctx.moveTo(from, Math.round(fixed) + 0.5)
      ctx.lineTo(to, Math.round(fixed) + 0.5)
    }
    ctx.stroke()
  }

  const strokeLine = (vertical: boolean, fixed: number): void => {
    const total = vertical ? canvas.height : canvas.width
    let at = 0
    while (at < total) {
      const startKey = colorAt(vertical ? fixed : at, vertical ? at : fixed)
      let end = Math.min(total, (Math.floor(at / BLOCK) + 1) * BLOCK)
      while (end < total && colorAt(vertical ? fixed : end, vertical ? end : fixed) === startKey) {
        end = Math.min(total, end + BLOCK)
      }
      strokeRun(vertical, fixed, at, end)
      at = end
    }
  }

  ctx.lineWidth = 1
  const labelEvery = Math.max(1, Math.round(LABEL_STEP / STEP))
  const chipRect = { w: 0, h: chipSize }
  if (SHOW_ORIGIN) {
    const text = '(' + Math.round(ORIGIN_X) + ', ' + Math.round(ORIGIN_Y) + ')'
    ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
    chipRect.w = ctx.measureText(text).width + 4
  }
  const hitChip = (x: number, y: number): boolean => SHOW_ORIGIN && x < chipRect.w + 4 && y < chipRect.h + 4

  for (let index = 0, gx = 0; gx * sx <= canvas.width - 1; gx += STEP, index += 1) {
    const x = gx * sx
    const isLabel = index % labelEvery === 0
    if (EDGE_ONLY) {
      const len = isLabel ? longTick : tick
      strokeRun(true, x, 0, len)
      strokeRun(true, x, canvas.height - len, canvas.height)
    } else {
      strokeLine(true, x)
    }
    if (isLabel) {
      const tx = Math.min(canvas.width - font * 3, Math.round(x) + 3)
      if (!hitChip(tx, 3)) label(String(Math.round(ORIGIN_X + gx)), tx, 3)
    }
  }

  for (let index = 0, gy = 0; gy * sy <= canvas.height - 1; gy += STEP, index += 1) {
    const y = gy * sy
    const isLabel = index % labelEvery === 0
    if (EDGE_ONLY) {
      const len = isLabel ? longTick : tick
      strokeRun(false, y, 0, len)
      strokeRun(false, y, canvas.width - len, canvas.width)
    } else {
      strokeLine(false, y)
    }
    if (isLabel) {
      const ty = Math.min(canvas.height - font - 1, Math.round(y) + 2)
      if (!hitChip(4, ty)) label(String(Math.round(ORIGIN_Y + gy)), 4, ty)
    }
  }

  if (SHOW_ORIGIN) {
    const text = '(' + Math.round(ORIGIN_X) + ', ' + Math.round(ORIGIN_Y) + ')'
    ctx.fillStyle = CHIP_BG
    ctx.fillRect(0, 0, chipRect.w, chipRect.h)
    ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'top'
    ctx.fillStyle = CHIP_FG
    ctx.fillText(text, 2, 2)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : png
}
