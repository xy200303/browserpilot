import { nativeImage, type NativeImage, type WebContents, type WebContentsView } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { Bounds, WindowRuntime } from '../runtime'
import { windows } from '../runtime'
import { layoutWindow } from '../windows'
import { atCssSize, sleep } from '../page'
import { renderGrid } from '../grid'
import { withDebugger } from './debugger'
import { storage } from './store'
import { mt } from '../i18n'

type Layer = { name: string; image: NativeImage; rect: Bounds }

function isEmpty(image: NativeImage): boolean {
  return image.isEmpty() || image.getSize().width <= 0 || image.getSize().height <= 0
}

async function cdpShot(wc: WebContents, size?: { width: number; height: number }): Promise<NativeImage> {
  const shot = (await withDebugger(wc, (dbg) =>
    dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      ...(size && size.width > 0 && size.height > 0
        ? { clip: { x: 0, y: 0, width: Math.round(size.width), height: Math.round(size.height), scale: 1 } }
        : {})
    })
  )) as { data: string }
  const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
  if (isEmpty(image)) throw new Error(mt('main.preview.layerCapture'))
  return image
}

async function captureWebContents(wc: WebContents, preferCdp: boolean, size?: { width: number; height: number }): Promise<NativeImage> {
  if (!preferCdp) {
    try {
      const image = await wc.capturePage()
      if (!isEmpty(image)) return image
    } catch {
      /* 被遮挡时 capturePage 会失败，改走合成器 */
    }
  }
  try {
    return await cdpShot(wc, size)
  } catch (error) {
    if (!preferCdp) throw error
    const image = await wc.capturePage()
    if (isEmpty(image)) throw error
    return image
  }
}

function blend(canvas: Buffer, canvasWidth: number, canvasHeight: number, layer: Layer, scaleX: number, scaleY: number): void {
  const size = layer.image.getSize()
  const source = layer.image.toBitmap()
  const sourceWidth = size.width
  const sourceHeight = size.height
  if (source.length !== sourceWidth * sourceHeight * 4) throw new Error(mt('main.preview.layerPixels', { name: layer.name }))

  const left = Math.round(layer.rect.x * scaleX)
  const top = Math.round(layer.rect.y * scaleY)
  const width = Math.round(layer.rect.width * scaleX)
  const height = Math.round(layer.rect.height * scaleY)
  if (width <= 0 || height <= 0) return

  const startX = Math.max(0, left)
  const startY = Math.max(0, top)
  const endX = Math.min(canvasWidth, left + width)
  const endY = Math.min(canvasHeight, top + height)
  if (startX >= endX || startY >= endY) return

  const stepX = sourceWidth / width
  const stepY = sourceHeight / height

  for (let y = startY; y < endY; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.max(0, Math.floor((y - top + 0.5) * stepY)))
    for (let x = startX; x < endX; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.max(0, Math.floor((x - left + 0.5) * stepX)))
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4
      const canvasIndex = (y * canvasWidth + x) * 4
      const alpha = source[sourceIndex + 3] / 255
      if (alpha <= 0) continue
      if (alpha >= 1) {
        canvas[canvasIndex] = source[sourceIndex]
        canvas[canvasIndex + 1] = source[sourceIndex + 1]
        canvas[canvasIndex + 2] = source[sourceIndex + 2]
        canvas[canvasIndex + 3] = 255
        continue
      }
      canvas[canvasIndex] = Math.round(source[sourceIndex] * alpha + canvas[canvasIndex] * (1 - alpha))
      canvas[canvasIndex + 1] = Math.round(source[sourceIndex + 1] * alpha + canvas[canvasIndex + 1] * (1 - alpha))
      canvas[canvasIndex + 2] = Math.round(source[sourceIndex + 2] * alpha + canvas[canvasIndex + 2] * (1 - alpha))
      canvas[canvasIndex + 3] = 255
    }
  }
}

function viewRect(view: WebContentsView): Bounds {
  return view.getBounds()
}

async function collectLayers(runtime: WindowRuntime): Promise<Layer[]> {
  const layers: Layer[] = []
  const active = runtime.tabs.find((tab) => tab.id === runtime.activeTabId)

  // 视图可能还在、webContents 已经回收（休眠、渲染进程崩溃），这时截图会直接抛
  if (active?.kind === 'page' && active.view && !active.view.webContents.isDestroyed() && !active.error) {
    const rect = viewRect(active.view)
    layers.push({
      name: 'page',
      image: atCssSize(await captureWebContents(active.view.webContents, false), rect.width, rect.height),
      rect
    })
  }

  const rail = runtime.railView
  if (rail && storage.settings.tabLayout === 'left' && !runtime.headless) {
    const rect = viewRect(rail)
    if (rect.width > 0 && rect.height > 0) {
      layers.push({ name: 'rail', image: atCssSize(await captureWebContents(rail.webContents, false), rect.width, rect.height), rect })
    }
  }

  const lock = runtime.lockView
  if (lock && active?.kind === 'page' && active.control === 'agent') {
    const rect = viewRect(lock)
    layers.push({ name: 'mask', image: atCssSize(await captureWebContents(lock.webContents, true), rect.width, rect.height), rect })
  }

  const popup = runtime.popupView
  if (popup && runtime.popupOpen) {
    const rect = viewRect(popup)
    layers.push({ name: 'popup', image: atCssSize(await captureWebContents(popup.webContents, true), rect.width, rect.height), rect })
  }

  return layers
}

export async function windowPreview(
  envId: string,
  grid = 0,
  crop?: { x: number; y: number; width: number; height: number },
  edgeOnly = false
): Promise<{
  path: string
  width: number
  height: number
  bytes: number
  origin: { x: number; y: number }
  coordinateSpace: 'window-content'
}> {
  const runtime = windows.get(envId)
  if (!runtime) throw new Error(mt('main.preview.windowClosed'))
  if (runtime.headless) throw new Error(mt('main.preview.headless'))

  if (runtime.win.isMinimized()) runtime.win.restore()
  runtime.win.show()
  layoutWindow(envId)
  await sleep(80)

  const [contentWidth, contentHeight] = runtime.win.getContentSize()
  const base = atCssSize(await captureWebContents(runtime.win.webContents, false), contentWidth, contentHeight)
  const baseSize = base.getSize()
  const scaleX = baseSize.width / Math.max(1, contentWidth)
  const scaleY = baseSize.height / Math.max(1, contentHeight)

  const canvas = base.toBitmap()
  const layers = await collectLayers(runtime)
  for (const layer of layers) blend(canvas, baseSize.width, baseSize.height, layer, scaleX, scaleY)

  let image = nativeImage.createFromBitmap(canvas, { width: baseSize.width, height: baseSize.height, scaleFactor: 1 })
  if (isEmpty(image)) throw new Error(mt('main.preview.compose'))

  const origin = { x: 0, y: 0 }
  let spanWidth = contentWidth
  let spanHeight = contentHeight
  if (crop) {
    const cx = Math.max(0, Math.min(contentWidth - 1, Math.floor(crop.x)))
    const cy = Math.max(0, Math.min(contentHeight - 1, Math.floor(crop.y)))
    const cw = Math.max(1, Math.min(Math.ceil(crop.width), contentWidth - cx))
    const ch = Math.max(1, Math.min(Math.ceil(crop.height), contentHeight - cy))
    const pixels = {
      x: Math.round(cx * scaleX),
      y: Math.round(cy * scaleY),
      width: Math.max(1, Math.round(cw * scaleX)),
      height: Math.max(1, Math.round(ch * scaleY))
    }
    image = image.crop({
      x: pixels.x,
      y: pixels.y,
      width: Math.min(pixels.width, baseSize.width - pixels.x),
      height: Math.min(pixels.height, baseSize.height - pixels.y)
    })
    origin.x = cx
    origin.y = cy
    spanWidth = cw
    spanHeight = ch
  }

  if (grid > 0) {
    // 应用截图给 GUI 自动化用：坐标原点始终是应用内容区左上角，局部截图也用绝对坐标
    image = await renderGrid(runtime.win.webContents, image, {
      step: grid,
      originX: origin.x,
      originY: origin.y,
      showOrigin: Boolean(crop),
      edgeOnly,
      spanWidth,
      spanHeight,
      jpeg: true
    })
  }
  const dir = storage.dir('screenshots')
  const jpeg = grid > 0
  const path = join(dir, `preview-${Date.now()}.${jpeg ? 'jpg' : 'png'}`)
  const data = jpeg ? image.toJPEG(90) : image.toPNG()
  writeFileSync(path, data)
  return {
    path,
    width: image.getSize().width,
    height: image.getSize().height,
    bytes: data.length,
    origin,
    coordinateSpace: 'window-content'
  }
}
