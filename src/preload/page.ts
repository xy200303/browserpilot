import { ipcRenderer } from 'electron'

// 性能条目默认只留 250 条，视频站很快被图片冲掉，拉大缓冲方便后面找流地址
try {
  performance.setResourceTimingBufferSize(5000)
} catch {
  /* 老内核没有这个方法 */
}

// 页面右键信号（捕获阶段，页面 preventDefault 也拦不到这里）
window.addEventListener('contextmenu', (event) => {
  ipcRenderer.send('page:contextmenu', { x: event.clientX, y: event.clientY })
}, true)
