import type { AppLanguage, LanguageSetting } from '../types'
import { enMain } from './en-US/main'
import { enMarket } from './en-US/market'
import { enPages } from './en-US/pages'
import { enSettings } from './en-US/settings'
import { enShell } from './en-US/shell'
import { enWorkflow } from './en-US/workflow'
import { zhMain } from './zh-CN/main'
import { zhMarket } from './zh-CN/market'
import { zhPages } from './zh-CN/pages'
import { zhSettings } from './zh-CN/settings'
import { zhShell } from './zh-CN/shell'
import { zhWorkflow } from './zh-CN/workflow'

export type { MessageShape } from './shape'

export const zhCN = { ...zhShell, ...zhPages, ...zhSettings, ...zhMarket, ...zhWorkflow, ...zhMain }
export const enUS = { ...enShell, ...enPages, ...enSettings, ...enMarket, ...enWorkflow, ...enMain }

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
