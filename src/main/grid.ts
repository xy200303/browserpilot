import { nativeImage, type NativeImage, type WebContents } from 'electron'

export type GridDrawOptions = {
  step: number
  // 数字标注的间隔；默认取 max(step, 100)，细网格只画线不标数字，避免标签互相压住
  labelStep?: number
  // 这张图左上角对应的坐标值：整页/整窗截图是 0，局部截图是裁剪起点在页面里的坐标
  originX?: number
  originY?: number
  // 局部截图固定显示角标（包括 0,0），整页/整窗不显示
  showOrigin?: boolean
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
  const originX = Number(options.originX) || 0
  const originY = Number(options.originY) || 0
  const showOrigin = Boolean(options.showOrigin)
  const labelStep = Math.max(step, Math.round(Number(options.labelStep) || 0) || 100)

  try {
    const dataUrl = image.toDataURL()
    const script = `(async () => {
      const STEP = ${step}
      const LABEL_STEP = ${labelStep}
      const ORIGIN_X = ${originX}
      const ORIGIN_Y = ${originY}
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

      // 按背景色选网格配色：深底用白线，浅红/粉底用蓝线，其余用红线
      let LINE_RGB = '185,28,28'
      let LINE_ALPHA = STEP >= 50 ? 0.44 : STEP >= 20 ? 0.34 : 0.28
      let LABEL_RGBA = 'rgba(185,28,28,0.95)'
      let HALO_RGBA = 'rgba(255,255,255,0.88)'
      let CHIP_BG = 'rgba(255,255,255,0.86)'
      let CHIP_FG = 'rgba(185,28,28,0.95)'
      try {
        let sr = 0, sg = 0, sb = 0, n = 0
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const stride = Math.max(1, Math.floor(Math.sqrt((canvas.width * canvas.height) / 4000)))
        for (let py = 0; py < canvas.height; py += stride) {
          for (let px = 0; px < canvas.width; px += stride) {
            const i = (py * canvas.width + px) * 4
            if (pixels[i + 3] < 16) continue
            sr += pixels[i]
            sg += pixels[i + 1]
            sb += pixels[i + 2]
            n += 1
          }
        }
        if (n === 0) n = 1
        const mr = sr / n
        const mg = sg / n
        const mb = sb / n
        const lum = (0.2126 * mr + 0.7152 * mg + 0.0722 * mb) / 255
        const chroma = (Math.max(mr, mg, mb) - Math.min(mr, mg, mb)) / 255
        if (lum < 0.42 || (chroma > 0.2 && lum < 0.72)) {
          LINE_RGB = '255,255,255'
          LINE_ALPHA = STEP >= 50 ? 0.55 : STEP >= 20 ? 0.45 : 0.36
          LABEL_RGBA = 'rgba(255,255,255,0.96)'
          HALO_RGBA = 'rgba(0,0,0,0.62)'
          CHIP_BG = 'rgba(0,0,0,0.64)'
          CHIP_FG = 'rgba(255,255,255,0.97)'
        } else if (mr > mg + 18 && mr > mb + 18) {
          LINE_RGB = '29,78,216'
          LINE_ALPHA = STEP >= 50 ? 0.5 : STEP >= 20 ? 0.4 : 0.32
          LABEL_RGBA = 'rgba(29,78,216,0.96)'
          HALO_RGBA = 'rgba(255,255,255,0.9)'
          CHIP_BG = 'rgba(255,255,255,0.9)'
          CHIP_FG = 'rgba(29,78,216,0.97)'
        }
      } catch {
        // 读不到像素就保持默认红线
      }

      const sx = canvas.width / SPANW
      const sy = canvas.height / SPANH
      const font = Math.max(9, Math.min(16, Math.round(10 * Math.min(sx, sy))))
      ctx.font = font + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'top'
      const hasChip = ${showOrigin ? 'true' : 'false'}
      const label = (text, x, y) => {
        ctx.lineWidth = 3
        ctx.strokeStyle = HALO_RGBA
        ctx.strokeText(text, x, y)
        ctx.lineWidth = 1
        ctx.fillStyle = LABEL_RGBA
        ctx.fillText(text, x, y)
      }
      if (hasChip) {
        const chip = Math.round(ORIGIN_X) + ',' + Math.round(ORIGIN_Y)
        const tw = ctx.measureText(chip).width
        ctx.fillStyle = CHIP_BG
        ctx.fillRect(0, 0, tw + 4, font + 4)
        ctx.fillStyle = CHIP_FG
        ctx.fillText(chip, 2, 2)
      }
      const labelY = 2
      const labelX = 2
      ctx.strokeStyle = 'rgba(' + LINE_RGB + ',' + LINE_ALPHA + ')'
      ctx.lineWidth = 1
      // 数字按「第几条线」抽稀，保证标签一定落在线上
      const labelEvery = Math.max(1, Math.round(LABEL_STEP / STEP))
      let indexX = 0
      for (let gx = 0; gx * sx <= canvas.width - 1; gx += STEP) {
        const x = gx * sx
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, canvas.height)
        ctx.stroke()
        if (indexX % labelEvery === 0 && !(hasChip && gx === 0)) label(String(Math.round(ORIGIN_X + gx)), Math.min(canvas.width - font * 3, Math.round(x) + 3), labelY + 1)
        indexX += 1
      }
      let indexY = 0
      for (let gy = 0; gy * sy <= canvas.height - 1; gy += STEP) {
        const y = gy * sy
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(canvas.width, Math.round(y) + 0.5)
        ctx.stroke()
        if (indexY % labelEvery === 0 && !(hasChip && gy === 0)) label(String(Math.round(ORIGIN_Y + gy)), labelX + 2, Math.min(canvas.height - font - 1, Math.round(y) + 2))
        indexY += 1
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
