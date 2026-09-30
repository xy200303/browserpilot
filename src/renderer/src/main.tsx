import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PopupApp } from './Popup'
import { RailApp } from './Rail'
import './index.css'

const layer = new URLSearchParams(window.location.search).get('layer')
if (layer === 'popup') document.documentElement.classList.add('popup')
if (layer === 'rail') document.documentElement.classList.add('rail')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {layer === 'popup' ? <PopupApp /> : layer === 'rail' ? <RailApp /> : <App />}
  </StrictMode>
)
