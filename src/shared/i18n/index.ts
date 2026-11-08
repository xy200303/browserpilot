import type { AppLanguage, LanguageSetting } from '../types'
import { enUS } from './en-US'
import { zhCN } from './zh-CN'

export type { MessageShape } from './zh-CN'

export const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS }
}

export const appLanguages: Array<{ id: AppLanguage; label: string }> = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en-US', label: 'English' }
]

/** auto 时看系统语言：中文系统给中文，其它一律英文。 */
export function resolveLanguage(setting: LanguageSetting | undefined, system: string): AppLanguage {
  if (setting === 'zh-CN' || setting === 'en-US') return setting
  return system.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}
