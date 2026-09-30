import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/Desktop/projectM/浏览器开发/scripts/coord-lab.html'

async function call(name, args) {
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ep.token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const text = await res.text()
  const line = text.split('\n').find((item) => item.startsWith('data: '))
  const payload = line ? JSON.parse(line.slice(6)) : null
  const inner = payload?.result?.content?.[0]?.text
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 500) }
}

function shotPoint(box, shot) {
  return {
    x: Math.round(box.x * shot.width / box.innerWidth),
    y: Math.round(box.y * shot.height / box.innerHeight)
  }
}

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
const shot = await call('page_screenshot', { tabId })
const top = JSON.parse((await call('page_evaluate', {
  tabId,
  source: `(() => { const r = document.getElementById('top').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, innerWidth, innerHeight, scrollY }); })()`
})).value)
const topPixel = shotPoint(top, shot)
const missing = await call('page_click', { tabId, x: topPixel.x, y: topPixel.y })
const topClick = await call('page_click', { tabId, x: topPixel.x, y: topPixel.y, shotWidth: shot.width, shotHeight: shot.height })
const topLog = (await call('page_evaluate', { tabId, source: 'document.getElementById("log").textContent' })).value

await call('page_evaluate', {
  tabId,
  source: `document.getElementById('low').scrollIntoView({ block: 'center' })`
})
const shot2 = await call('page_screenshot', { tabId })
const low = JSON.parse((await call('page_evaluate', {
  tabId,
  source: `(() => { const r = document.getElementById('low').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, pageY: r.top + scrollY, innerWidth, innerHeight, scrollY }); })()`
})).value)
const lowPixel = shotPoint(low, shot2)
await call('page_click', { tabId, x: lowPixel.x, y: lowPixel.y, shotWidth: shot2.width, shotHeight: shot2.height })
const lowLog = (await call('page_evaluate', { tabId, source: 'document.getElementById("log").textContent' })).value

console.log(JSON.stringify({
  tabId,
  shot: { w: shot.width, h: shot.height },
  missing: missing.error || 'unexpected-ok',
  top: { box: top, pixel: topPixel, click: topClick.error || 'ok', log: topLog },
  low: { box: low, pixel: lowPixel, shot: { w: shot2.width, h: shot2.height }, log: lowLog }
}, null, 2))
