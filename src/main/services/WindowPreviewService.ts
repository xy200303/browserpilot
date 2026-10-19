import { nativeImage, type NativeImage, type WebContents, type WebContentsView } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { Bounds, WindowRuntime } from '../runtime'
import { windows } from '../runtime'
import { layoutWindow } from '../windows'
import { sleep } from '../page'
import { withDebugger } from './debugger'
import { storage } from './store'

type Layer = { name: string; image: NativeImage; rect: Bounds }

function isEmpty(image: NativeImage): boolean {
  return image.isEmpty() || image.getSize().width <= 0 || image.getSize().height <= 0
}

async function cdpShot(wc: WebContents): Promise<NativeImage> {
  const shot = (await withDebugger(wc, (dbg) =>
    dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    })
  )) as { data: string }
  const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
  if (isEmpty(image)) throw new Error('截不到这个图层')
  return image
}

async function captureWebContents(wc: WebContents, preferCdp: boolean): Promise<NativeImage> {
  if (!preferCdp) {
    try {
      const image = await wc.capturePage()
      if (!isEmpty(image)) return image
    } catch {
      /* 被遮挡时 capturePage 会失败，改走合成器 */
    }
  }
  try {
    return await cdpShot(wc)
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
  if (source.length !== sourceWidth * sourceHeight * 4) throw new Error(`图层 ${layer.name} 的像素数据不完整`)

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

  if (active?.kind === 'page' && active.view) {
    layers.push({
      name: 'page',
      image: await captureWebContents(active.view.webContents, false),
      rect: viewRect(active.view)
    })
  }

  const rail = runtime.railView
  if (rail && storage.settings.tabLayout === 'left' && !runtime.headless) {
    const rect = viewRect(rail)
    if (rect.width > 0 && rect.height > 0) {
      layers.push({ name: 'rail', image: await captureWebContents(rail.webContents, false), rect })
    }
  }

  const lock = runtime.lockView
  if (lock && active?.kind === 'page' && active.control === 'agent') {
    layers.push({ name: 'mask', image: await captureWebContents(lock.webContents, true), rect: viewRect(lock) })
  }

  const popup = runtime.popupView
  if (popup && runtime.popupOpen) {
    layers.push({ name: 'popup', image: await captureWebContents(popup.webContents, true), rect: viewRect(popup) })
  }

  return layers
}

export async function windowPreview(envId: string): Promise<{ path: string; width: number; height: number; bytes: number }> {
  const runtime = windows.get(envId)
  if (!runtime) throw new Error('这扇窗口没有打开')
  if (runtime.headless) throw new Error('无头窗口没有画面，先有头打开再预览')

  if (runtime.win.isMinimized()) runtime.win.restore()
  runtime.win.show()
  layoutWindow(envId)
  await sleep(80)

  const base = await captureWebContents(runtime.win.webContents, false)
  const baseSize = base.getSize()
  const [contentWidth, contentHeight] = runtime.win.getContentSize()
  const scaleX = baseSize.width / Math.max(1, contentWidth)
  const scaleY = baseSize.height / Math.max(1, contentHeight)

  const canvas = Buffer.from(base.toBitmap())
  const layers = await collectLayers(runtime)
  for (const layer of layers) blend(canvas, baseSize.width, baseSize.height, layer, scaleX, scaleY)

  const image = nativeImage.createFromBitmap(canvas, { width: baseSize.width, height: baseSize.height, scaleFactor: 1 })
  if (isEmpty(image)) throw new Error('合成预览失败')
  const dir = storage.dir('screenshots')
  const path = join(dir, `preview-${Date.now()}.png`)
  const data = image.toPNG()
  writeFileSync(path, data)
  return {
    path,
    width: image.getSize().width,
    height: image.getSize().height,
    bytes: data.length
  }
}
