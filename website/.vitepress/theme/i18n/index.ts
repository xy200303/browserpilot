import { createI18n } from 'vue-i18n'
import { useData } from 'vitepress'
import { enUS } from './en-US'
import { zhCN } from './zh-CN'

export type { MessageShape } from './shape'

type Locale = 'zh-CN' | 'en-US'

const messages = { 'zh-CN': { home: zhCN }, 'en-US': { home: enUS } }

// 每种语言一个实例，页面构建时就固定了，挂到模块上避免每次渲染重建
const instances: Partial<Record<Locale, ReturnType<typeof createI18n>>> = {}

function instanceOf(locale: Locale): ReturnType<typeof createI18n> {
  if (!instances[locale]) {
    instances[locale] = createI18n({ legacy: false, locale, fallbackLocale: 'zh-CN', messages })
  }
  return instances[locale]!
}

/** 首页文案：数组用 tm，单句用 t，键都在 home 命名空间下。 */
export function useHomeCopy(): { t: (key: string) => string; tm: (key: string) => any; isZh: boolean } {
  const { lang } = useData()
  const isZh = String(lang.value).toLowerCase().startsWith('zh')
  const i18n = instanceOf(isZh ? 'zh-CN' : 'en-US')
  return {
    t: (key: string) => i18n.global.t(`home.${key}`) as string,
    tm: (key: string) => i18n.global.tm(`home.${key}`) as any,
    isZh
  }
}
