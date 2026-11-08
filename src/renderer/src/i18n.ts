import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources, resolveLanguage } from '../../shared/i18n'
import type { LanguageSetting } from '../../shared/types'

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage('auto', navigator.language),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false
})

/** 设置变化时调用：跟着设置的 auto / 具体语言切换界面。 */
export function applyLanguage(setting: LanguageSetting | undefined): void {
  const next = resolveLanguage(setting, navigator.language)
  if (i18n.language !== next) void i18n.changeLanguage(next)
}

export default i18n
