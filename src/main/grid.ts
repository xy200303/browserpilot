import { nativeImage, type NativeImage, type WebContents } from 'electron'

export type GridRenderOptions = {
  step: number
  // 数字标注的间隔；默认取 max(step, 100)，细网格只画线不标数字，避免标签互相压住
  labelStep?: number
  // 这张图左上角对应的坐标值：整页/整窗截图是 0，局部截图是裁剪起点在页面里的坐标
  originX?: number
  originY?: number
  // 局部截图固定显示角标（包括 0,0），整页/整窗不显示
  showOrigin?: boolean
  // true 时只画四边的刻度线，不铺满整张图；内容密集的局部截图用这个
  edgeOnly?: boolean
  // 这张图覆盖的 CSS 尺寸，用来把图片像素换算回 CSS 坐标
  spanWidth: number
  spanHeight: number
}

export type GridPalette = {
  name: 'red' | 'blue' | 'light'
  lineRgb: string
  lineAlpha: number
  labelRgba: string
  haloRgba: string
  chipBg: string
  chipFg: string
}

const SAMPLE_TARGET = 4000
const BLOCK = 32
// 1px 细线的可读下限，比正文的 4.5 宽松；深色底上的暗红会在这个值以下，从而换白线
const MIN_LINE_CONTRAST = 3.5

type LineKey = '0' | '1' | '2' | '3'

const LINE_RGB: Record<LineKey, string> = {
  '0': '185,28,28',
  '1': '29,78,216',
  '2': '255,255,255',
  '3': '0,0,0'
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 相对亮度。 */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度，1 表示完全一样，21 是黑白。 */
function contrast(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

const LINE_LUM: Record<LineKey, number> = {
  '0': luminance(185, 28, 28),
  '1': luminance(29, 78, 216),
  '2': 1,
  '3': 0
}

function alphaFor(step: number): number {
  return step >= 50 ? 0.44 : step >= 20 ? 0.34 : 0.28
}

function redPalette(step: number): GridPalette {
  return {
    name: 'red',
    lineRgb: '185,28,28',
    lineAlpha: alphaFor(step),
    labelRgba: 'rgba(185,28,28,0.95)',
    haloRgba: 'rgba(255,255,255,0.88)',
    chipBg: 'rgba(255,255,255,0.86)',
    chipFg: 'rgba(185,28,28,0.95)'
  }
}

function bluePalette(step: number): GridPalette {
  return {
    name: 'blue',
    lineRgb: '29,78,216',
    lineAlpha: alphaFor(step) + 0.06,
    labelRgba: 'rgba(29,78,216,0.96)',
    haloRgba: 'rgba(255,255,255,0.9)',
    chipBg: 'rgba(255,255,255,0.9)',
    chipFg: 'rgba(29,78,216,0.97)'
  }
}

function lightPalette(step: number): GridPalette {
  return {
    name: 'light',
    lineRgb: '255,255,255',
    lineAlpha: alphaFor(step) + 0.11,
    labelRgba: 'rgba(255,255,255,0.96)',
    haloRgba: 'rgba(0,0,0,0.62)',
    chipBg: 'rgba(0,0,0,0.64)',
    chipFg: 'rgba(255,255,255,0.97)'
  }
}

/**
 * 采样整张图的平均颜色。位图是 BGRA，按内存等距抽样，不关心宽高比。
 */
function averageColor(image: NativeImage): { r: number; g: number; b: number } | undefined {
  const data = image.toBitmap()
  const pixels = Math.floor(data.length / 4)
  if (pixels === 0) return undefined
  const stride = Math.max(1, Math.floor(Math.sqrt(pixels / SAMPLE_TARGET)))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let p = 0; p < pixels; p += stride) {
    const i = p * 4
    if (data[i + 3] < 16) continue
    b += data[i]
    g += data[i + 1]
    r += data[i + 2]
    n += 1
  }
  if (n === 0) return undefined
  return { r: r / n, g: g / n, b: b / n }
}

/** 位图可能按设备像素放大（scaleFactor > 1），用它换算真实像素宽高。 */
function pixelSize(image: NativeImage, data: Buffer): { width: number; height: number } {
  const size = image.getSize()
  const pixels = Math.floor(data.length / 4)
  if (data.length === size.width * size.height * 4) return { width: size.width, height: size.height }
  const scale = Math.sqrt(pixels / Math.max(1, size.width * size.height))
  const width = Math.max(1, Math.round(size.width * scale))
  return { width, height: Math.max(1, Math.floor(pixels / width)) }
}

/**
 * 把画面切成 32px 小块并标出该用哪条线色。
 * 先试全局主色；某块背景和主色对比不够时，才在红/蓝/白/黑里挑对比最高的。
 * 这样白底仍然是红线，只有深色图片、深色卡片这些局部会换成白线/黑线。
 */
export function lineToneMap(image: NativeImage, primary: LineKey): { bw: number; bh: number; flags: string } | undefined {
  const data = image.toBitmap()
  if (data.length < 4) return undefined
  const { width, height } = pixelSize(image, data)
  const bw = Math.ceil(width / BLOCK)
  const bh = Math.ceil(height / BLOCK)
  if (bw <= 0 || bh <= 0) return undefined
  const red = new Float32Array(bw * bh)
  const green = new Float32Array(bw * bh)
  const blue = new Float32Array(bw * bh)
  const counts = new Uint32Array(bw * bh)
  for (let y = 0; y < height; y += 4) {
    const row = Math.floor(y / BLOCK) * bw
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4
      if (i + 3 >= data.length) continue
      const cell = row + Math.floor(x / BLOCK)
      if (cell >= bw * bh) continue
      blue[cell] += data[i]
      green[cell] += data[i + 1]
      red[cell] += data[i + 2]
      counts[cell] += 1
    }
  }
  const primaryLum = LINE_LUM[primary]
  let flags = ''
  for (let i = 0; i < counts.length; i += 1) {
    const n = counts[i] > 0 ? counts[i] : 1
    const lum = luminance(red[i] / n, green[i] / n, blue[i] / n)
    if (contrast(lum, primaryLum) >= MIN_LINE_CONTRAST) {
      flags += primary
      continue
    }
    let best: LineKey = primary
    let bestContrast = 0
    for (const key of ['0', '1', '2', '3'] as LineKey[]) {
      const value = contrast(lum, LINE_LUM[key])
      if (value > bestContrast) {
        bestContrast = value
        best = key
      }
    }
    flags += best
  }
  return { bw, bh, flags }
}

function lineColors(step: number): Record<LineKey, { rgb: string; alpha: number }> {
  const base = alphaFor(step)
  return {
    '0': { rgb: LINE_RGB['0'], alpha: base },
    '1': { rgb: LINE_RGB['1'], alpha: base + 0.06 },
    '2': { rgb: LINE_RGB['2'], alpha: base + 0.11 },
    '3': { rgb: LINE_RGB['3'], alpha: base + 0.06 }
  }
}

/**
 * 按背景自动选色：深底用白线，饱和的中低亮底色用白线，
 * 浅红/粉底用蓝线（红线和背景撞色），其余用红线。
 */
export function chooseGridPalette(image: NativeImage, step: number): GridPalette {
  const color = averageColor(image)
  if (!color) return redPalette(step)
  const lum = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  const chroma = (max - min) / 255
  if (lum < 0.42 || (chroma > 0.2 && lum < 0.72)) return lightPalette(step)
  if (color.r > color.g + 18 && color.r > color.b + 18) return bluePalette(step)
  return redPalette(step)
}

/**
 * 给一张截图叠加坐标网格：先按图像内容选配色，再在渲染进程里用 canvas 合成。
 * 不往被截的页面里注入任何东西，所以不会闪、也不会改页面布局。
 * 返回新图；取色或绘制失败时返回原图。
 */
export async function renderGrid(wc: WebContents, image: NativeImage, options: GridRenderOptions): Promise<NativeImage> {
  const step = Math.round(Number(options.step) || 0)
  const size = image.getSize()
  if (step < 5 || size.width < 2 || size.height < 2) return image

  const spanWidth = Math.max(1, Number(options.spanWidth) || size.width)
  const spanHeight = Math.max(1, Number(options.spanHeight) || size.height)
  const originX = Number(options.originX) || 0
  const originY = Number(options.originY) || 0
  const showOrigin = Boolean(options.showOrigin)
  const edgeOnly = Boolean(options.edgeOnly)
  const labelStep = Math.max(step, Math.round(Number(options.labelStep) || 0) || 100)
  const palette = chooseGridPalette(image, step)
  const primary: LineKey = palette.name === 'blue' ? '1' : palette.name === 'light' ? '2' : '0'
  const tone = lineToneMap(image, primary)
  const colors = lineColors(step)

  try {
    const dataUrl = image.toDataURL()
    const script = `(async () => {
      const STEP = ${step}
      const LABEL_STEP = ${labelStep}
      const ORIGIN_X = ${originX}
      const ORIGIN_Y = ${originY}
      const SPANW = ${spanWidth}
      const SPANH = ${spanHeight}
      const CHIP_BG = ${JSON.stringify(palette.chipBg)}
      const CHIP_FG = ${JSON.stringify(palette.chipFg)}
      const BLOCK = ${BLOCK}
      const TONE_W = ${tone?.bw ?? 0}
      const TONE_H = ${tone?.bh ?? 0}
      const TONE = ${JSON.stringify(tone?.flags ?? '')}
      const LINE_COLORS = ${JSON.stringify(colors)}
      const img = new Image()
      img.src = ${JSON.stringify(dataUrl)}
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.drawImage(img, 0, 0)

      const sx = canvas.width / SPANW
      const sy = canvas.height / SPANH
      const font = Math.max(9, Math.min(16, Math.round(10 * Math.min(sx, sy))))
      ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'top'
      const hasChip = ${showOrigin ? 'true' : 'false'}
      const EDGE_ONLY = ${edgeOnly ? 'true' : 'false'}
      const tick = Math.max(3, Math.round(6 * Math.min(sx, sy)))
      const longTick = tick * 2
      // 取所在小块的线色；没有明暗图时退回主色
      const keyAt = (x, y) => {
        if (TONE_W <= 0 || TONE_H <= 0 || !TONE) return ${JSON.stringify(primary)}
        const bx = Math.min(TONE_W - 1, Math.max(0, Math.floor(x / BLOCK)))
        const by = Math.min(TONE_H - 1, Math.max(0, Math.floor(y / BLOCK)))
        return TONE[by * TONE_W + bx] || ${JSON.stringify(primary)}
      }
      const paintSegment = (vertical, fixed, from, to, key) => {
        const color = LINE_COLORS[key] || LINE_COLORS[${JSON.stringify(primary)}]
        ctx.strokeStyle = 'rgba(' + color.rgb + ',' + color.alpha + ')'
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
      const paintRun = (vertical, fixed, from, to) => {
        // 竖线固定 x、横线固定 y；另一个方向决定这段落在哪个小块
        paintSegment(vertical, fixed, from, to, keyAt(vertical ? fixed : from, vertical ? from : fixed))
      }
      // 相邻小块同色时合成一段，纯色页面一条线只 stroke 一次
      const paintLine = (vertical, fixed) => {
        const total = vertical ? canvas.height : canvas.width
        let at = 0
        while (at < total) {
          const key = keyAt(vertical ? fixed : at, vertical ? at : fixed)
          let end = Math.min(total, (Math.floor(at / BLOCK) + 1) * BLOCK)
          while (end < total && keyAt(vertical ? fixed : end, vertical ? end : fixed) === key) {
            end = Math.min(total, end + BLOCK)
          }
          paintSegment(vertical, fixed, at, end, key)
          at = end
        }
      }
      const label = (text, x, y) => {
        // 标签跟着所在小块的线色走，白底上就不会出现白字
        const key = keyAt(x, y)
        const color = LINE_COLORS[key] || LINE_COLORS[${JSON.stringify(primary)}]
        ctx.save()
        ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.textBaseline = 'top'
        ctx.lineWidth = 3
        ctx.strokeStyle = key === '2' ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.9)'
        ctx.strokeText(text, x, y)
        ctx.lineWidth = 1
        ctx.fillStyle = 'rgba(' + color.rgb + ',0.96)'
        ctx.fillText(text, x, y)
        ctx.restore()
      }

      ctx.lineWidth = 1
      // 数字按「第几条线」抽稀，保证标签一定落在线上
      const labelEvery = Math.max(1, Math.round(LABEL_STEP / STEP))
      let indexX = 0
      for (let gx = 0; gx * sx <= canvas.width - 1; gx += STEP) {
        const x = gx * sx
        if (EDGE_ONLY) {
          const len = indexX % labelEvery === 0 ? longTick : tick
          paintRun(true, x, 0, len)
          paintRun(true, x, canvas.height - len, canvas.height)
        } else {
          paintLine(true, x)
        }
        if (indexX % labelEvery === 0 && !(hasChip && gx === 0)) label(String(Math.round(ORIGIN_X + gx)), Math.min(canvas.width - font * 3, Math.round(x) + 3), 3)
        indexX += 1
      }
      let indexY = 0
      for (let gy = 0; gy * sy <= canvas.height - 1; gy += STEP) {
        const y = gy * sy
        if (EDGE_ONLY) {
          const len = indexY % labelEvery === 0 ? longTick : tick
          paintRun(false, y, 0, len)
          paintRun(false, y, canvas.width - len, canvas.width)
        } else {
          paintLine(false, y)
        }
        if (indexY % labelEvery === 0 && !(hasChip && gy === 0)) label(String(Math.round(ORIGIN_Y + gy)), 4, Math.min(canvas.height - font - 1, Math.round(y) + 2))
        indexY += 1
      }
      // 角标最后画，盖在线条和数字上面
      if (hasChip) {
        const chip = '(' + Math.round(ORIGIN_X) + ', ' + Math.round(ORIGIN_Y) + ')'
        const tw = ctx.measureText(chip).width
        ctx.fillStyle = CHIP_BG
        ctx.fillRect(0, 0, tw + 4, font + 4)
        ctx.fillStyle = CHIP_FG
        ctx.fillText(chip, 2, 2)
      }
      return canvas.toDataURL('image/png')
    })()`
    const out = (await wc.executeJavaScript(script, true)) as string
    if (!out || !out.startsWith('data:image/png;base64,')) return image
    const drawn = nativeImage.createFromDataURL(out)
    return drawn.isEmpty() ? image : drawn
  } catch {
    return image
  }
}
