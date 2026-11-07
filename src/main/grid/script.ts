export type GridScriptOptions = {
  step: number
  labelStep: number
  originX: number
  originY: number
  spanWidth: number
  spanHeight: number
  showOrigin: boolean
  edgeOnly: boolean
  alpha: number
  block: number
  toneWidth: number
  toneHeight: number
  tone: number[]
  colors: string[]
  dataUrl: string
}

/**
 * 渲染进程里跑的合成脚本：画网格线、刻度数字和起点角标。
 * 线色按 32px 小块从 colors 里取，标签跟随所在块的线色并描边。
 * edgeOnly 时只画四边刻度，不铺满整张图。
 */
export function buildGridScript(options: GridScriptOptions): string {
  const {
    step,
    labelStep,
    originX,
    originY,
    spanWidth,
    spanHeight,
    showOrigin,
    edgeOnly,
    alpha,
    block,
    toneWidth,
    toneHeight,
    tone,
    colors,
    dataUrl
  } = options

  return `(async () => {
  const STEP = ${step}
  const LABEL_STEP = ${labelStep}
  const ORIGIN_X = ${originX}
  const ORIGIN_Y = ${originY}
  const SPAN_W = ${spanWidth}
  const SPAN_H = ${spanHeight}
  const SHOW_ORIGIN = ${showOrigin ? 'true' : 'false'}
  const EDGE_ONLY = ${edgeOnly ? 'true' : 'false'}
  const LINE_ALPHA = ${alpha}
  const BLOCK = ${block}
  const TONE_W = ${toneWidth}
  const TONE_H = ${toneHeight}
  const TONE = ${JSON.stringify(tone)}
  const COLORS = ${JSON.stringify(colors)}
  const CHIP_BG = 'rgba(0,0,0,0.64)'
  const CHIP_FG = 'rgba(255,255,255,0.97)'

  const img = new Image()
  img.src = ${JSON.stringify(dataUrl)}
  await img.decode()

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(img, 0, 0)

  const sx = canvas.width / SPAN_W
  const sy = canvas.height / SPAN_H
  const font = Math.max(9, Math.min(16, Math.round(10 * Math.min(sx, sy))))
  const chipSize = font + 4
  const tick = Math.max(3, Math.round(6 * Math.min(sx, sy)))
  const longTick = tick * 2

  const colorAt = (x, y) => {
    const bx = Math.min(TONE_W - 1, Math.max(0, Math.floor(x / BLOCK)))
    const by = Math.min(TONE_H - 1, Math.max(0, Math.floor(y / BLOCK)))
    return COLORS[TONE[by * TONE_W + bx]] || COLORS[0]
  }

  const label = (text, x, y) => {
    const color = colorAt(x, y)
    const [r, g, b] = color.split(',').map(Number)
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 150
    // 描边打底，必须 save/restore，否则会改掉线条的 strokeStyle
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

  // 竖线固定 x、横线固定 y，另一个方向决定当前段落属于哪一块
  const strokeRun = (vertical, fixed, from, to) => {
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

  // 相邻小块同色时合成一段，纯色页面一条线只 stroke 一次
  const strokeLine = (vertical, fixed) => {
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
  const hitChip = (x, y) => SHOW_ORIGIN && x < chipRect.w + 4 && y < chipRect.h + 4

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

  return canvas.toDataURL('image/png')
})()`
}
