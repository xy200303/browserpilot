import type { MediaProvider } from '../types'
import { bilibiliProvider } from './bilibili'
import { youtubeProvider } from './youtube'

// 平台注册处：新增平台时在 video/ 下建一个 <平台>.ts 导出 MediaProvider，加进这个数组
export const siteProviders: MediaProvider[] = [
  bilibiliProvider,
  youtubeProvider
]
