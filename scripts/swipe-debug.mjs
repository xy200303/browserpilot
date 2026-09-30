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
const before = await call('page_evaluate', { tabId, source: 'JSON.stringify(window.__dbg)' })
const swipe = await call('page_swipe', { tabId, direction: 'up' })
const after = await call('page_evaluate', { tabId, source: 'JSON.stringify({dbg:window.__dbg, transform:document.getElementById("track").style.transform})' })
console.log(JSON.stringify({ tabId, before, swipe, after }, null, 2))
