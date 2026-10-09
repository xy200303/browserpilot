import type { TabRuntime } from '../runtime'
import type { ElementInfo } from '../page'

export type MediaSaved = { path: string; kind: string; bytes: number }

export type MediaProgress = (received: number, total?: number) => void

/** 统一的流信息结构：各种嗅探手段都归一到这个形状 */
export type StreamSniff = { m3u8?: string; mpd?: string; video?: string; audio?: string; mp4?: string; mp4s?: string[] }

/** 归一化后的下载计划，由 video.ts 的 executeMediaPlan 统一执行 */
export type MediaPlan =
  | { kind: 'dash'; video: string; audio: string } // 音视频分轨，下载后 ffmpeg 合并
  | { kind: 'segments'; urls: string[] } // 分段 mp4，按顺序下载后 ffmpeg concat
  | { kind: 'manifest'; url: string } // m3u8 / mpd 清单，ffmpeg 拉流转 mp4
  | { kind: 'direct'; url: string } // 渐进直链，走普通下载

/**
 * 媒体类型处理器：每种媒体类型一个文件（video.ts / image.ts / audio.ts / canvas.ts），
 * 实现这个接口后在 index.ts 的 handlers 里注册即可。
 */
export interface MediaHandler {
  kind: ElementInfo['kind']
  save(tab: TabRuntime, info: ElementInfo, dir: string, savePath: string | undefined, onProgress: MediaProgress): Promise<MediaSaved>
}

/**
 * 平台视频 provider：识别特定站点的流地址。新增平台时在 video.ts 的 siteProviders
 * 注册一条即可，下载、合并、进度上报全部统一处理。
 */
export interface MediaProvider {
  name: string
  match: (url: string) => boolean
  resolve: (tab: TabRuntime) => Promise<MediaPlan | null>
}
