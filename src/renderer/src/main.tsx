import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MarketPage } from './MarketPage'
import { PopupApp } from './Popup'
import { SettingsPage } from './Settings'
import { RailApp } from './Rail'
import './index.css'

const layer = new URLSearchParams(window.location.search).get('layer')
if (layer === 'popup') document.documentElement.classList.add('popup')
if (layer === 'rail') document.documentElement.classList.add('rail')
if (layer === 'market' || layer === 'settings') document.documentElement.classList.add('page')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {layer === 'popup' ? <PopupApp /> : layer === 'rail' ? <RailApp /> : layer === 'market' ? <MarketPage /> : layer === 'settings' ? <SettingsPage /> : <App />}
  </StrictMode>
)
