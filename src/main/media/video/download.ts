import { writeFileSync } from 'fs'
import { join } from 'path'
import type { TabRuntime } from '../../runtime'
import { downloadMedia } from '../../page'
import { runFfmpeg } from '../../services/ffmpeg'
import { wcOf } from '../common'
import type { MediaPlan, MediaProgress, MediaSaved } from '../types'

function mergeTracks(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  const args = ['-y', '-i', videoPath]
  if (audioPath) args.push('-i', audioPath)
  args.push('-c', 'copy', outPath)
  return runFfmpeg(args)
}

async function downloadDashPair(tab: TabRuntime, video: string, audio: string, dir: string, savePath: string | undefined, onProgress: MediaProgress): Promise<MediaSaved> {
  const stamp = Date.now()
  const referer = tab.url || undefined
  const videoPath = join(dir, `video-${stamp}-v.m4s`)
  await downloadMedia(tab, video, videoPath, referer, onProgress)
  let audioPath = ''
  if (audio) {
    audioPath = join(dir, `video-${stamp}-a.m4s`)
    await downloadMedia(tab, audio, audioPath, referer, onProgress)
  }
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  try {
    await mergeTracks(videoPath, audioPath, outPath)
    const { unlinkSync, statSync } = await import('fs')
    unlinkSync(videoPath)
    if (audioPath) unlinkSync(audioPath)
    return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
  } catch {
    throw new Error(`没有 ffmpeg 合并音视频轨，两条轨已分别保存：${videoPath}${audioPath ? `、${audioPath}` : ''}`)
  }
}

async function concatMp4Segments(tab: TabRuntime, urls: string[], dir: string, savePath: string | undefined, onProgress: MediaProgress): Promise<MediaSaved> {
  // 搜狐这类站把整片切成多段 mp4，逐段带登录态下载后按播放顺序合并
  const stamp = Date.now()
  const referer = tab.url || undefined
  const segs: string[] = []
  let received = 0
  for (let i = 0; i < urls.length; i += 1) {
    const segPath = join(dir, `segs-${stamp}-${i}.mp4`)
    await downloadMedia(tab, urls[i], segPath, referer, (n) => onProgress(received + n))
    const { statSync } = await import('fs')
    received += statSync(segPath).size
    segs.push(segPath)
  }
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  const listPath = join(dir, `segs-${stamp}.txt`)
  writeFileSync(listPath, segs.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], 10 * 60_000)
    const { statSync, unlinkSync } = await import('fs')
    for (const s of segs) unlinkSync(s)
    unlinkSync(listPath)
    return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
  } catch {
    throw new Error(`分段视频合并失败，${segs.length} 个分段已保存在 ${dir}（segs-${stamp}-*.mp4）`)
  }
}

async function saveManifest(tab: TabRuntime, manifest: string, dir: string, savePath: string | undefined): Promise<MediaSaved> {
  const stamp = Date.now()
  const outPath = savePath || join(dir, `video-${stamp}.mp4`)
  const referer = tab.url || ''
  const args = ['-y']
  const ua = wcOf(tab).getUserAgent()
  if (ua) args.push('-user_agent', ua)
  if (referer) args.push('-headers', `Referer: ${referer}\r\n`)
  args.push('-i', manifest, '-c', 'copy', outPath)
  await runFfmpeg(args, 10 * 60_000)
  const { statSync } = await import('fs')
  return { path: outPath, kind: 'video', bytes: statSync(outPath).size }
}

/** 执行下载计划。direct 不由这里处理，videoHandler 拿到 url 走普通下载流程。 */
export async function executeMediaPlan(
  tab: TabRuntime,
  plan: Exclude<MediaPlan, { kind: 'direct' }>,
  dir: string,
  savePath: string | undefined,
  onProgress: MediaProgress
): Promise<MediaSaved> {
  if (plan.kind === 'dash') return downloadDashPair(tab, plan.video, plan.audio, dir, savePath, onProgress)
  if (plan.kind === 'segments') return concatMp4Segments(tab, plan.urls, dir, savePath, onProgress)
  return saveManifest(tab, plan.url, dir, savePath)
}
