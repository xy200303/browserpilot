import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { applyLanguage } from './i18n'
import { drawGrid } from './lib/grid'
import { App } from './App'
import './index.css'

// 每个图层（主界面、popup、rail、市场、设置）都是独立的渲染入口，
// 语言要在入口统一应用，不能只靠 App.tsx，否则弹层永远停在系统语言。
if (window.browser) {
  void window.browser.getState().then((state) => applyLanguage(state?.settings.language))
  window.browser.onState((state) => applyLanguage(state?.settings.language))
  window.browser.onGridRender((request) => {
    void (async () => {
      let png = request.png
      try {
        png = await drawGrid(request.png, request.options)
      } catch {
        /* 合成失败就回原图，不要卡住主进程 */
      }
      window.browser.sendGridResult(request.id, png)
    })()
  })
}

const layer = new URLSearchParams(window.location.search).get('layer')
if (layer === 'popup') document.documentElement.classList.add('popup')
if (layer === 'rail') document.documentElement.classList.add('rail')
if (layer === 'market' || layer === 'settings') document.documentElement.classList.add('page')

// 各图层按需加载：主界面启动时不再把市场、设置、popup、rail 的代码一起解析
const Root =
  layer === 'popup'
    ? lazy(() => import('./Popup').then((mod) => ({ default: mod.PopupApp })))
    : layer === 'rail'
      ? lazy(() => import('./Rail').then((mod) => ({ default: mod.RailApp })))
      : layer === 'market'
        ? lazy(() => import('./MarketPage').then((mod) => ({ default: mod.MarketPage })))
        : layer === 'settings'
          ? lazy(() => import('./Settings').then((mod) => ({ default: mod.SettingsPage })))
          : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>
)
