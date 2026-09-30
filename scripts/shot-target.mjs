import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 400) }
}

const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html'
const opened = await call('tab_open', { url: page })
const tabId = opened.tabId

await call('page_evaluate', {
  tabId,
  source: `(() => { const f = document.getElementById('feed'); const t = document.getElementById('target'); const fr = f.getBoundingClientRect(); t.dataset.hit = ''; f.scrollTop = t.offsetTop - f.clientHeight / 2; return f.scrollTop; })()`
})
const shot = await call('page_screenshot', { tabId })
const box = JSON.parse((await call('page_evaluate', {
  tabId,
  source: `(() => { const r = document.getElementById('target').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, innerWidth, innerHeight }); })()`
})).value)
const x = Math.round(box.x * shot.width / box.innerWidth)
const y = Math.round(box.y * shot.height / box.innerHeight)
await call('page_click', { tabId, x, y })
const after = await call('page_evaluate', {
  tabId,
  source: 'JSON.stringify({ hit: document.getElementById("target").dataset.hit || "", stack: document.elementsFromPoint(' + box.x + ',' + box.y + ').slice(0,3).map(el => el.id || el.tagName) })'
})
console.log(JSON.stringify({ box, pixel: { x, y }, shot: { w: shot.width, h: shot.height }, after: after.value || after.error }, null, 2))
