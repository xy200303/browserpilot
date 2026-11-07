import { nativeImage, type NativeImage, type WebContents } from 'electron'

export type GridDrawOptions = {
  step: number
  // 网格坐标原点在图片里的位置（CSS 像素）；网页截图为 0，整窗预览是网页在窗口里的偏移
  offsetX?: number
  offsetY?: number
  // 这张图覆盖的 CSS 尺寸，用来把图片像素换算回 CSS 坐标
  spanWidth: number
  spanHeight: number
}

/**
 * 在截好的图片上后置绘制坐标网格。用主界面渲染进程的 canvas 画，
 * 不往被截的页面里注入任何东西，所以不会闪、也不会改页面布局。
 */
export async function drawGrid(wc: WebContents, image: NativeImage, options: GridDrawOptions): Promise<NativeImage> {
  const step = Math.round(Number(options.step) || 0)
  const size = image.getSize()
  if (step < 5 || size.width < 2 || size.height < 2) return image
  const spanWidth = Math.max(1, Number(options.spanWidth) || size.width)
  const spanHeight = Math.max(1, Number(options.spanHeight) || size.height)
  const offsetX = Number(options.offsetX) || 0
  const offsetY = Number(options.offsetY) || 0

  try {
    const dataUrl = image.toDataURL()
    const script = `(async () => {
      const STEP = ${step}
      const OFFX = ${offsetX}
      const OFFY = ${offsetY}
      const SPANW = ${spanWidth}
      const SPANH = ${spanHeight}
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
      const label = (text, x, y) => {
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(255,255,255,0.88)'
        ctx.strokeText(text, x, y)
        ctx.lineWidth = 1
        ctx.fillStyle = 'rgba(185,28,28,0.95)'
        ctx.fillText(text, x, y)
      }
      const labelY = Math.max(0, Math.min(canvas.height - font - 2, OFFY * sy))
      const labelX = Math.max(0, Math.min(canvas.width - font * 4, OFFX * sx))
      ctx.strokeStyle = 'rgba(220,38,38,0.25)'
      ctx.lineWidth = 1
      const firstX = Math.ceil((0 - OFFX) / STEP) * STEP
      for (let gx = firstX; (OFFX + gx) * sx <= canvas.width - 1; gx += STEP) {
        const x = (OFFX + gx) * sx
        if (x < 0) continue
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, canvas.height)
        ctx.stroke()
        label(String(gx), Math.min(canvas.width - font * 3, Math.round(x) + 3), labelY + 1)
      }
      const firstY = Math.ceil((0 - OFFY) / STEP) * STEP
      for (let gy = firstY; (OFFY + gy) * sy <= canvas.height - 1; gy += STEP) {
        const y = (OFFY + gy) * sy
        if (y < 0) continue
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(canvas.width, Math.round(y) + 0.5)
        ctx.stroke()
        label(String(gy), labelX + 2, Math.min(canvas.height - font - 1, Math.round(y) + 2))
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
