import i18next from 'i18next'
import { app } from 'electron'
import { resources, resolveLanguage } from '@shared/i18n'
import type { LanguageSetting } from '@shared/types'

// 主进程单独一个实例：渲染进程那个是 React 用的，这里只出字符串。
// 不在这里读 storage：store 会间接引到本模块，读它就成了循环初始化。
// 先用系统语言启动，storage.load() 之后由 applyMainLanguage 校正成设置里的值。
// initAsync: false 让初始化同步完成，启动阶段调用 mt() 不会拿到未翻译的 key。
const instance = i18next.createInstance()
void instance.init({
  resources,
  lng: resolveLanguage(undefined, app.getLocale()),
  fallbackLng: 'zh-CN',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false
})

/** 主进程里的文案，跟界面语言走。 */
export function mt(key: string, vars?: Record<string, unknown>): string {
  return (vars ? instance.t(key, vars) : instance.t(key)) as string
}

/** settings.language 变了之后调用，主进程的文案立即跟着切换。 */
export function applyMainLanguage(setting: LanguageSetting | undefined): void {
  const next = resolveLanguage(setting, app.getLocale())
  if (instance.language !== next) void instance.changeLanguage(next)
}
