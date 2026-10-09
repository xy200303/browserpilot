import { ipcRenderer } from 'electron'

// 页面右键信号（捕获阶段，页面 preventDefault 也拦不到这里）
window.addEventListener('contextmenu', (event) => {
  ipcRenderer.send('page:contextmenu', { x: event.clientX, y: event.clientY })
}, true)
