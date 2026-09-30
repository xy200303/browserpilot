import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html?v=3'

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

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
const tree = await call('page_snapshot', { tabId })
const feed = tree.snapshot.match(/region "动态" \[ref=(e\d+)\]/)?.[1]
const before = (await call('page_evaluate', { tabId, source: 'document.getElementById("feed").scrollTop' })).value
const swipe = await call('page_swipe', { tabId, ref: feed, direction: 'up' })
const after = (await call('page_evaluate', { tabId, source: 'JSON.stringify({scrollTop:document.getElementById("feed").scrollTop, top:document.getElementById("target").getBoundingClientRect().top})' })).value
console.log(JSON.stringify({ tabId, feed, before, swipe: swipe.error || 'ok', after }, null, 2))
