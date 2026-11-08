import { ipcMain, nativeImage, type NativeImage, type WebContents } from 'electron'
import type { GridRenderRequest } from '@shared/grid'
import { pickLineColor } from './grid/color'

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

const BLOCK = 32

function alphaFor(step: number): number {
  return step >= 50 ? 0.55 : step >= 20 ? 0.4 : 0.32
}

/**
 * 位图可能按设备像素放大（scaleFactor > 1），用它换算真实像素宽高。
 */
function pixelSize(image: NativeImage, data: Buffer): { width: number; height: number } {
  const size = image.getSize()
  const pixels = Math.floor(data.length / 4)
  if (data.length === size.width * size.height * 4) return { width: size.width, height: size.height }
  const scale = Math.sqrt(pixels / Math.max(1, size.width * size.height))
  const width = Math.max(1, Math.round(size.width * scale))
  return { width, height: Math.max(1, Math.floor(pixels / width)) }
}

/**
 * 每 32px 小块按背景算一个线色（OKLCH 色相 + APCA 对比度），
 * 相近颜色合并，返回索引表和颜色表。
 */
function buildLineMap(image: NativeImage): { width: number; height: number; tone: number[]; colors: string[] } {
  const data = image.toBitmap()
  if (data.length < 4) return { width: 0, height: 0, tone: [], colors: ['185,28,28'] }
  const { width: pixelsWide, height: pixelsHigh } = pixelSize(image, data)
  const width = Math.max(1, Math.ceil(pixelsWide / BLOCK))
  const height = Math.max(1, Math.ceil(pixelsHigh / BLOCK))
  const cells = width * height
  const red = new Float32Array(cells)
  const green = new Float32Array(cells)
  const blue = new Float32Array(cells)
  const counts = new Uint32Array(cells)
  const sample = pixelsWide * pixelsHigh > 2_000_000 ? 4 : 2
  for (let y = 0; y < pixelsHigh; y += sample) {
    const row = Math.floor(y / BLOCK) * width
    for (let x = 0; x < pixelsWide; x += sample) {
      const i = (y * pixelsWide + x) * 4
      if (i + 3 >= data.length) continue
      const cell = row + Math.floor(x / BLOCK)
      if (cell >= cells) continue
      blue[cell] += data[i]
      green[cell] += data[i + 1]
      red[cell] += data[i + 2]
      counts[cell] += 1
    }
  }

  const colors: string[] = []
  const lookup = new Map<string, number>()
  const tone: number[] = []
  for (let i = 0; i < cells; i += 1) {
    const n = counts[i] > 0 ? counts[i] : 1
    const line = pickLineColor({ r: red[i] / n, g: green[i] / n, b: blue[i] / n })
    const key = `${line.r >> 2},${line.g >> 2},${line.b >> 2}`
    let index = lookup.get(key)
    if (index === undefined) {
      index = colors.length
      lookup.set(key, index)
      colors.push(`${line.r},${line.g},${line.b}`)
    }
    tone.push(index)
  }
  return { width, height, tone, colors }
}

type PendingGrid = {
  wcId: number
  resolve: (png: Uint8Array) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingGrid = new Map<string, PendingGrid>()
let gridSeq = 0

ipcMain.on('grid:result', (event, payload: { id?: string; png?: Uint8Array }) => {
  if (!payload?.id || !payload.png) return
  const pending = pendingGrid.get(payload.id)
  if (!pending || pending.wcId !== event.sender.id) return
  pendingGrid.delete(payload.id)
  clearTimeout(pending.timer)
  pending.resolve(payload.png)
})

/**
 * 给一张截图叠加坐标网格：每个 32px 小块按背景选色，再在主窗口里用 canvas 合成。
 * 图片以二进制 IPC 传入，避免 PNG → data URL → base64 字符串的多份拷贝。
 * 不往被截的页面里注入任何东西，所以不会闪、也不会改页面布局。
 * 返回新图；取色或绘制失败时返回原图。
 */
export async function renderGrid(wc: WebContents, image: NativeImage, options: GridRenderOptions): Promise<NativeImage> {
  const step = Math.round(Number(options.step) || 0)
  const size = image.getSize()
  if (step < 5 || size.width < 2 || size.height < 2) return image

  const lineMap = buildLineMap(image)
  const png = image.toPNG()
  if (png.length > 16 * 1024 * 1024) return image
  const id = `grid-${++gridSeq}-${Date.now()}`
  const request: GridRenderRequest = {
    id,
    png,
    options: {
      step,
      labelStep: Math.max(step, Math.round(Number(options.labelStep) || 0) || 100),
      originX: Number(options.originX) || 0,
      originY: Number(options.originY) || 0,
      spanWidth: Math.max(1, Number(options.spanWidth) || size.width),
      spanHeight: Math.max(1, Number(options.spanHeight) || size.height),
      showOrigin: Boolean(options.showOrigin),
      edgeOnly: Boolean(options.edgeOnly),
      alpha: alphaFor(step),
      block: BLOCK,
      toneWidth: lineMap.width,
      toneHeight: lineMap.height,
      tone: lineMap.tone,
      colors: lineMap.colors
    }
  }

  const drawn = await new Promise<Uint8Array | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingGrid.delete(id)
      resolve(null)
    }, 10_000)
    pendingGrid.set(id, { wcId: wc.id, resolve, timer })
    try {
      wc.send('grid:render', request)
    } catch {
      pendingGrid.delete(id)
      clearTimeout(timer)
      resolve(null)
    }
  })
  if (!drawn) return image
  const output = nativeImage.createFromBuffer(Buffer.from(drawn))
  return output.isEmpty() ? image : output
}
