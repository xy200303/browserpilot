import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html'

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

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
const shot = await call('page_screenshot', { tabId })
const box = JSON.parse((await call('page_evaluate', {
  tabId,
  source: `(() => { const el = document.getElementById('cat'); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, innerWidth, innerHeight }); })()`
})).value)
const x = Math.round(box.x * shot.width / box.innerWidth)
const y = Math.round(box.y * shot.height / box.innerHeight)
const click = await call('page_click', { tabId, x, y })
const after = await call('page_evaluate', {
  tabId,
  source: `JSON.stringify({ menuHidden: document.getElementById('menu').hidden, sent: { x: ${x}, y: ${y} }, shot: { w: ${shot.width}, h: ${shot.height} } })`
})
console.log(JSON.stringify({ tabId, click: click.error || 'ok', box, after: after.value || after.error }, null, 2))
