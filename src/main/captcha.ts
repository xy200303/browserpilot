import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GestureVia } from '@shared/types'
import { dragPage, clickPoint, evalSource, screenshot, sleep } from './page'
import type { TabRuntime } from './runtime'
import { storage } from './services/store'

export type CaptchaEngine = 'ddddocr' | 'onnx' | 'cv'

export type CaptchaTarget = {
  type: 'geetest-slide'
  engine: CaptchaEngine
  knob: { x: number; y: number }
  distance: number
  gapImageX: number
  confidence: { edge: number; scale: number; mse: number }
  markPath?: string
}

export type CaptchaSolveResult = {
  solved: boolean
  attempts: number
  detail: Array<{ distance: number; engine: string; solved: boolean }>
}

let pythonBin: string | null | undefined

function findPython(): Promise<string | null> {
  if (pythonBin !== undefined) return Promise.resolve(pythonBin)
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']
  const probe = (bin: string, args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      execFile(bin, args, (error, stdout) => resolve(!error && String(stdout).trim() === 'ok'))
    })
  return (async () => {
    for (const bin of candidates) {
      const args = bin === 'py' ? ['-3', '-c', 'print("ok")'] : ['-c', 'print("ok")']
      if (await probe(bin, args)) {
        pythonBin = bin
        return bin
      }
    }
    pythonBin = null
    return null
  })()
}

function ddddocrGapX(bgBuf: Buffer, sliceBuf: Buffer): Promise<number | null> {
  return (async () => {
    const bin = await findPython()
    if (!bin) return null
    const script = app.isPackaged
      ? join(process.resourcesPath, 'captcha', 'geetest_slide.py')
      : join(app.getAppPath(), 'resources', 'captcha', 'geetest_slide.py')
    if (!existsSync(script)) return null
    const dir = join(tmpdir(), 'browserpilot-captcha')
    mkdirSync(dir, { recursive: true })
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const bgPath = join(dir, `bg-${stamp}.png`)
    const slicePath = join(dir, `slice-${stamp}.png`)
    writeFileSync(bgPath, bgBuf)
    writeFileSync(slicePath, sliceBuf)
    const args = bin === 'py' ? ['-3', script, bgPath, slicePath] : [script, bgPath, slicePath]
    return new Promise<number | null>((resolve) => {
      execFile(bin, args, { timeout: 30_000 }, (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        try {
          const parsed = JSON.parse(String(stdout).trim()) as { x?: number }
          resolve(typeof parsed.x === 'number' ? parsed.x : null)
        } catch {
          resolve(null)
        }
      })
    })
  })().catch(() => null)
}

type SlideProbe = {
  bg?: string
  slice?: string
  bgRect?: [number, number, number, number]
  sliceRect?: [number, number, number, number]
  btn?: [number, number, number, number]
}

const SLIDE_PROBE = `(() => {
  const out = {}
  document.querySelectorAll('[class*=geetest]').forEach((e) => {
    const c = String(e.className)
    const s = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    const m = s.backgroundImage.match(/url\\("(.+)"\\)/)
    if (/geetest_slice_bg/.test(c) && m) {
      out.slice = m[1]
      out.sliceRect = [r.x, r.y, r.width, r.height]
    }
    if (/geetest_bg_/.test(c) && m) {
      out.bg = m[1]
      out.bgRect = [r.x, r.y, r.width, r.height]
    }
    if (/(^| )geetest_btn_/.test(c) && r.width > 30 && r.width < 120 && r.height > 20 && r.height < 80) {
      out.btn = [r.x, r.y, r.width, r.height]
    }
  })
  return out
})()`

const SLIDE_RESULT = `(() => ({
  success: !!document.querySelector('[class*=geetest_success]')
    || /beat|成功|success/i.test((document.querySelector('[class*=geetest_result_tips]') || {}).textContent || ''),
  panel: !!document.querySelector('[class*=geetest_bg]')
}))()`

const ICON_PROBE = `(() => {
  const out = { icons: [] }
  const ques = document.querySelector('[class*=geetest_ques_tips]')
  if (ques) out.icons = [...ques.querySelectorAll('img')].map((i) => i.src)
  document.querySelectorAll('[class*=geetest]').forEach((e) => {
    const c = String(e.className)
    const s = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    const m = (s.backgroundImage || '').match(/url\\("(.+)"\\)/)
    if (/geetest_bg_/.test(c) && m) {
      out.bg = m[1]
      out.bgRect = [r.x, r.y, r.width, r.height]
    }
    if (/geetest_result_tips/.test(c)) out.okRect = [r.x, r.y, r.width, r.height]
  })
  return out
})()`

type Pixels = { width: number; height: number; data: Buffer }

export type CaptchaPanelShot = {
  path: string
  width: number
  height: number
  rect: [number, number, number, number]
  scale: number
  mapping: string
}

const PANEL_PROBE = `(() => {
  const parts = document.querySelectorAll('[class*=geetest_bg],[class*=geetest_ques_tips],[class*=geetest_text_tips],[class*=geetest_result_tips],[class*=geetest_slider],[class*=geetest_ai_detect],[class*=geetest_submit]')
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  parts.forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 5 || r.height < 5) return
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height)
  })
  const rect = x1 > x0 ? [x0, y0, x1 - x0, y1 - y0] : null
  return { rect, vw: innerWidth, vh: innerHeight }
})()`

export async function captchaPanelShot(tab: TabRuntime): Promise<CaptchaPanelShot> {
  await evalSource(
    tab,
    `(() => { const el = document.querySelector('[class*=geetest_panel],[class*=geetest_box],[class*=geetest_wrap],[class*=geetest_bg]'); if (el) el.scrollIntoView({ block: 'center' }); return true })()`
  )
  await sleep(400)
  const probe = (await evalSource(tab, PANEL_PROBE)) as { rect?: [number, number, number, number]; vw: number; vh: number }
  if (!probe.rect) throw new Error('页面上没有验证码面板，先把验证码点出来再截图')
  const shot = await screenshot(tab, storage.dir('screenshots'))
  const image = nativeImage.createFromPath(shot.path)
  const scaleX = shot.width / probe.vw
  const scaleY = shot.height / probe.vh
  const pad = 6
  const cx = Math.max(0, Math.round(probe.rect[0] * scaleX) - pad)
  const cy = Math.max(0, Math.round(probe.rect[1] * scaleY) - pad)
  const cw = Math.min(shot.width - cx, Math.round(probe.rect[2] * scaleX) + pad * 2)
  const ch = Math.min(shot.height - cy, Math.round(probe.rect[3] * scaleY) + pad * 2)
  const cropped = image.crop({ x: cx, y: cy, width: cw, height: ch })
  const path = join(storage.dir('screenshots'), `panel-${Date.now()}.png`)
  writeFileSync(path, cropped.toPNG())
  const rect: [number, number, number, number] = [cx / scaleX, cy / scaleY, cw / scaleX, ch / scaleY]
  const size = cropped.getSize()
  return {
    path,
    width: size.width,
    height: size.height,
    rect,
    scale: scaleX,
    mapping: '图片上像素 (px, py) 直接用 page_click 或 page_drag 的 x、y，并带上 shotWidth、shotHeight（本图的 width、height）和 shotX、shotY（rect 的前两个值）、shotScale（scale），工具会自己换算成视口坐标'
  }
}

function decodePng(buf: Buffer): Pixels {
  const image = nativeImage.createFromBuffer(buf)
  const size = image.getSize()
  if (!size.width || !size.height) throw new Error('验证码图片解不出来')
  return { width: size.width, height: size.height, data: image.toBitmap() }
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`验证码图片拉不下来 ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function grayOf(img: Pixels): Float32Array {
  const out = new Float32Array(img.width * img.height)
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4
    out[i] = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3
  }
  return out
}

function gradOf(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      out[i] = Math.hypot((gray[i + 1] - gray[i - 1]) / 2, (gray[i + width] - gray[i - width]) / 2)
    }
  }
  return out
}

type Mask = { px0: number; py0: number; w: number; h: number; solid: number[]; edge: number[] }

function pieceMask(slice: Pixels): Mask {
  const { width, height, data } = slice
  let px0 = width
  let py0 = height
  let px1 = 0
  let py1 = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 128) {
        if (x < px0) px0 = x
        if (y < py0) py0 = y
        if (x > px1) px1 = x
        if (y > py1) py1 = y
      }
    }
  }
  if (px1 <= px0 || py1 <= py0) throw new Error('拼图片里没有不透明区域')
  const w = px1 - px0 + 1
  const h = py1 - py0 + 1
  const at = (x: number, y: number): boolean => data[((py0 + y) * width + px0 + x) * 4 + 3] > 128
  const solid: number[] = []
  const edge: number[] = []
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!at(x, y)) continue
      const i = y * w + x
      solid.push(i)
      const inner = x > 0 && y > 0 && x < w - 1 && y < h - 1 && at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)
      if (!inner) edge.push(i)
    }
  }
  return { px0, py0, w, h, solid, edge }
}

function fitScale(bg: Pixels, slice: Pixels, mask: Mask, x: number, y: number): { s: number; mse: number } {
  let dot = 0
  let bb = 0
  for (const i of mask.solid) {
    const sx = mask.px0 + (i % mask.w)
    const sy = mask.py0 + Math.floor(i / mask.w)
    const so = (sy * slice.width + sx) * 4
    const bo = ((y + Math.floor(i / mask.w)) * bg.width + x + (i % mask.w)) * 4
    for (let c = 0; c < 3; c += 1) {
      dot += slice.data[so + c] * bg.data[bo + c]
      bb += bg.data[bo + c] * bg.data[bo + c]
    }
  }
  if (!bb) return { s: 0, mse: Number.MAX_VALUE }
  const s = dot / bb
  let mse = 0
  for (const i of mask.solid) {
    const sx = mask.px0 + (i % mask.w)
    const sy = mask.py0 + Math.floor(i / mask.w)
    const so = (sy * slice.width + sx) * 4
    const bo = ((y + Math.floor(i / mask.w)) * bg.width + x + (i % mask.w)) * 4
    for (let c = 0; c < 3; c += 1) {
      const d = slice.data[so + c] - s * bg.data[bo + c]
      mse += d * d
    }
  }
  return { s, mse: mse / (mask.solid.length * 3) }
}

function cvGapX(bg: Pixels, slice: Pixels, expectedY: number): { x: number; edge: number; s: number; mse: number } {
  const mask = pieceMask(slice)
  const grad = gradOf(grayOf(bg), bg.width, bg.height)
  const yLo = Math.max(0, Math.min(bg.height - mask.h - 1, Math.round(expectedY) - 10))
  const yHi = Math.max(0, Math.min(bg.height - mask.h - 1, Math.round(expectedY) + 10))
  const candidates: Array<{ x: number; y: number; edge: number }> = []
  for (let y = yLo; y <= yHi; y += 1) {
    for (let x = 0; x < bg.width - mask.w - 1; x += 1) {
      let sum = 0
      for (const i of mask.edge) {
        sum += grad[(y + Math.floor(i / mask.w)) * bg.width + x + (i % mask.w)]
      }
      candidates.push({ x, y, edge: sum / mask.edge.length })
    }
  }
  candidates.sort((a, b) => b.edge - a.edge)
  if (!candidates.length || candidates[0].edge < 8) throw new Error('背景图上找不到缺口边缘')
  const top = candidates.slice(0, 15)
  let best: { x: number; y: number; edge: number; s: number; mse: number } | undefined
  for (const cand of top) {
    const { s, mse } = fitScale(bg, slice, mask, cand.x, cand.y)
    const darkened = s >= 1.02 && s <= 3.0
    const rank = { x: cand.x, y: cand.y, edge: cand.edge, s, mse }
    if (!best) {
      best = rank
      continue
    }
    const bestDark = best.s >= 1.02 && best.s <= 3.0
    if (darkened && (!bestDark || mse < best.mse)) best = rank
  }
  return { x: best!.x, edge: best!.edge, s: best!.s, mse: best!.mse }
}

async function onnxGapX(bgBuf: Buffer, bgWidth: number): Promise<number | null> {
  const modelPath = join(storage.userData(), 'models', 'geetest-slide.onnx')
  if (!existsSync(modelPath)) return null
  try {
    const req = createRequire(join(storage.userData(), 'models', 'index.js'))
    const ort = req('onnxruntime-node') as {
      InferenceSession: { create(path: string): Promise<{ inputNames: string[]; outputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { dims: readonly number[]; data: Float32Array }>> }> }
      Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
    }
    const size = 640
    const scale = size / bgWidth
    const decoded = decodePng(bgBuf)
    const srcH = decoded.height
    const dstH = Math.round(srcH * scale)
    const input = new Float32Array(3 * size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let r = 114
        let g = 114
        let b = 114
        if (y < dstH) {
          const sx = Math.min(decoded.width - 1, Math.floor(x / scale))
          const sy = Math.min(srcH - 1, Math.floor(y / scale))
          const o = (sy * decoded.width + sx) * 4
          b = decoded.data[o]
          g = decoded.data[o + 1]
          r = decoded.data[o + 2]
        }
        input[y * size + x] = r / 255
        input[size * size + y * size + x] = g / 255
        input[2 * size * size + y * size + x] = b / 255
      }
    }
    const session = await ort.InferenceSession.create(modelPath)
    const tensor = new ort.Tensor('float32', input, [1, 3, size, size])
    const output = await session.run({ [session.inputNames[0]]: tensor })
    const raw = output[session.outputNames[0]]
    const dims = raw.dims
    const data = raw.data as Float32Array
    // YOLOv8 det: [1, 4+cls, N] 或 [1, N, 4+cls]，单类「缺口」
    let bestConf = 0
    let bestCx = 0
    if (dims.length === 3) {
      const rowsFirst = dims[1] < dims[2]
      const rows = rowsFirst ? dims[1] : dims[2]
      const cols = rowsFirst ? dims[2] : dims[1]
      const at = (r: number, c: number): number => (rowsFirst ? data[r * cols + c] : data[c * rows + r])
      for (let c = 0; c < cols; c += 1) {
        let conf = 0
        for (let r = 4; r < rows; r += 1) conf = Math.max(conf, at(r, c))
        if (conf > bestConf) {
          bestConf = conf
          bestCx = at(0, c)
        }
      }
    }
    if (bestConf < 0.25) return null
    return bestCx / scale
  } catch {
    return null
  }
}

function markGap(bg: Pixels, maskBox: { x: number; y: number; w: number; h: number }): string {
  const data = Buffer.from(bg.data)
  const paint = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= bg.width || y >= bg.height) return
    const o = (y * bg.width + x) * 4
    data[o] = 0
    data[o + 1] = 0
    data[o + 2] = 255
    data[o + 3] = 255
  }
  for (let t = 0; t < 2; t += 1) {
    for (let x = maskBox.x; x < maskBox.x + maskBox.w; x += 1) {
      paint(x, maskBox.y + t)
      paint(x, maskBox.y + maskBox.h - 1 - t)
    }
    for (let y = maskBox.y; y < maskBox.y + maskBox.h; y += 1) {
      paint(maskBox.x + t, y)
      paint(maskBox.x + maskBox.w - 1 - t, y)
    }
  }
  const image = nativeImage.createFromBitmap(data, { width: bg.width, height: bg.height })
  const dir = storage.dir('screenshots')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `captcha-${Date.now()}.png`)
  writeFileSync(path, image.toPNG())
  return path
}

async function detectGeetestSlide(tab: TabRuntime, mark: boolean, engineHint: CaptchaEngine | 'auto'): Promise<CaptchaTarget> {
  await evalSource(
    tab,
    `(() => { const el = document.querySelector('[class*=geetest_slider],[class*=geetest_wrap]'); if (el) el.scrollIntoView({ block: 'center' }); return true })()`
  )
  await sleep(400)
  let probe = (await evalSource(tab, SLIDE_PROBE)) as SlideProbe
  for (let i = 0; i < 10 && (!probe.bg || !probe.slice || !probe.btn); i += 1) {
    await sleep(500)
    probe = (await evalSource(tab, SLIDE_PROBE)) as SlideProbe
  }
  if (!probe.bg || !probe.slice || !probe.bgRect || !probe.sliceRect || !probe.btn) {
    throw new Error('页面上没有极验滑块验证码，先点出验证面板再识别')
  }
  const [bgBuf, sliceBuf] = await Promise.all([download(probe.bg), download(probe.slice)])
  const bg = decodePng(bgBuf)
  const slice = decodePng(sliceBuf)
  const mask = pieceMask(slice)
  const scaleX = bg.width / probe.bgRect[2]
  const scaleY = bg.height / probe.bgRect[3]
  const sliceScale = probe.sliceRect[3] / slice.height
  const expectedY = (probe.sliceRect[1] + mask.py0 * sliceScale - probe.bgRect[1]) * scaleY

  let engine: CaptchaEngine = 'cv'
  let gapX: number | undefined
  let edge = 0
  let s = 0
  let mse = 0
  const prefer = engineHint === 'auto' ? (['cv', 'ddddocr', 'onnx'] as const) : ([engineHint] as const)
  let lastError: unknown
  for (const candidate of prefer) {
    try {
      if (candidate === 'ddddocr') {
        const found = await ddddocrGapX(bgBuf, sliceBuf)
        if (found !== null) {
          engine = 'ddddocr'
          gapX = found
          break
        }
      } else if (candidate === 'onnx') {
        const found = await onnxGapX(bgBuf, bg.width)
        if (found !== null) {
          engine = 'onnx'
          gapX = found
          break
        }
      } else {
        const found = cvGapX(bg, slice, expectedY)
        engine = 'cv'
        gapX = found.x
        edge = found.edge
        s = found.s
        mse = found.mse
        break
      }
    } catch (error) {
      lastError = error
    }
  }
  if (gapX === undefined) {
    throw new Error(engineHint === 'auto'
      ? `三个识别引擎都不可用：${lastError instanceof Error ? lastError.message : '识别失败'}`
      : `识别引擎 ${engineHint} 不可用，试试 engine 传 auto`)
  }

  const gapCssLeft = probe.bgRect[0] + gapX / scaleX
  const pieceCssLeft = probe.sliceRect[0] + mask.px0 * sliceScale
  const distance = Math.round((gapCssLeft - pieceCssLeft) * 10) / 10
  const knob = { x: Math.round((probe.btn[0] + probe.btn[2] / 2) * 10) / 10, y: Math.round((probe.btn[1] + probe.btn[3] / 2) * 10) / 10 }
  const result: CaptchaTarget = {
    type: 'geetest-slide',
    engine,
    knob,
    distance,
    gapImageX: gapX,
    confidence: { edge: Math.round(edge * 10) / 10, scale: Math.round(s * 100) / 100, mse: Math.round(mse) }
  }
  if (mark) {
    result.markPath = markGap(bg, { x: gapX, y: Math.round(expectedY), w: mask.w, h: mask.h })
  }
  return result
}

export type IconTarget = {
  type: 'geetest-icon'
  engine: CaptchaEngine
  points: Array<{ x: number; y: number; score: number }>
  ok: { x: number; y: number }
  markPath?: string
}

export type AnyTarget = CaptchaTarget | IconTarget

function resizeBilinear(img: Pixels, nw: number, nh: number): Pixels {
  const out = Buffer.alloc(nw * nh * 4)
  for (let y = 0; y < nh; y += 1) {
    for (let x = 0; x < nw; x += 1) {
      const sx = (x + 0.5) * (img.width / nw) - 0.5
      const sy = (y + 0.5) * (img.height / nh) - 0.5
      const x0 = Math.max(0, Math.min(img.width - 2, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(img.height - 2, Math.floor(sy)))
      const fx = Math.max(0, Math.min(1, sx - x0))
      const fy = Math.max(0, Math.min(1, sy - y0))
      const o = (y * nw + x) * 4
      for (let c = 0; c < 4; c += 1) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]
        const p10 = img.data[(y0 * img.width + x0 + 1) * 4 + c]
        const p01 = img.data[((y0 + 1) * img.width + x0) * 4 + c]
        const p11 = img.data[((y0 + 1) * img.width + x0 + 1) * 4 + c]
        out[o + c] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy)
      }
    }
  }
  return { width: nw, height: nh, data: out }
}

function nccMatchIcon(bg: Pixels, tpl: Pixels): { x: number; y: number; score: number } {
  const bgGray = grayOf(bg)
  const n = tpl.width * tpl.height
  const mask: number[] = []
  const tplGray = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    tplGray[i] = (tpl.data[o] + tpl.data[o + 1] + tpl.data[o + 2]) / 3
    if (tpl.data[o + 3] > 128) mask.push(i)
  }
  if (mask.length < 30) return { x: 0, y: 0, score: 0 }
  let tMean = 0
  for (const i of mask) tMean += tplGray[i]
  tMean /= mask.length
  let tVar = 0
  for (const i of mask) tVar += (tplGray[i] - tMean) ** 2
  if (!tVar) return { x: 0, y: 0, score: 0 }
  let best = { x: 0, y: 0, score: -1 }
  for (let y = 0; y <= bg.height - tpl.height; y += 1) {
    for (let x = 0; x <= bg.width - tpl.width; x += 1) {
      let bMean = 0
      for (const i of mask) bMean += bgGray[(y + Math.floor(i / tpl.width)) * bg.width + x + (i % tpl.width)]
      bMean /= mask.length
      let cov = 0
      let bVar = 0
      for (const i of mask) {
        const b = bgGray[(y + Math.floor(i / tpl.width)) * bg.width + x + (i % tpl.width)] - bMean
        cov += (tplGray[i] - tMean) * b
        bVar += b * b
      }
      const denom = Math.sqrt(tVar * bVar)
      if (!denom) continue
      const score = cov / denom
      if (score > best.score) best = { x, y, score }
    }
  }
  return best
}

async function detectGeetestIcon(tab: TabRuntime, mark: boolean): Promise<IconTarget> {
  await evalSource(
    tab,
    `(() => { const el = document.querySelector('[class*=geetest_bg]'); if (el) el.scrollIntoView({ block: 'center' }); return true })()`
  )
  await sleep(400)
  let probe = (await evalSource(tab, ICON_PROBE)) as { icons?: string[]; bg?: string; bgRect?: [number, number, number, number]; okRect?: [number, number, number, number] }
  for (let i = 0; i < 10 && (!probe.icons?.length || !probe.bg); i += 1) {
    await sleep(500)
    probe = (await evalSource(tab, ICON_PROBE)) as typeof probe
  }
  if (!probe.icons?.length || !probe.bg || !probe.bgRect || !probe.okRect) {
    throw new Error('页面上没有极验图标点选验证码，先点出验证面板再识别')
  }
  const [bgBuf, ...iconBufs] = await Promise.all([download(probe.bg), ...probe.icons.map(download)])
  const bg = decodePng(bgBuf)
  const scaleX = bg.width / probe.bgRect[2]
  const scaleY = bg.height / probe.bgRect[3]
  const scales = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4]
  const found: Array<{ x: number; y: number; w: number; h: number; score: number }> = []
  for (const buf of iconBufs) {
    const icon = decodePng(buf)
    let best = { x: 0, y: 0, w: icon.width, h: icon.height, score: -1 }
    for (const sc of scales) {
      const resized = resizeBilinear(icon, Math.max(8, Math.round(icon.width * sc)), Math.max(8, Math.round(icon.height * sc)))
      if (resized.width >= bg.width || resized.height >= bg.height) continue
      const hit = nccMatchIcon(bg, resized)
      if (hit.score > best.score) best = { x: hit.x, y: hit.y, w: resized.width, h: resized.height, score: hit.score }
    }
    if (best.score < 0.45) throw new Error(`有一个指令图标在背景图里找不到（最高相似度 ${best.score.toFixed(2)}），改用 captcha_panel 截图自己识别`)
    found.push(best)
  }
  const points = found.map((f) => ({
    x: Math.round((probe.bgRect![0] + (f.x + f.w / 2) / scaleX) * 10) / 10,
    y: Math.round((probe.bgRect![1] + (f.y + f.h / 2) / scaleY) * 10) / 10,
    score: Math.round(f.score * 100) / 100
  }))
  const result: IconTarget = {
    type: 'geetest-icon',
    engine: 'cv',
    points,
    ok: {
      x: Math.round((probe.okRect[0] + probe.okRect[2] / 2) * 10) / 10,
      y: Math.round((probe.okRect[1] + probe.okRect[3] / 2) * 10) / 10
    }
  }
  if (mark) {
    const data = Buffer.from(bg.data)
    const paint = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= bg.width || y >= bg.height) return
      const o = (y * bg.width + x) * 4
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 255
      data[o + 3] = 255
    }
    for (const f of found) {
      for (let t = 0; t < 2; t += 1) {
        for (let x = f.x; x < f.x + f.w; x += 1) {
          paint(x, f.y + t)
          paint(x, f.y + f.h - 1 - t)
        }
        for (let y = f.y; y < f.y + f.h; y += 1) {
          paint(f.x + t, y)
          paint(f.x + f.w - 1 - t, y)
        }
      }
    }
    const image = nativeImage.createFromBitmap(data, { width: bg.width, height: bg.height })
    const dir = storage.dir('screenshots')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `captcha-${Date.now()}.png`)
    writeFileSync(path, image.toPNG())
    result.markPath = path
  }
  return result
}

const detectors: Record<string, (tab: TabRuntime, mark: boolean, engineHint: CaptchaEngine | 'auto') => Promise<AnyTarget>> = {
  'geetest-slide': detectGeetestSlide,
  'geetest-icon': (tab, mark) => detectGeetestIcon(tab, mark)
}

async function detectType(tab: TabRuntime): Promise<string> {
  const kind = (await evalSource(
    tab,
    `(() => {
      if (document.querySelector('[class*=geetest_ques_tips] img')) return 'geetest-icon'
      if (document.querySelector('[class*=geetest_slice_bg],[class*=geetest_bg]')) return 'geetest-slide'
      return ''
    })()`
  )) as string
  if (kind) return kind
  throw new Error('认不出页面上的验证码类型，目前支持：geetest-slide、geetest-icon')
}

export async function detectCaptcha(tab: TabRuntime, type = 'auto', mark = false, engineHint: CaptchaEngine | 'auto' = 'auto'): Promise<AnyTarget> {
  const kind = type === 'auto' ? await detectType(tab) : type
  const detector = detectors[kind]
  if (!detector) throw new Error(`不支持的验证码类型 ${kind}，目前支持：${Object.keys(detectors).join('、')}`)
  return detector(tab, mark, engineHint)
}

export async function solveCaptcha(tab: TabRuntime, type = 'auto', via: GestureVia = 'cdp', retries = 2, engineHint: CaptchaEngine | 'auto' = 'auto'): Promise<CaptchaSolveResult> {
  const detail: CaptchaSolveResult['detail'] = []
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(1_500)
    const target = await detectCaptcha(tab, type, false, engineHint)
    if (target.type === 'geetest-icon') {
      for (const point of target.points) {
        await clickPoint(tab, point.x, point.y, via)
        await sleep(350 + Math.random() * 300)
      }
      await clickPoint(tab, target.ok.x, target.ok.y, via)
      detail.push({ distance: target.points.length, engine: target.engine, solved: false })
    } else {
      await dragPage(tab, via, target.knob, target.distance, 0)
      detail.push({ distance: target.distance, engine: target.engine, solved: false })
    }
    await sleep(1_800)
    const state = (await evalSource(tab, SLIDE_RESULT)) as { success: boolean; panel: boolean }
    const solved = state.success || !state.panel
    detail[detail.length - 1].solved = solved
    if (solved) return { solved: true, attempts: attempt + 1, detail }
  }
  return { solved: false, attempts: retries + 1, detail }
}
